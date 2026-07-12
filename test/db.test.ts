import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  upsertCoverageRun,
  getCoverageTrend,
  getCoverageTrendGrouped,
  getCoverageTrendWindowed,
  getCoverageTrendGroupedWindowed,
  getLatestCoverage,
  insertMetric,
  getMetricsTrend,
  getLatestMetric,
} from '../src/lib/db';
import { RANGE_SECONDS } from '../src/lib/timeRanges';
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
  await testEnv.DB.prepare('DELETE FROM metrics').run();
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

describe('upsertCoverageRun — category isolation', () => {
  it('same commit_sha under two categories creates two rows, not a collision', async () => {
    await upsertCoverageRun(testEnv.DB, 1, 'sha-shared', 'main', NOW, {
      category: 'backend',
      line_coverage: 70,
    });
    await upsertCoverageRun(testEnv.DB, 1, 'sha-shared', 'main', NOW, {
      category: 'frontend',
      line_coverage: 40,
    });

    const { results } = await testEnv.DB.prepare(
      `SELECT category, line_coverage FROM coverage_runs WHERE project_id = 1 AND commit_sha = 'sha-shared' ORDER BY category`,
    ).all<{ category: string; line_coverage: number }>();

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ category: 'backend', line_coverage: 70 });
    expect(results[1]).toMatchObject({ category: 'frontend', line_coverage: 40 });
  });

  it('omitting category defaults to "default"', async () => {
    await upsertCoverageRun(testEnv.DB, 1, 'sha-nocat', 'main', NOW, { line_coverage: 55 });

    const row = await testEnv.DB.prepare(
      `SELECT category FROM coverage_runs WHERE project_id = 1 AND commit_sha = 'sha-nocat'`,
    ).first<{ category: string }>();

    expect(row?.category).toBe('default');
  });
});

describe('getCoverageTrend — category filter', () => {
  it('only returns rows for the requested category', async () => {
    await upsertCoverageRun(testEnv.DB, 1, 'sha-be', 'main', NOW, {
      category: 'backend',
      line_coverage: 90,
    });
    await upsertCoverageRun(testEnv.DB, 1, 'sha-fe', 'main', NOW, {
      category: 'frontend',
      line_coverage: 30,
    });

    const backendTrend = await getCoverageTrend(testEnv.DB, 1, 'main', 20, 'backend');
    expect(backendTrend).toHaveLength(1);
    expect(backendTrend[0].line_coverage).toBe(90);

    const frontendTrend = await getCoverageTrend(testEnv.DB, 1, 'main', 20, 'frontend');
    expect(frontendTrend).toHaveLength(1);
    expect(frontendTrend[0].line_coverage).toBe(30);
  });
});

