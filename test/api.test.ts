import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index';
import type { Bindings } from '../src/types';

// @ts-expect-error cloudflare:test injects env at runtime
const testEnv = env as Bindings;

beforeEach(async () => {
  // ENVIRONMENT is declared as a var in wrangler.json env.dev, but the test pool uses
  // the top-level config so it isn't exposed as a binding — inject it directly, as
  // test/routing.test.ts does, so requireAccess() takes the local-dev bypass.
  (testEnv as Record<string, unknown>).ENVIRONMENT = 'development';

  await testEnv.DB.prepare(
    `INSERT OR IGNORE INTO owners (id, github_id, login, type) VALUES (1, 1, 'testorg', 'Organization')`,
  ).run();
  await testEnv.DB.prepare(
    `INSERT OR IGNORE INTO projects (id, owner_id, github_repo_id, repo_name, full_slug, installation_id, default_branch)
     VALUES (1, 1, 1, 'repo', 'testorg/repo', 1, 'main')`,
  ).run();
  await testEnv.DB.prepare('DELETE FROM coverage_runs').run();
});

afterEach(() => {
  delete (testEnv as Record<string, unknown>).ENVIRONMENT;
});

function get(path: string): Promise<Response> {
  return worker.fetch(new Request(`http://localhost${path}`), testEnv as never);
}

describe('GET /api/projects', () => {
  it('lists projects with owner metadata attached', async () => {
    await testEnv.DB.prepare(
      `INSERT OR IGNORE INTO owners (id, github_id, login, type) VALUES (2, 2, 'anotherorg', 'User')`,
    ).run();
    await testEnv.DB.prepare(
      `INSERT OR IGNORE INTO projects (id, owner_id, github_repo_id, repo_name, full_slug, installation_id, default_branch)
       VALUES (2, 2, 2, 'repo2', 'anotherorg/repo2', 2, 'main')`,
    ).run();

    const res = await get('/api/projects');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      full_slug: string;
      owner_login: string;
      owner_type: string;
    }>;

    const slugs = body.map((p) => p.full_slug);
    expect(slugs).toContain('testorg/repo');
    expect(slugs).toContain('anotherorg/repo2');

    const mine = body.find((p) => p.full_slug === 'testorg/repo');
    expect(mine?.owner_login).toBe('testorg');
    expect(mine?.owner_type).toBe('Organization');
  });
});

