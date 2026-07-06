import { describe, it, expect } from 'vitest';
import { getInstallationToken, fetchInstallationRepos, fetchRepoMetadata } from '../../src/lib/github';
import { getTestAppPrivateKeyPem } from '../helpers/crypto';
import { FAILING_ACCESS_TOKEN_INSTALLATION_ID, NOT_FOUND_REPO_FULL_NAME } from '../helpers/outbound';

describe('getInstallationToken', () => {
  it('mints a token for a valid installation', async () => {
    const { token, expiresAt } = await getInstallationToken('test-app-id', getTestAppPrivateKeyPem(), 100);
    expect(token).toBe('mock-token-100');
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('throws when GitHub fails to mint the token', async () => {
    await expect(
      getInstallationToken('test-app-id', getTestAppPrivateKeyPem(), FAILING_ACCESS_TOKEN_INSTALLATION_ID),
    ).rejects.toThrow(/Failed to mint installation token/);
  });
});

describe('fetchInstallationRepos', () => {
  it('returns all repos across a single page', async () => {
    const repos = await fetchInstallationRepos('mock-token-100');
    expect(repos).toHaveLength(2);
    expect(repos.map((r) => r.full_name)).toEqual(['fixture-org/repo-a', 'fixture-org/repo-b']);
  });

  it('follows pagination across multiple pages', async () => {
    const repos = await fetchInstallationRepos('mock-token-101');
    expect(repos).toHaveLength(150);
    // Unique ids across both pages — no duplication or truncation at the page boundary.
    expect(new Set(repos.map((r) => r.id)).size).toBe(150);
  });

  it('throws when the installation repos request fails', async () => {
    await expect(fetchInstallationRepos('mock-token-nonexistent')).rejects.toThrow(
      /Failed to fetch installation repos/,
    );
  });
});

describe('fetchRepoMetadata', () => {
  it('resolves default_branch for a repo', async () => {
    const meta = await fetchRepoMetadata('mock-token-100', 'fixture-org/repo-a');
    expect(meta.full_name).toBe('fixture-org/repo-a');
    expect(meta.default_branch).toBe('main');
  });

  it('resolves a develop default branch by the -devbranch naming convention', async () => {
    const meta = await fetchRepoMetadata('mock-token-100', 'fixture-org/repo-devbranch');
    expect(meta.default_branch).toBe('develop');
  });

  it('throws when the repo is not found', async () => {
    await expect(fetchRepoMetadata('mock-token-100', NOT_FOUND_REPO_FULL_NAME)).rejects.toThrow(
      /Failed to fetch repo metadata/,
    );
  });
});