describe('getCoverageTrendGrouped', () => {
  it('returns every category with data, each capped at limit independently', async () => {
    for (let i = 0; i < 5; i++) {
      await upsertCoverageRun(testEnv.DB, 1, `sha-be-${i}`, 'main', NOW - (4 - i) * DAY, {
        category: 'backend',
        line_coverage: 80 + i,
      });
    }
    await upsertCoverageRun(testEnv.DB, 1, 'sha-fe-0', 'main', NOW, {
      category: 'frontend',
      line_coverage: 20,
    });

    const grouped = await getCoverageTrendGrouped(testEnv.DB, 1, 'main', 3);

    const backend = grouped.filter((r) => r.category === 'backend');
    const frontend = grouped.filter((r) => r.category === 'frontend');

    expect(backend).toHaveLength(3);
    expect(backend.at(-1)!.line_coverage).toBe(84); // most recent backend row
    expect(frontend).toHaveLength(1);
    expect(frontend[0].line_coverage).toBe(20);
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

describe('insertMetric — idempotent no-op (A11)', () => {
  it('re-ingesting the same (project, commit, metric) leaves the original value untouched', async () => {
    await insertMetric(testEnv.DB, 1, 'main', 'sha-metric', 'coverage', 70, '%');
    await insertMetric(testEnv.DB, 1, 'main', 'sha-metric', 'coverage', 99, '%');

    const { results } = await testEnv.DB.prepare(
      `SELECT value FROM metrics WHERE project_id = 1 AND commit_sha = 'sha-metric' AND metric_name = 'coverage'`,
    ).all<{ value: number }>();

    expect(results).toHaveLength(1);
    expect(results[0].value).toBe(70);
  });
});

describe('getMetricsTrend', () => {
  it('returns entries ordered most-recent-first, respecting the limit', async () => {
    const stmts = Array.from({ length: 5 }, (_, i) =>
      testEnv.DB.prepare(
        `INSERT INTO metrics (project_id, branch, commit_sha, metric_name, value, unit, recorded_at)
         VALUES (1, 'main', ?, 'coverage', ?, '%', ?)`,
      ).bind(`sha-m${i}`, 50 + i, `2026-01-0${i + 1}`),
    );
    for (const s of stmts) await s.run();

    const trend = await getMetricsTrend(testEnv.DB, 1, 'main', 'coverage', 3);

    expect(trend).toHaveLength(3);
    expect(trend[0].recorded_at).toBe('2026-01-05');
    expect(trend.at(-1)!.recorded_at).toBe('2026-01-03');
  });
});

describe('getLatestMetric', () => {
  it('returns null when no rows exist', async () => {
    const result = await getLatestMetric(testEnv.DB, 1, 'main', 'coverage');
    expect(result).toBeNull();
  });

  it('returns the most recently recorded value', async () => {
    await testEnv.DB.prepare(
      `INSERT INTO metrics (project_id, branch, commit_sha, metric_name, value, unit, recorded_at)
       VALUES (1, 'main', 'sha-old', 'coverage', 40, '%', '2026-01-01'),
              (1, 'main', 'sha-new', 'coverage', 95, '%', '2026-01-10')`,
    ).run();

    const result = await getLatestMetric(testEnv.DB, 1, 'main', 'coverage');
    expect(result?.value).toBe(95);
    expect(result?.commit_sha).toBe('sha-new');
  });
});

describe('getCoverageTrendWindowed — single point, sub-day window', () => {
  it('flat-lines a lone point across the whole window, anchor pinned left / latest pinned right', async () => {
    await upsertCoverageRun(testEnv.DB, 1, 'sha-only', 'main', NOW, { line_coverage: 88.4 });

    const points = await getCoverageTrendWindowed(
      testEnv.DB,
      1,
      'main',
      'default',
      RANGE_SECONDS['15m'],
    );

    expect(points).toHaveLength(2);
    expect(points[0].synthetic).toBe(true);
    expect(points[0].line_coverage).toBe(88.4);
    expect(points[1].synthetic).toBeFalsy();
    expect(points[1].line_coverage).toBe(88.4);
    expect(points[1].commit_sha).toBe('sha-only');
  });

  it('regression guard: anchor and latest timestamps are distinct, not day-collapsed onto one x', async () => {
    await upsertCoverageRun(testEnv.DB, 1, 'sha-only', 'main', NOW, { line_coverage: 50 });

    const points = await getCoverageTrendWindowed(
      testEnv.DB,
      1,
      'main',
      'default',
      RANGE_SECONDS['15m'],
    );

    expect(points).toHaveLength(2);
    const t0 = new Date(points[0].recorded_at).getTime();
    const t1 = new Date(points[1].recorded_at).getTime();
    expect(Number.isNaN(t0)).toBe(false);
    expect(Number.isNaN(t1)).toBe(false);
    expect(t1 - t0).toBe(RANGE_SECONDS['15m'] * 1000);
  });
});

describe('getCoverageTrendWindowed — anchor is the closest prior point, not an average', () => {
  it('uses the nearest row before the window, ignoring older rows further back', async () => {
    await upsertCoverageRun(testEnv.DB, 1, 'sha-latest', 'main', NOW, { line_coverage: 90 });
    await upsertCoverageRun(testEnv.DB, 1, 'sha-2d', 'main', NOW - 2 * DAY, { line_coverage: 70 });
    await upsertCoverageRun(testEnv.DB, 1, 'sha-5d', 'main', NOW - 5 * DAY, { line_coverage: 50 });
    await upsertCoverageRun(testEnv.DB, 1, 'sha-10d', 'main', NOW - 10 * DAY, {
      line_coverage: 30,
    });

    const points = await getCoverageTrendWindowed(
      testEnv.DB,
      1,
      'main',
      'default',
      RANGE_SECONDS['1d'],
    );

    expect(points[0].synthetic).toBe(true);
    // Closest prior row (2 days back) wins — not the average of 70/50/30.
    expect(points[0].line_coverage).toBe(70);
    expect(points.at(-1)!.line_coverage).toBe(90);
  });
});

describe('getCoverageTrendWindowed — 30d window crosses the raw retention boundary', () => {
  it('sources the anchor from coverage_daily once coverage_runs has been pruned', async () => {
    await upsertCoverageRun(testEnv.DB, 1, 'sha-latest', 'main', NOW, { line_coverage: 95 });
    const oldDay = new Date((NOW - 40 * DAY) * 1000).toISOString().slice(0, 10);
    await testEnv.DB.prepare(
      `INSERT INTO coverage_daily (project_id, category, day, line_coverage, run_count)
       VALUES (1, 'default', ?1, 10, 1)`,
    )
      .bind(oldDay)
      .run();

    const points = await getCoverageTrendWindowed(
      testEnv.DB,
      1,
      'main',
      'default',
      RANGE_SECONDS['30d'],
    );

    expect(points[0].synthetic).toBe(true);
    expect(points[0].line_coverage).toBe(10);
    expect(points.at(-1)!.line_coverage).toBe(95);
  });
});

describe('getCoverageTrendGroupedWindowed — align forward-carries stale categories', () => {
  it('shares one right edge across categories and carries a stale series forward to it', async () => {
    await upsertCoverageRun(testEnv.DB, 1, 'sha-be', 'main', NOW, {
      category: 'backend',
      line_coverage: 90,
    });
    await upsertCoverageRun(testEnv.DB, 1, 'sha-fe', 'main', NOW - 10 * DAY, {
      category: 'frontend',
      line_coverage: 60,
    });

    const grouped = await getCoverageTrendGroupedWindowed(
      testEnv.DB,
      1,
      'main',
      RANGE_SECONDS['30d'],
      true,
    );

    const backend = grouped.filter((p) => p.category === 'backend');
    const frontend = grouped.filter((p) => p.category === 'frontend');

    // Both series must reach the same shared right edge (backend's own latest, since it's more recent).
    expect(frontend.at(-1)!.recorded_at).toBe(backend.at(-1)!.recorded_at);
    expect(frontend.at(-1)!.synthetic).toBe(true);
    expect(frontend.at(-1)!.line_coverage).toBe(60);
  });

  it('without align, categories keep their own independent right edges', async () => {
    await upsertCoverageRun(testEnv.DB, 1, 'sha-be', 'main', NOW, {
      category: 'backend',
      line_coverage: 90,
    });
    await upsertCoverageRun(testEnv.DB, 1, 'sha-fe', 'main', NOW - 10 * DAY, {
      category: 'frontend',
      line_coverage: 60,
    });

    const grouped = await getCoverageTrendGroupedWindowed(
      testEnv.DB,
      1,
      'main',
      RANGE_SECONDS['30d'],
      false,
    );

    const backend = grouped.filter((p) => p.category === 'backend');
    const frontend = grouped.filter((p) => p.category === 'frontend');

    expect(frontend.at(-1)!.recorded_at).not.toBe(backend.at(-1)!.recorded_at);
    expect(frontend.at(-1)!.synthetic).toBeFalsy();
  });
});
