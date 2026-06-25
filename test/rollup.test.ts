import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { rollupAndPrune } from '../src/db/rollup';
import type { Bindings } from '../src/types';

// @ts-expect-error cloudflare:test injects env at runtime
const testEnv = env as Bindings;

beforeEach(async () => {
  // Seed required rows (safe to re-run with OR IGNORE)
  await testEnv.DB.prepare(
    `INSERT OR IGNORE INTO owners (id, github_id, login, type) VALUES (1, 1, 'testorg', 'Organization')`,
  ).run();
  await testEnv.DB.prepare(
    `INSERT OR IGNORE INTO projects (id, owner_id, github_repo_id, repo_name, full_slug, installation_id, default_branch)
     VALUES (1, 1, 1, 'repo', 'testorg/repo', 1, 'main')`,
  ).run();
  // Clear mutable tables for isolation
  await testEnv.DB.prepare('DELETE FROM coverage_daily').run();
  await testEnv.DB.prepare('DELETE FROM coverage_runs').run();
});

describe('rollupAndPrune', () => {
  it('snapshots old runs into coverage_daily and prunes them', async () => {
    const now = Math.floor(Date.now() / 1000);
    const old = now - 15 * 86400; // 15 days ago — beyond 14-day retention

    await testEnv.DB.prepare(
      `INSERT INTO coverage_runs (project_id, commit_sha, branch, ran_at, line_coverage)
       VALUES (1, 'sha-old1', 'main', ?1, 80.0),
              (1, 'sha-old2', 'main', ?2, 85.0),
              (1, 'sha-new',  'main', ?3, 90.0)`,
    ).bind(old - 86400, old, now).run();

    await rollupAndPrune(testEnv);

    const remaining = await testEnv.DB.prepare(
      `SELECT commit_sha FROM coverage_runs ORDER BY ran_at`,
    ).all<{ commit_sha: string }>();
    expect(remaining.results.map((r) => r.commit_sha)).toEqual(['sha-new']);

    const daily = await testEnv.DB.prepare(
      `SELECT day, line_coverage FROM coverage_daily WHERE project_id = 1 ORDER BY day`,
    ).all<{ day: string; line_coverage: number }>();
    expect(daily.results).toHaveLength(2);
    expect(daily.results.map((r) => r.line_coverage)).toContain(85.0);
  });

  it('is idempotent — re-running does not duplicate daily rows', async () => {
    const old = Math.floor(Date.now() / 1000) - 20 * 86400;
    await testEnv.DB.prepare(
      `INSERT INTO coverage_runs (project_id, commit_sha, branch, ran_at, line_coverage)
       VALUES (1, 'sha-idem', 'main', ?1, 75.0)`,
    ).bind(old).run();

    await rollupAndPrune(testEnv);
    await rollupAndPrune(testEnv); // second call with empty runs — no-op

    const daily = await testEnv.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM coverage_daily WHERE project_id = 1`,
    ).first<{ cnt: number }>();
    expect(daily!.cnt).toBe(1);
  });
});
