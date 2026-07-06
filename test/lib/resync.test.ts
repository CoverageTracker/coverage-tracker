import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { performResync } from '../../src/lib/resync';
import { getTestAppPrivateKeyPem } from '../helpers/crypto';
import { FAILING_ACCESS_TOKEN_INSTALLATION_ID } from '../helpers/outbound';
import type { Bindings } from '../../src/types';

// @ts-expect-error cloudflare:test injects env at runtime
const testEnv = env as Bindings;

beforeEach(async () => {
  testEnv.GITHUB_APP_ID = 'test-app-id';
  testEnv.GITHUB_APP_PRIVATE_KEY = getTestAppPrivateKeyPem();
  // Projects/owners persist across `it`s within a file (no per-test D1 reset), so
  // without clearing here, later tests' seeded "stale" rows would collide on the
  // UNIQUE keys created by an earlier test's performResync() and be silently
  // ignored by INSERT OR IGNORE, making assertions pass without exercising the
  // path they claim to.
  await testEnv.DB.prepare('DELETE FROM projects').run();
  await testEnv.DB.prepare('DELETE FROM owners').run();
});

describe('performResync', () => {
  it('adds repos that are missing locally', async () => {
    const owner = await testEnv.DB.prepare('SELECT * FROM owners WHERE github_id = 100').first();
    expect(owner).toBeNull(); // sanity: nothing seeded yet for this installation

    await performResync(100, testEnv);

    const repoA = await testEnv.DB.prepare('SELECT * FROM projects WHERE github_repo_id = 1001').first<{
      full_slug: string;
      default_branch: string;
      installation_id: number;
    }>();
    expect(repoA?.full_slug).toBe('fixture-org/repo-a');
    expect(repoA?.default_branch).toBe('main');
    expect(repoA?.installation_id).toBe(100);

    const repoB = await testEnv.DB.prepare('SELECT * FROM projects WHERE github_repo_id = 1002').first<{
      default_branch: string;
    }>();
    expect(repoB?.default_branch).toBe('develop');
  });

  it('updates metadata for repos that already exist locally', async () => {
    await testEnv.DB.prepare(
      `INSERT OR IGNORE INTO owners (id, github_id, login, type) VALUES (910, 100, 'stale-login', 'Organization')`,
    ).run();
    await testEnv.DB.prepare(
      `INSERT OR IGNORE INTO projects (owner_id, github_repo_id, repo_name, full_slug, installation_id, default_branch)
       VALUES (910, 1001, 'stale-name', 'stale-org/stale-name', 100, 'stale-branch')`,
    ).run();

    await performResync(100, testEnv);

    const repoA = await testEnv.DB.prepare('SELECT * FROM projects WHERE github_repo_id = 1001').first<{
      full_slug: string;
      default_branch: string;
    }>();
    expect(repoA?.full_slug).toBe('fixture-org/repo-a');
    expect(repoA?.default_branch).toBe('main');

    const owner = await testEnv.DB.prepare('SELECT login FROM owners WHERE github_id = 100').first<{
      login: string;
    }>();
    expect(owner?.login).toBe('fixture-org');
  });

  it('removes local projects that GitHub no longer reports for the installation', async () => {
    await testEnv.DB.prepare(
      `INSERT OR IGNORE INTO owners (id, github_id, login, type) VALUES (911, 102, 'empty-org', 'Organization')`,
    ).run();
    await testEnv.DB.prepare(
      `INSERT OR IGNORE INTO projects (owner_id, github_repo_id, repo_name, full_slug, installation_id, default_branch)
       VALUES (911, 88888, 'orphan', 'empty-org/orphan', 102, 'main')`,
    ).run();

    await performResync(102, testEnv);

    const orphan = await testEnv.DB.prepare('SELECT * FROM projects WHERE github_repo_id = 88888').first();
    expect(orphan).toBeNull();
  });

  it('throws when the GitHub API call fails', async () => {
    await expect(performResync(FAILING_ACCESS_TOKEN_INSTALLATION_ID, testEnv)).rejects.toThrow();
  });
});
