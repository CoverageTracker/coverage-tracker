import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index';
import type { Bindings } from '../src/types';

// @ts-expect-error cloudflare:test injects env at runtime
const testEnv = env as Bindings;

beforeEach(async () => {
  await testEnv.DB.prepare(
    `INSERT OR IGNORE INTO owners (id, github_id, login, type) VALUES (1, 1, 'testorg', 'Organization')`,
  ).run();
  await testEnv.DB.prepare(
    `INSERT OR IGNORE INTO projects (id, owner_id, github_repo_id, repo_name, full_slug, installation_id, default_branch)
     VALUES (1, 1, 1, 'repo', 'testorg/repo', 1, 'main')`,
  ).run();
  await testEnv.DB.prepare('UPDATE projects SET badge_enabled = 1 WHERE id = 1').run();
  await testEnv.DB.prepare('DELETE FROM coverage_runs').run();
});

async function getBadge(
  owner: string,
  repo: string,
  metric: string,
  category?: string,
): Promise<Response> {
  const url = new URL(`http://localhost/api/badge/${owner}/${repo}/${metric}.json`);
  if (category !== undefined) url.searchParams.set('category', category);
  return worker.fetch(new Request(url), testEnv as never);
}

async function seedCoverage(
  fields: Partial<{
    line_coverage: number;
    duplication_pct: number;
    cyclomatic: number;
    category: string;
  }>,
): Promise<void> {
  const category = fields.category ?? 'default';
  await testEnv.DB.prepare(
    `INSERT INTO coverage_runs (project_id, commit_sha, branch, category, ran_at, line_coverage, duplication_pct, cyclomatic)
     VALUES (1, ?5, 'main', ?6, ?1, ?2, ?3, ?4)`,
  )
    .bind(
      Math.floor(Date.now() / 1000),
      fields.line_coverage ?? 50,
      fields.duplication_pct ?? null,
      fields.cyclomatic ?? null,
      `sha-badge-${category}`,
      category,
    )
    .run();
}

describe('GET /api/badge/:owner/:repo/:metric.json', () => {
  it('returns 404 when the project does not exist', async () => {
    const res = await getBadge('nope', 'nope', 'coverage');
    expect(res.status).toBe(404);
  });

  it('returns 404 (not 403) when the badge is disabled — A12 privacy control', async () => {
    await testEnv.DB.prepare('UPDATE projects SET badge_enabled = 0 WHERE id = 1').run();
    await seedCoverage({ line_coverage: 90 });
    const res = await getBadge('testorg', 'repo', 'coverage');
    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown metric name', async () => {
    await seedCoverage({ line_coverage: 90 });
    const res = await getBadge('testorg', 'repo', 'not-a-real-metric');
    expect(res.status).toBe(404);
  });

  it('returns 404 when the badge is enabled but there is no coverage data yet', async () => {
    const res = await getBadge('testorg', 'repo', 'coverage');
    expect(res.status).toBe(404);
  });

  it('returns a shields.io-shaped response on success', async () => {
    await seedCoverage({ line_coverage: 87.25 });
    const res = await getBadge('testorg', 'repo', 'coverage');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      schemaVersion: number;
      label: string;
      message: string;
      color: string;
    };
    expect(body.schemaVersion).toBe(1);
    expect(body.label).toBe('coverage');
    expect(body.message).toBe('87.3%');
    expect(body.color).toBe('brightgreen');
  });

  it.each([
    [85, 'brightgreen'],
    [70, 'yellow'],
    [40, 'red'],
  ])('coverage badge color at %d%% is %s', async (value, color) => {
    await seedCoverage({ line_coverage: value });
    const res = await getBadge('testorg', 'repo', 'coverage');
    const body = (await res.json()) as { color: string };
    expect(body.color).toBe(color);
  });

  it.each([
    [2, 'brightgreen'],
    [7, 'yellow'],
    [15, 'red'],
  ])('duplication badge color at %d%% is %s', async (value, color) => {
    await seedCoverage({ line_coverage: 50, duplication_pct: value });
    const res = await getBadge('testorg', 'repo', 'duplication');
    const body = (await res.json()) as { color: string };
    expect(body.color).toBe(color);
  });

  it('defaults to blue for metrics with no color thresholds', async () => {
    await seedCoverage({ line_coverage: 50, cyclomatic: 12 });
    const res = await getBadge('testorg', 'repo', 'cyclomatic');
    const body = (await res.json()) as { color: string; message: string };
    expect(body.color).toBe('blue');
    expect(body.message).toBe('12'); // unitless metric, no % suffix
  });

  it('returns the non-default category value when default and category rows differ', async () => {
    await seedCoverage({ line_coverage: 50 });
    await seedCoverage({ line_coverage: 82.5, category: 'backend' });
    const res = await getBadge('testorg', 'repo', 'coverage', 'backend');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('82.5%');
  });

  it('labels the badge with the category name when non-default', async () => {
    await seedCoverage({ line_coverage: 82.5, category: 'backend' });
    const res = await getBadge('testorg', 'repo', 'coverage', 'backend');
    const body = (await res.json()) as { label: string };
    expect(body.label).toBe('backend coverage');
  });

  it('keeps the plain metric name as the label when category is omitted', async () => {
    await seedCoverage({ line_coverage: 90 });
    const res = await getBadge('testorg', 'repo', 'coverage');
    const body = (await res.json()) as { label: string };
    expect(body.label).toBe('coverage');
  });

  it('keeps the plain metric name as the label when category is explicitly default', async () => {
    await seedCoverage({ line_coverage: 90 });
    const res = await getBadge('testorg', 'repo', 'coverage', 'default');
    const body = (await res.json()) as { label: string };
    expect(body.label).toBe('coverage');
  });

  it('404s for a category with no data even when default has data for that metric', async () => {
    await seedCoverage({ line_coverage: 90 });
    const res = await getBadge('testorg', 'repo', 'coverage', 'frontend');
    expect(res.status).toBe(404);
  });

  it('scopes category filtering to non-coverage metrics too', async () => {
    await seedCoverage({ line_coverage: 50, cyclomatic: 5 });
    await seedCoverage({ line_coverage: 50, cyclomatic: 20, category: 'backend' });
    const defaultRes = await getBadge('testorg', 'repo', 'cyclomatic');
    const backendRes = await getBadge('testorg', 'repo', 'cyclomatic', 'backend');
    expect(((await defaultRes.json()) as { message: string }).message).toBe('5');
    expect(((await backendRes.json()) as { message: string }).message).toBe('20');
  });
});
