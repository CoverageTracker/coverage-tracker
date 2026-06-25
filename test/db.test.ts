import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  upsertCoverageRun,
  getCoverageTrend,
  getLatestCoverage,
} from '../src/lib/db';
import type { Bindings } from '../src/types';

// @ts-expect-error cloudflare:test injects env at runtime
const testEnv = env as Bindings;

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;

beforeEach(async () => {
  await testEnv.DB.prepare(
    `INSERT OR IGNORE INTO owners (id, github_id, login, type) VALUES (1, 1, 'testorg', 'Organization')`,
  ).run();
  await testEnv.DB.prepare(
    `INSERT OR IGNORE INTO projects (id, owner_id, github_repo_id, repo_name, full_slug, installation_id, default_branch)
     VALUES (1, 1, 1, 'repo', 'testorg/repo', 1, 'main')`,
  ).run();
  await testEnv.DB.prepare('DELETE FROM coverage_daily').run();
  await testEnv.DB.prepare('DELETE FROM coverage_runs').run();
});

describe('upsertCoverageRun — idempotency', () => {
  it('second upsert with same commit updates values, does not duplicate', async () => {
    await upsertCoverageRun(testEnv.DB, 1, 'sha-abc', 'main', NOW, { line_coverage: 70 });
    await upsertCoverageRun(testEnv.DB, 1, 'sha-abc', 'main', NOW, { line_coverage: 90 });

    const { results } = await testEnv.DB.prepare(
      `SELECT line_coverage FROM coverage_runs WHERE project_id = 1`,
    ).all<{ line_coverage: number }>();

    expect(results).toHaveLength(1);
    expect(results[0].line_coverage).toBe(90);
  });
});

describe('getCoverageTrend — most-recent-N ordering', () => {
  it('returns the newest N days (not oldest N) in ascending order', async () => {
    // Seed 25 days of runs, day 0 = 25 days ago, day 24 = today
    const stmts = Array.from({ length: 25 }, (_, i) =>
      testEnv.DB.prepare(
        `INSERT INTO coverage_runs (project_id, commit_sha, branch, ran_at, line_coverage)
         VALUES (1, ?, 'main', ?, ?)`,
      ).bind(`sha-${i}`, NOW - (24 - i) * DAY, i + 50),
    );
    for (const s of stmts) await s.run();

    const trend = await getCoverageTrend(testEnv.DB, 1, 'main', 20);

    expect(trend).toHaveLength(20);
    // Ascending: first point is day 5 (index 5 → coverage 55), last is today (index 24 → 74)
    expect(trend[0].line_coverage).toBe(55); // oldest of the 20 most-recent
    expect(trend.at(-1)!.line_coverage).toBe(74); // today
    // Verify strict ascending order
    for (let i = 1; i < trend.length; i++) {
      expect(trend[i].recorded_at >= trend[i - 1].recorded_at).toBe(true);
    }
  });
});

describe('getLatestCoverage — coverage_daily fallback', () => {
  it('returns null when both tables are empty', async () => {
    const result = await getLatestCoverage(testEnv.DB, 1, 'main');
    expect(result).toBeNull();
  });

  it('returns coverage_runs row when present', async () => {
    await upsertCoverageRun(testEnv.DB, 1, 'sha-run', 'main', NOW, { line_coverage: 88 });
    const result = await getLatestCoverage(testEnv.DB, 1, 'main');
    expect(result).not.toBeNull();
    expect(result!.line_coverage).toBe(88);
    expect(result!.commit_sha).toBe('sha-run');
  });

  it('falls back to coverage_daily when coverage_runs is empty', async () => {
    await testEnv.DB.prepare(
      `INSERT INTO coverage_daily (project_id, day, line_coverage, run_count)
       VALUES (1, '2026-01-01', 77.5, 1)`,
    ).run();

    const result = await getLatestCoverage(testEnv.DB, 1, 'main');
    expect(result).not.toBeNull();
    expect(result!.line_coverage).toBe(77.5);
    expect(result!.commit_sha).toBe('aggregated');
  });

  it('prefers the most recent daily row when multiple exist', async () => {
    await testEnv.DB.prepare(
      `INSERT INTO coverage_daily (project_id, day, line_coverage, run_count)
       VALUES (1, '2026-01-01', 60.0, 1),
              (1, '2026-01-10', 80.0, 1)`,
    ).run();

    const result = await getLatestCoverage(testEnv.DB, 1, 'main');
    expect(result!.line_coverage).toBe(80.0);
  });
});
