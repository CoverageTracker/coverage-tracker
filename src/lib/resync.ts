import { getInstallationToken, fetchInstallationRepos, USER_AGENT } from './github';
import { upsertOwner, upsertProject, deleteProjectByRepoId, getProjectsByInstallation } from './db';
import type { Bindings } from '../types';

/**
 * Reconcile the projects table for one installation against GitHub's source of truth.
 *
 * Safe to call multiple times — fully idempotent. Adds repos that are missing,
 * updates metadata that has changed, and removes repos that are no longer in the
 * installation. Called from both /admin/resync and the webhook installation handler.
 */
export async function performResync(installationId: number, env: Bindings): Promise<void> {
  const { token } = await getInstallationToken(
    env.GITHUB_APP_ID,
    env.GITHUB_APP_PRIVATE_KEY,
    installationId,
  );

  // Fetch the installation itself to get owner metadata
  const installationRes = await fetch(
    `https://api.github.com/app/installations/${installationId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': USER_AGENT,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );

  if (!installationRes.ok) {
    throw new Error(`Failed to fetch installation: ${installationRes.status}`);
  }

  const installation = (await installationRes.json()) as {
    account: { id: number; login: string; type: 'User' | 'Organization'; avatar_url: string };
  };

  const { account } = installation;
  const ownerId = await upsertOwner(
    env.DB,
    account.id,
    account.login,
    account.type,
    account.avatar_url,
  );

  const githubRepos = await fetchInstallationRepos(token);
  const githubRepoIds = new Set(githubRepos.map((r) => r.id));

  // Upsert all repos currently in the installation
  for (const repo of githubRepos) {
    await upsertProject(
      env.DB,
      ownerId,
      repo.id,
      repo.name,
      repo.full_name,
      installationId,
      repo.default_branch,
    );
  }

  // Remove any local projects for this installation that GitHub no longer includes
  const localProjects = await getProjectsByInstallation(env.DB, installationId);
  for (const project of localProjects) {
    if (!githubRepoIds.has(project.github_repo_id)) {
      await deleteProjectByRepoId(env.DB, project.github_repo_id);
    }
  }
}
