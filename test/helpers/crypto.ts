import { SignJWT, importPKCS8, type JWK } from 'jose';
import { inject } from 'vitest';
import type { GitHubOidcClaims } from '../../src/types';
import { OIDC_JWKS_URL, OIDC_KID } from './constants';

/**
 * The RSA keypair used to sign test tokens is generated once per run in
 * test/global-setup.ts (Node host process) and reaches both the outboundService
 * callback in vitest.config.mts (same host process) and this module (running
 * inside the workerd isolate) via vitest's provide/inject bridge — never
 * written to disk or committed, so there's no private key material in source.
 */
export { OIDC_JWKS_URL, OIDC_KID };

let privateKeyPromise: Promise<CryptoKey> | null = null;
function getPrivateKey(): Promise<CryptoKey> {
  privateKeyPromise ??= importPKCS8(inject('oidcTestPrivateKeyPem'), 'RS256');
  return privateKeyPromise;
}

/** JWKS body containing the one generated test key, under the given kid. */
export function jwksFor(kid: string): { keys: JWK[] } {
  return { keys: [{ ...inject('oidcTestPublicJwk'), kid, alg: 'RS256', use: 'sig' }] };
}

/** Seed the Cache API entry that oidc.ts checks before ever calling fetch(). */
export async function seedOidcJwks(kid = OIDC_KID): Promise<void> {
  await caches.default.put(
    new Request(OIDC_JWKS_URL),
    new Response(JSON.stringify(jwksFor(kid)), { headers: { 'Content-Type': 'application/json' } }),
  );
}

const DEFAULT_CLAIMS: GitHubOidcClaims = {
  iss: 'https://token.actions.githubusercontent.com',
  sub: 'repo:testorg/repo:ref:refs/heads/main',
  aud: 'coverage-tracker',
  repository: 'testorg/repo',
  ref: 'refs/heads/main',
  ref_type: 'branch',
  sha: 'a'.repeat(40),
  repository_owner: 'testorg',
  repository_id: '1',
  actor: 'tester',
  event_name: 'push',
  iat: 0,
  exp: 0,
};

/** Sign a GitHub Actions OIDC token. Override any claim; defaults match a typical push-to-main run. */
export async function signOidcJwt(
  overrides: Partial<GitHubOidcClaims> = {},
  opts: { kid?: string } = {},
): Promise<string> {
  const privateKey = await getPrivateKey();
  const now = Math.floor(Date.now() / 1000);
  const claims = { ...DEFAULT_CLAIMS, ...overrides };

  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: opts.kid ?? OIDC_KID })
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .setIssuer(claims.iss)
    .setAudience(claims.aud)
    .setSubject(claims.sub)
    .sign(privateKey);
}

/**
 * The same generated PEM, reused as env.GITHUB_APP_PRIVATE_KEY. Only used to
 * locally sign the GitHub App JWT (mintAppJwt) inside the worker under test —
 * never verified by anything external, since all GitHub API calls are
 * intercepted by the test outboundService (see test/helpers/outbound.ts).
 */
export function getTestAppPrivateKeyPem(): string {
  return inject('oidcTestPrivateKeyPem');
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Sign a webhook body with the given secret, mirroring GitHub's X-Hub-Signature-256 format. */
export async function signWebhookBody(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return `sha256=${bytesToHex(sig)}`;
}