describe('GET /api/projects/:owner/:repo/metrics', () => {
  it('returns 404 for an unregistered project', async () => {
    const res = await get('/api/projects/nobody/nothing/metrics');
    expect(res.status).toBe(404);
  });

  it('returns 400 for an unknown metric', async () => {
    const res = await get('/api/projects/testorg/repo/metrics?metric=not-a-metric');
    expect(res.status).toBe(400);
  });

  it('returns trend data using the project default branch and coverage metric by default', async () => {
    const now = Math.floor(Date.now() / 1000);
    await testEnv.DB.prepare(
      `INSERT INTO coverage_runs (project_id, commit_sha, branch, ran_at, line_coverage)
       VALUES (1, 'sha-1', 'main', ?1, 80),
              (1, 'sha-2', 'main', ?2, 90)`,
    )
      .bind(now - 86400, now)
      .run();

    const res = await get('/api/projects/testorg/repo/metrics');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      project: string;
      branch: string;
      metric: string;
      data: Array<{ commit_sha: string; value: number; unit: string }>;
    };
    expect(body.project).toBe('testorg/repo');
    expect(body.branch).toBe('main');
    expect(body.metric).toBe('coverage');
    expect(body.data).toHaveLength(2);
    expect(body.data.at(-1)).toMatchObject({ commit_sha: 'sha-2', value: 90, unit: '%' });
  });

  it('clamps an oversized limit query param instead of erroring', async () => {
    const now = Math.floor(Date.now() / 1000);
    await testEnv.DB.prepare(
      `INSERT INTO coverage_runs (project_id, commit_sha, branch, ran_at, line_coverage)
       VALUES (1, 'sha-a', 'main', ?1, 10), (1, 'sha-b', 'main', ?2, 20)`,
    )
      .bind(now - 86400, now)
      .run();

    // Math.min(Number(limit), 1000) — a limit far past the cap must not error or
    // attempt to over-fetch; it just can't return more rows than exist.
    const res = await get('/api/projects/testorg/repo/metrics?limit=999999');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(2);
  });

  it('honors a small limit query param', async () => {
    const now = Math.floor(Date.now() / 1000);
    await testEnv.DB.prepare(
      `INSERT INTO coverage_runs (project_id, commit_sha, branch, ran_at, line_coverage)
       VALUES (1, 'sha-a', 'main', ?1, 10), (1, 'sha-b', 'main', ?2, 20)`,
    )
      .bind(now - 86400, now)
      .run();

    const res = await get('/api/projects/testorg/repo/metrics?limit=1');
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it('only returns rows for an explicitly requested category', async () => {
    const now = Math.floor(Date.now() / 1000);
    await testEnv.DB.prepare(
      `INSERT INTO coverage_runs (project_id, commit_sha, branch, category, ran_at, line_coverage)
       VALUES (1, 'sha-be', 'main', 'backend', ?1, 90),
              (1, 'sha-fe', 'main', 'frontend', ?1, 30)`,
    )
      .bind(now)
      .run();

    const res = await get('/api/projects/testorg/repo/metrics?category=frontend');
    const body = (await res.json()) as { data: Array<{ value: number }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].value).toBe(30);
  });
});

describe('GET /api/projects/:owner/:repo/metrics/categories', () => {
  it('returns 404 for an unregistered project', async () => {
    const res = await get('/api/projects/nobody/nothing/metrics/categories');
    expect(res.status).toBe(404);
  });

  it('groups trend data by category with independent latest values', async () => {
    const now = Math.floor(Date.now() / 1000);
    await testEnv.DB.prepare(
      `INSERT INTO coverage_runs (project_id, commit_sha, branch, category, ran_at, line_coverage)
       VALUES (1, 'sha-be', 'main', 'backend', ?1, 92),
              (1, 'sha-fe', 'main', 'frontend', ?1, 55)`,
    )
      .bind(now)
      .run();

    const res = await get('/api/projects/testorg/repo/metrics/categories');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      categories: Array<{ category: string; data: Array<{ value: number }> }>;
    };

    expect(body.categories.map((c) => c.category)).toEqual(['backend', 'frontend']);
    expect(body.categories.find((c) => c.category === 'backend')!.data[0].value).toBe(92);
    expect(body.categories.find((c) => c.category === 'frontend')!.data[0].value).toBe(55);
  });

  it('returns 422 for an unknown range value', async () => {
    const res = await get('/api/projects/testorg/repo/metrics/categories?range=3weeks');
    expect(res.status).toBe(422);
  });

  it('returns an edge-anchored, full-width series when range is given', async () => {
    const now = Math.floor(Date.now() / 1000);
    await testEnv.DB.prepare(
      `INSERT INTO coverage_runs (project_id, commit_sha, branch, ran_at, line_coverage)
       VALUES (1, 'sha-only', 'main', ?1, 77)`,
    )
      .bind(now)
      .run();

    const res = await get('/api/projects/testorg/repo/metrics/categories?range=15m');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      categories: Array<{
        category: string;
        data: Array<{ value: number; recorded_at: string; synthetic?: boolean }>;
      }>;
    };

    const defaultCat = body.categories.find((c) => c.category === 'default')!;
    expect(defaultCat.data).toHaveLength(2);
    expect(defaultCat.data[0].synthetic).toBe(true);
    expect(defaultCat.data[0].value).toBe(77);
    expect(defaultCat.data[1].value).toBe(77);
    expect(defaultCat.data[0].recorded_at).not.toBe(defaultCat.data[1].recorded_at);
  });
});
