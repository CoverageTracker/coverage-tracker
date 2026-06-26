import { SignJWT, importPKCS8 } from 'jose';

const GITHUB_API = 'https://api.github.com';
export const USER_AGENT = 'coverage-tracker';

/** Mint a short-lived JWT for authenticating as the GitHub App (valid 10 min). */
async function mintAppJwt(appId: string, privateKeyPem: string): Promise<string> {
  const privateKey = await importPKCS8(privateKeyPem, 'RS256');
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(now - 60) // 60s back-date to handle clock skew
    .setExpirationTime(now + 600)
    .setIssuer(appId)
    .sign(privateKey);
}

export interface InstallationToken {
  token: string;
  expiresAt: string;
}

/** Exchange the App JWT for an installation access token. */
export async function getInstallationToken(
  appId: string,
  privateKeyPem: string,
  installationId: number,
): Promise<InstallationToken> {
  const appJwt = await mintAppJwt(appId, privateKeyPem);

  const res = await fetch(
    `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': USER_AGENT,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );

  if (!res.ok) {
    console.error(`Failed to mint installation token: ${res.status}`, await res.text());
    throw new Error('Failed to mint installation token');
  }

  const data = await res.json() as { token: string; expires_at: string };
  return { token: data.token, expiresAt: data.expires_at };
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  default_branch: string;
}

export interface GitHubInstallation {
  id: number;
  account: {
    id: number;
    login: string;
    type: 'User' | 'Organization';
    avatar_url: string;
  };
}

/** Fetch all repos for an installation (handles pagination). */
export async function fetchInstallationRepos(
  installationToken: string,
): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(
      `${GITHUB_API}/installation/repositories?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${installationToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': USER_AGENT,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );

    if (!res.ok) {
      throw new Error(`Failed to fetch installation repos: ${res.status}`);
    }

    const data = await res.json() as { repositories: GitHubRepo[]; total_count: number };
    repos.push(...data.repositories);

    if (repos.length >= data.total_count) break;
    page++;
  }

  return repos;
}

/** Fetch metadata for a single GitHub repo by its full_name. */
export async function fetchRepoMetadata(
  installationToken: string,
  fullName: string,
): Promise<GitHubRepo> {
  const res = await fetch(`${GITHUB_API}/repos/${fullName}`, {
    headers: {
      Authorization: `Bearer ${installationToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': USER_AGENT,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch repo metadata: ${res.status}`);
  }

  return res.json() as Promise<GitHubRepo>;
}
