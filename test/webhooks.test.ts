import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index';
import { signWebhookBody, getTestAppPrivateKeyPem } from './helpers/crypto';
import { FAILING_ACCESS_TOKEN_INSTALLATION_ID } from './helpers/outbound';
import type { Bindings } from '../src/types';

// @ts-expect-error cloudflare:test injects env at runtime
const testEnv = env as Bindings;

beforeEach(() => {
  testEnv.GITHUB_WEBHOOK_SECRET = 'test-webhook-secret';
  testEnv.GITHUB_APP_ID = 'test-app-id';
  testEnv.GITHUB_APP_PRIVATE_KEY = getTestAppPrivateKeyPem();
});

async function postWebhookEvent(
  event: string,
  payload: unknown,
  deliveryId: string,
): Promise<Response> {
  const body = JSON.stringify(payload);
  const signature = await signWebhookBody(testEnv.GITHUB_WEBHOOK_SECRET, body);
  return worker.fetch(
    new Request('http://localhost/api/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': event,
        'X-GitHub-Delivery': deliveryId,
        'X-Hub-Signature-256': signature,
      },
      body,
    }),
    testEnv as never,
  );
}

async function getOwnerByGithubId(githubId: number) {
  return testEnv.DB.prepare('SELECT * FROM owners WHERE github_id = ?').bind(githubId).first();
}

async function getProjectByRepoId(githubRepoId: number) {
  return testEnv.DB.prepare('SELECT * FROM projects WHERE github_repo_id = ?')
    .bind(githubRepoId)
    .first<{
      full_slug: string;
      default_branch: string;
      installation_id: number;
    }>();
}

describe('POST /api/webhooks/github', () => {
  it('installation created: upserts the owner and each repo with resolved default_branch', async () => {
    const res = await postWebhookEvent(
      'installation',
      {
        action: 'created',
        installation: {
          id: 42,
          account: {
            id: 555,
            login: 'neworg',
            type: 'Organization',
            avatar_url: 'https://example.com/x.png',
          },
        },
        repositories: [
          { id: 7001, name: 'alpha', full_name: 'neworg/alpha' },
          { id: 7002, name: 'beta-devbranch', full_name: 'neworg/beta-devbranch' },
        ],
      },
      'd-install-created',
    );
    expect(res.status).toBe(200);

    const owner = await getOwnerByGithubId(555);
    expect(owner).not.toBeNull();

    const alpha = await getProjectByRepoId(7001);
    expect(alpha?.full_slug).toBe('neworg/alpha');
    expect(alpha?.default_branch).toBe('main');
    expect(alpha?.installation_id).toBe(42);

    const beta = await getProjectByRepoId(7002);
    expect(beta?.default_branch).toBe('develop');
  });

  it('installation deleted: removes all projects for that installation', async () => {
    await testEnv.DB.prepare(
      `INSERT OR IGNORE INTO owners (id, github_id, login, type) VALUES (900, 900, 'delorg', 'Organization')`,
    ).run();
    await testEnv.DB.prepare(
      `INSERT OR IGNORE INTO projects (owner_id, github_repo_id, repo_name, full_slug, installation_id, default_branch)
       VALUES (900, 9001, 'gone', 'delorg/gone', 77, 'main')`,
    ).run();

    const res = await postWebhookEvent(
      'installation',
      { action: 'deleted', installation: { id: 77 } },
      'd-install-deleted',
    );
    expect(res.status).toBe(200);

    const project = await getProjectByRepoId(9001);
    expect(project).toBeNull();
  });

  it('installation_repositories added: upserts newly added repos', async () => {
    const res = await postWebhookEvent(
      'installation_repositories',
      {
        action: 'added',
        installation: {
          id: 43,
          account: {
            id: 556,
            login: 'addorg',
            type: 'User',
            avatar_url: 'https://example.com/y.png',
          },
        },
        repositories_added: [{ id: 7101, name: 'gamma', full_name: 'addorg/gamma' }],
      },
      'd-repos-added',
    );
    expect(res.status).toBe(200);

    const project = await getProjectByRepoId(7101);
    expect(project?.full_slug).toBe('addorg/gamma');
  });

  it('installation_repositories removed: deletes the removed repos', async () => {
    await testEnv.DB.prepare(
      `INSERT OR IGNORE INTO owners (id, github_id, login, type) VALUES (901, 901, 'remorg', 'Organization')`,
    ).run();
    await testEnv.DB.prepare(
      `INSERT OR IGNORE INTO projects (owner_id, github_repo_id, repo_name, full_slug, installation_id, default_branch)
       VALUES (901, 8001, 'leaving', 'remorg/leaving', 44, 'main')`,
    ).run();

    const res = await postWebhookEvent(
      'installation_repositories',
      {
        action: 'removed',
        installation: {
          id: 44,
          account: { id: 901, login: 'remorg', type: 'Organization', avatar_url: '' },
        },
        repositories_removed: [{ id: 8001, name: 'leaving', full_name: 'remorg/leaving' }],
      },
      'd-repos-removed',
    );
    expect(res.status).toBe(200);

    const project = await getProjectByRepoId(8001);
    expect(project).toBeNull();
  });

  it('ignores an unexpected account.type without writing any rows', async () => {
    const res = await postWebhookEvent(
      'installation',
      {
        action: 'created',
        installation: {
          id: 45,
          account: { id: 557, login: 'bot-account', type: 'Bot', avatar_url: '' },
        },
        repositories: [{ id: 7201, name: 'ignored', full_name: 'bot-account/ignored' }],
      },
      'd-bad-account-type',
    );
    expect(res.status).toBe(200);

    const owner = await getOwnerByGithubId(557);
    expect(owner).toBeNull();
    const project = await getProjectByRepoId(7201);
    expect(project).toBeNull();
  });

  it('acknowledges an unrecognized event with 200 and no side effects', async () => {
    const res = await postWebhookEvent('ping', { zen: 'test' }, 'd-ping');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('returns 200 even when the downstream handler throws', async () => {
    const res = await postWebhookEvent(
      'installation',
      {
        action: 'created',
        installation: {
          id: FAILING_ACCESS_TOKEN_INSTALLATION_ID,
          account: { id: 558, login: 'failorg', type: 'Organization', avatar_url: '' },
        },
        repositories: [{ id: 7301, name: 'never-created', full_name: 'failorg/never-created' }],
      },
      'd-handler-throws',
    );
    expect(res.status).toBe(200);

    const project = await getProjectByRepoId(7301);
    expect(project).toBeNull();
  });

  it('rejects a replayed delivery id with 409', async () => {
    const payload = {
      action: 'created',
      installation: { id: 46, account: { id: 559, login: 'x', type: 'User', avatar_url: '' } },
      repositories: [],
    };
    const first = await postWebhookEvent('installation', payload, 'd-replay-wh');
    expect(first.status).toBe(200);

    const replay = await postWebhookEvent('installation', payload, 'd-replay-wh');
    expect(replay.status).toBe(409);
  });
});
