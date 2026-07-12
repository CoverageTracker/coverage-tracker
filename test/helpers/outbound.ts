import type { JWK } from 'jose';
import { OIDC_JWKS_URL, OIDC_KID } from './constants';

/**
 * Fake GitHub REST API + JWKS server, wired up as Miniflare's `outboundService`
 * (see vitest.config.mts). `fetchMock` from `cloudflare:test` isn't exported by
 * the installed @cloudflare/vitest-pool-workers version, so outbound fetches
 * from the worker under test are intercepted here instead, at the network
 * level, in the Node host process.
 *
 * Because this runs in a different module realm than the test files (which run
 * inside the workerd isolate), it can't hold per-test mutable state set from a
 * test — everything here must be derivable purely from the request itself.
 * Installation-scoped fixtures are selected by encoding the installation id
 * into the installation-token string minted here (`mock-token-<id>`), then
 * recovering it from the `Authorization` header on later calls.
 */

export interface FixtureAccount {
  id: number;
  login: string;
  type: 'User' | 'Organization';
  avatar_url: string;
}

export interface FixtureRepo {
  id: number;
  name: string;
  full_name: string;
  default_branch: string;
}

interface InstallationFixture {
  account: FixtureAccount;
  repos: FixtureRepo[];
}

function repos(count: number, prefix: string): FixtureRepo[] {
  return Array.from({ length: count }, (_, i) => ({
    id: 5000 + i,
    name: `${prefix}-${i}`,
    full_name: `fixture-org/${prefix}-${i}`,
    default_branch: 'main',
  }));
}

/** installationId -> fixture data for /app/installations/:id and /installation/repositories */
export const FIXTURE_INSTALLATIONS: Record<number, InstallationFixture> = {
  100: {
    account: {
      id: 100,
      login: 'fixture-org',
      type: 'Organization',
      avatar_url: 'https://example.com/a.png',
    },
    repos: [
      { id: 1001, name: 'repo-a', full_name: 'fixture-org/repo-a', default_branch: 'main' },
      { id: 1002, name: 'repo-b', full_name: 'fixture-org/repo-b', default_branch: 'develop' },
    ],
  },
  // Pagination: 150 repos spans two pages of 100 + 50 at the hardcoded per_page=100.
  101: {
    account: {
      id: 101,
      login: 'big-org',
      type: 'Organization',
      avatar_url: 'https://example.com/b.png',
    },
    repos: repos(150, 'repo'),
  },
  // No repos left — exercises performResync's "remove local projects GitHub no longer has" path.
  102: {
    account: {
      id: 102,
      login: 'empty-org',
      type: 'Organization',
      avatar_url: 'https://example.com/c.png',
    },
    repos: [],
  },
};

/** installationId that fails to mint an access token (POST access_tokens -> 500). */
export const FAILING_ACCESS_TOKEN_INSTALLATION_ID = 599;
/** installationId with a valid token but no matching installation record (GET /app/installations/:id -> 404). */
export const MISSING_INSTALLATION_ID = 699;
/** full_name that fetchRepoMetadata resolves to a 404, for webhook/resync failure-path tests. */
export const NOT_FOUND_REPO_FULL_NAME = 'fixture-org/does-not-exist';

function installationIdFromAuth(request: Request): number | null {
  const auth = request.headers.get('Authorization');
  const match = auth?.match(/^Bearer mock-token-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * `oidcJwk` is passed in (rather than read via crypto.ts's inject()-based
 * jwksFor()) because this function is invoked from vitest.config.mts's plugin
 * options callback, a different call context than test files — only the
 * `ctx.inject` reference handed to that callback is guaranteed to resolve
 * provide()d values there.
 */
export async function githubOutboundService(request: Request, oidcJwk: JWK): Promise<Response> {
  const url = new URL(request.url);

  if (url.href === OIDC_JWKS_URL) {
    return json({ keys: [{ ...oidcJwk, kid: OIDC_KID, alg: 'RS256', use: 'sig' }] });
  }

  let match: RegExpMatchArray | null;

  match = url.pathname.match(/^\/app\/installations\/(\d+)\/access_tokens$/);
  if (match && request.method === 'POST') {
    const id = Number(match[1]);
    if (id === FAILING_ACCESS_TOKEN_INSTALLATION_ID) return json({ message: 'Server error' }, 500);
    return json({
      token: `mock-token-${id}`,
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });
  }

  match = url.pathname.match(/^\/app\/installations\/(\d+)$/);
  if (match && request.method === 'GET') {
    const id = Number(match[1]);
    if (id === MISSING_INSTALLATION_ID) return json({ message: 'Not Found' }, 404);
    const fixture = FIXTURE_INSTALLATIONS[id];
    if (!fixture) return json({ message: 'Not Found' }, 404);
    return json({ id, account: fixture.account });
  }

  if (url.pathname === '/installation/repositories' && request.method === 'GET') {
    const id = installationIdFromAuth(request);
    const fixture = id != null ? FIXTURE_INSTALLATIONS[id] : undefined;
    if (!fixture) return json({ message: 'Not Found' }, 404);

    const perPage = Number(url.searchParams.get('per_page') ?? '100');
    const page = Number(url.searchParams.get('page') ?? '1');
    const start = (page - 1) * perPage;
    return json({
      repositories: fixture.repos.slice(start, start + perPage),
      total_count: fixture.repos.length,
    });
  }

  match = url.pathname.match(/^\/repos\/(.+)$/);
  if (match && request.method === 'GET') {
    const fullName = decodeURIComponent(match[1]);
    if (fullName === NOT_FOUND_REPO_FULL_NAME) return json({ message: 'Not Found' }, 404);
    const name = fullName.split('/')[1] ?? fullName;
    // Convention for tests that need a non-'main' default branch: name ends with '-devbranch'.
    const default_branch = name.endsWith('-devbranch') ? 'develop' : 'main';
    return json({ id: 9_000_000, name, full_name: fullName, default_branch });
  }

  console.error(`Unhandled outbound fetch in tests: ${request.method} ${request.url}`);
  return json({ error: 'unhandled outbound request in test fixture' }, 404);
}
