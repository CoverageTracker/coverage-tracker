import { Hono } from 'hono';
import { requireWebhookHmac } from '../middleware/webhook';
import { upsertOwner, upsertProject, deleteProjectsByInstallation, deleteProjectByRepoId } from '../lib/db';
import { getInstallationToken, fetchRepoMetadata } from '../lib/github';
import type { Bindings, Variables } from '../types';

const webhooks = new Hono<{ Bindings: Bindings; Variables: Variables }>();

webhooks.post('/github', requireWebhookHmac(), async (c) => {
  const event = c.req.header('X-GitHub-Event');
  // rawBody was stored by requireWebhookHmac() after signature verification
  const rawBody = c.get('rawBody');
  const payload = JSON.parse(rawBody) as Record<string, unknown>;

  try {
    if (event === 'installation') {
      await handleInstallation(payload, c.env);
    } else if (event === 'installation_repositories') {
      await handleInstallationRepositories(payload, c.env);
    }
    // Unrecognised events are acknowledged and ignored
  } catch (err) {
    console.error('Webhook handler error:', err);
  }

  return c.json({ ok: true });
});

// --- handlers ---

interface InstallationAccount {
  id: number;
  login: string;
  type: 'User' | 'Organization';
  avatar_url: string;
}

interface WebhookRepo {
  id: number;
  name: string;
  full_name: string;
}

async function handleInstallation(payload: Record<string, unknown>, env: Bindings): Promise<void> {
  const action = payload.action as string;
  const installation = payload.installation as { id: number; account: InstallationAccount };
  const installationId = installation.id;

  if (action === 'deleted') {
    await deleteProjectsByInstallation(env.DB, installationId);
    return;
  }

  if (action === 'created') {
    const { account } = installation;
    if (account.type !== 'User' && account.type !== 'Organization') {
      console.error(`Unexpected account type in installation payload: ${account.type}`);
      return;
    }
    const ownerId = await upsertOwner(env.DB, account.id, account.login, account.type, account.avatar_url);

    const repos = (payload.repositories as WebhookRepo[] | undefined) ?? [];
    const instToken = await getInstallationToken(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY, installationId);

    for (const repo of repos) {
      // Fetch full metadata (including default_branch) for each repo
      const meta = await fetchRepoMetadata(instToken.token, repo.full_name);
      await upsertProject(env.DB, ownerId, repo.id, repo.name, repo.full_name, installationId, meta.default_branch);
    }
  }
  // Other actions (suspend, unsuspend, new_permissions_accepted) are acknowledged and ignored
}

async function handleInstallationRepositories(
  payload: Record<string, unknown>,
  env: Bindings,
): Promise<void> {
  const action = payload.action as string;
  const installation = payload.installation as { id: number; account: InstallationAccount };
  const installationId = installation.id;
  const { account } = installation;

  if (action === 'added') {
    if (account.type !== 'User' && account.type !== 'Organization') {
      console.error(`Unexpected account type in installation_repositories payload: ${account.type}`);
      return;
    }
    const ownerId = await upsertOwner(env.DB, account.id, account.login, account.type, account.avatar_url);
    const added = (payload.repositories_added as WebhookRepo[]) ?? [];
    const instToken = await getInstallationToken(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY, installationId);

    for (const repo of added) {
      const meta = await fetchRepoMetadata(instToken.token, repo.full_name);
      await upsertProject(env.DB, ownerId, repo.id, repo.name, repo.full_name, installationId, meta.default_branch);
    }
  } else if (action === 'removed') {
    const removed = (payload.repositories_removed as WebhookRepo[]) ?? [];
    for (const repo of removed) {
      await deleteProjectByRepoId(env.DB, repo.id);
    }
  }
}

export default webhooks;
