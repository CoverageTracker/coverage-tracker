import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index';
import { getTestAppPrivateKeyPem } from './helpers/crypto';
import { FAILING_ACCESS_TOKEN_INSTALLATION_ID } from './helpers/outbound';
import type { Bindings } from '../src/types';

// @ts-expect-error cloudflare:test injects env at runtime
const testEnv = env as Bindings;

beforeEach(() => {
  // ENVIRONMENT is declared as a var in wrangler.json env.dev, but the test pool uses
  // the top-level config so it isn't exposed as a binding — inject it directly, as
  // test/routing.test.ts does, so requireAccess() takes the local-dev bypass.
  (testEnv as Record<string, unknown>).ENVIRONMENT = 'development';
  testEnv.GITHUB_APP_ID = 'test-app-id';
  testEnv.GITHUB_APP_PRIVATE_KEY = getTestAppPrivateKeyPem();
});

afterEach(() => {
  delete (testEnv as Record<string, unknown>).ENVIRONMENT;
});

function postJson(path: string, body: unknown): Promise<Response> {
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    testEnv as never,
  );
}

function patchJson(path: string, body: unknown): Promise<Response> {
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    testEnv as never,
  );
}

describe('POST /api/admin/resync', () => {
  it('returns 400 for an invalid JSON body', async () => {
    const res = await worker.fetch(
      new Request('http://localhost/api/admin/resync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      }),
      testEnv as never,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for a non-integer installationId', async () => {
    const res = await postJson('/api/admin/resync', { installationId: 'abc' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for a negative installationId', async () => {
    const res = await postJson('/api/admin/resync', { installationId: -5 });
    expect(res.status).toBe(400);
  });

  it('returns 502 when the resync fails', async () => {
    const res = await postJson('/api/admin/resync', { installationId: FAILING_ACCESS_TOKEN_INSTALLATION_ID });
    expect(res.status).toBe(502);
  });

  it('resyncs projects to match the GitHub fixture state', async () => {
    const res = await postJson('/api/admin/resync', { installationId: 100 });
    expect(res.status).toBe(200);

    const owner = await testEnv.DB.prepare('SELECT * FROM owners WHERE github_id = 100').first();
    expect(owner).not.toBeNull();

    const repoA = await testEnv.DB.prepare('SELECT * FROM projects WHERE github_repo_id = 1001').first<{
      full_slug: string;
      default_branch: string;
    }>();
    expect(repoA?.full_slug).toBe('fixture-org/repo-a');
    expect(repoA?.default_branch).toBe('main');

    const repoB = await testEnv.DB.prepare('SELECT * FROM projects WHERE github_repo_id = 1002').first<{
      default_branch: string;
    }>();
    expect(repoB?.default_branch).toBe('develop');
  });

  it('removes local projects that GitHub no longer reports for the installation', async () => {
    await testEnv.DB.prepare(
      `INSERT OR IGNORE INTO owners (id, github_id, login, type) VALUES (902, 102, 'empty-org', 'Organization')`,
    ).run();
    await testEnv.DB.prepare(
      `INSERT OR IGNORE INTO projects (owner_id, github_repo_id, repo_name, full_slug, installation_id, default_branch)
       VALUES (902, 99999, 'stale', 'empty-org/stale', 102, 'main')`,
    ).run();

    const res = await postJson('/api/admin/resync', { installationId: 102 });
    expect(res.status).toBe(200);

    const stale = await testEnv.DB.prepare('SELECT * FROM projects WHERE github_repo_id = 99999').first();
    expect(stale).toBeNull();
  });
});

describe('PATCH /api/admin/projects/:id/badge', () => {
  beforeEach(async () => {
    await testEnv.DB.prepare(
      `INSERT OR IGNORE INTO owners (id, github_id, login, type) VALUES (2, 2, 'badgeorg', 'Organization')`,
    ).run();
    await testEnv.DB.prepare(
      `INSERT OR IGNORE INTO projects (id, owner_id, github_repo_id, repo_name, full_slug, installation_id, default_branch)
       VALUES (2, 2, 2, 'repo2', 'badgeorg/repo2', 2, 'main')`,
    ).run();
  });

  it('returns 400 for a non-integer project id', async () => {
    const res = await patchJson('/api/admin/projects/abc/badge', { enabled: true });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the project does not exist', async () => {
    const res = await patchJson('/api/admin/projects/999999/badge', { enabled: true });
    expect(res.status).toBe(404);
  });

  it('returns 400 for an invalid JSON body', async () => {
    const res = await worker.fetch(
      new Request('http://localhost/api/admin/projects/2/badge', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      }),
      testEnv as never,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when enabled is not a boolean', async () => {
    const res = await patchJson('/api/admin/projects/2/badge', { enabled: 'yes' });
    expect(res.status).toBe(400);
  });

  it('toggles the badge and persists it', async () => {
    const res = await patchJson('/api/admin/projects/2/badge', { enabled: true });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; badge_enabled: boolean };
    expect(body.badge_enabled).toBe(true);

    const row = await testEnv.DB.prepare('SELECT badge_enabled FROM projects WHERE id = 2').first<{
      badge_enabled: number;
    }>();
    expect(row?.badge_enabled).toBe(1);
  });
});
