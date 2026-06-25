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
});

async function fetchCI(payload: unknown): Promise<Response> {
  return worker.fetch(
    new Request('http://localhost/api/ci/coverage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
});
