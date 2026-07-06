import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { verifyOidcToken } from '../../src/middleware/oidc';
import worker from '../../src/index';
import { signOidcJwt, seedOidcJwks } from '../helpers/crypto';
import type { Bindings } from '../../src/types';

// @ts-expect-error cloudflare:test injects env at runtime
const testEnv = env as Bindings;

describe('verifyOidcToken', () => {
  it('verifies a validly signed token against the cache-seeded JWKS', async () => {
    await seedOidcJwks();
    const token = await signOidcJwt({ repository: 'testorg/repo' });
    const claims = await verifyOidcToken(token);
    expect(claims.repository).toBe('testorg/repo');
    expect(claims.ref_type).toBe('branch');
  });

  it('forces exactly one JWKS refetch on an unknown kid, then succeeds', async () => {
    // Cache holds a JWKS under a kid that won't match the signed token, forcing
    // fetchJWKS(true) — which the test outboundService answers with the real key.
    await seedOidcJwks('stale-kid');
    const token = await signOidcJwt({ repository: 'testorg/repo2' });
    const claims = await verifyOidcToken(token);
    expect(claims.repository).toBe('testorg/repo2');
  });

  it('rejects when the kid is still unknown after the forced refetch', async () => {
    await seedOidcJwks('stale-kid');
    const token = await signOidcJwt({}, { kid: 'totally-unknown-kid' });
    await expect(verifyOidcToken(token)).rejects.toThrow(/Unknown signing key/);
  });

  it('rejects a token with the wrong issuer', async () => {
    await seedOidcJwks();
    const token = await signOidcJwt({ iss: 'https://not-github.example.com' });
    await expect(verifyOidcToken(token)).rejects.toThrow();
  });

  it('rejects a token with the wrong audience', async () => {
    await seedOidcJwks();
    const token = await signOidcJwt({ aud: 'someone-elses-app' });
    await expect(verifyOidcToken(token)).rejects.toThrow();
  });

  it('rejects a non-RS256 token before any JWKS lookup', async () => {
    const toBase64Url = (s: string) => btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const fakeJwt = [
      toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
      toBase64Url(JSON.stringify({ sub: 'test' })),
      'fakesig',
    ].join('.');
    await expect(verifyOidcToken(fakeJwt)).rejects.toThrow(/Unexpected JWT algorithm/);
  });
});

describe('requireOidc middleware', () => {
  it('returns 401 for a syntactically invalid bearer token, without setting claims', async () => {
    const res = await worker.fetch(
      new Request('http://localhost/api/ci/coverage', {
        method: 'POST',
        headers: { Authorization: 'Bearer not-a-real-jwt', 'Content-Type': 'application/json' },
        body: JSON.stringify({ line_coverage: 90 }),
      }),
      testEnv as never,
    );
    expect(res.status).toBe(401);
  });
});
