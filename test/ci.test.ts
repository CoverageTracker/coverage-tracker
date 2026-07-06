import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index';
import { getLatestCoverageRun } from '../src/lib/db';
import { signOidcJwt, seedOidcJwks } from './helpers/crypto';
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
  await testEnv.DB.prepare('DELETE FROM coverage_runs').run();
  await seedOidcJwks();
});

async function fetchCI(payload: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  return worker.fetch(
    new Request('http://localhost/api/ci/coverage', {
      method: 'POST',
      headers,
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    }),
    testEnv as never,
  );
}

describe('POST /api/ci/coverage', () => {
  it('returns 401 when no Authorization header', async () => {
    const res = await fetchCI({ line_coverage: 95.5 });
    expect(res.status).toBe(401);
  });

  it('returns 401 (OIDC middleware fires before schema validation)', async () => {
    const res = await fetchCI({ branch_coverage: 80 }); // missing required line_coverage
    expect(res.status).toBe(401);
  });

  it('rejects a tag-ref token with 422', async () => {
    const token = await signOidcJwt({ ref_type: 'tag', ref: 'refs/tags/v1.0.0' });
    const res = await fetchCI({ line_coverage: 90 }, token);
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/branch refs/);
  });

  it('rejects an unregistered repository with 403', async () => {
    const token = await signOidcJwt({ repository: 'testorg/unknown-repo' });
    const res = await fetchCI({ line_coverage: 90 }, token);
    expect(res.status).toBe(403);
  });

  it('rejects a non-default-branch push with 422', async () => {
    const token = await signOidcJwt({ ref: 'refs/heads/feature-x' });
    const res = await fetchCI({ line_coverage: 90 }, token);
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/default branch/);
  });

  it('rejects a malformed JSON body with 400', async () => {
    const token = await signOidcJwt({});
    const res = await fetchCI('{not valid json', token);
    expect(res.status).toBe(400);
  });

  it('rejects a schema violation with 422 and an issues array', async () => {
    const token = await signOidcJwt({});
    const res = await fetchCI({ line_coverage: 150 }, token); // out of 0-100 range
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string; issues: unknown[] };
    expect(body.error).toBe('Validation failed');
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it('rejects a body missing the required line_coverage field with 422', async () => {
    const token = await signOidcJwt({});
    const res = await fetchCI({ branch_coverage: 80 }, token);
    expect(res.status).toBe(422);
  });

  it('accepts a valid report and persists it with 202', async () => {
    const token = await signOidcJwt({ sha: 'c'.repeat(40) });
    const res = await fetchCI(
      { line_coverage: 92.5, branch_coverage: 80, cyclomatic: 4 },
      token,
    );
    expect(res.status).toBe(202);

    const row = await getLatestCoverageRun(testEnv.DB, 1, 'main');
    expect(row).not.toBeNull();
    expect(row!.commit_sha).toBe('c'.repeat(40));
    expect(row!.line_coverage).toBe(92.5);
    expect(row!.branch_coverage).toBe(80);
    expect(row!.cyclomatic).toBe(4);
    // Omitted optional fields fall back to null, not undefined/0.
    expect(row!.cognitive).toBeNull();
    expect(row!.duplication_pct).toBeNull();
    expect(row!.maintainability).toBeNull();
  });

  it('is idempotent — re-posting the same commit updates the row in place', async () => {
    const sha = 'd'.repeat(40);
    const token = await signOidcJwt({ sha });

    await fetchCI({ line_coverage: 50 }, token);
    const res2 = await fetchCI({ line_coverage: 99 }, token);
    expect(res2.status).toBe(202);

    const { results } = await testEnv.DB.prepare(
      'SELECT line_coverage FROM coverage_runs WHERE project_id = 1 AND commit_sha = ?',
    )
      .bind(sha)
      .all<{ line_coverage: number }>();
    expect(results).toHaveLength(1);
    expect(results[0].line_coverage).toBe(99);
  });
});
