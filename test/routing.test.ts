import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index';
import type { Bindings } from '../src/types';

// @ts-expect-error cloudflare:test injects env at runtime
const testEnv = env as Bindings;

describe('routing', () => {
  it('GET /api/health returns 200', async () => {
    const res = await worker.fetch(new Request('http://localhost/api/health'), env as never);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('ok');
  });

  it('GET /api/projects without Access token returns 401', async () => {
    const res = await worker.fetch(new Request('http://localhost/api/projects'), env as never);
    expect(res.status).toBe(401);
  });

  it('POST /api/ci/coverage without OIDC token returns 401', async () => {
    const res = await worker.fetch(
      new Request('http://localhost/api/ci/coverage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line_coverage: 95 }),
      }),
      env as never,
    );
    expect(res.status).toBe(401);
  });

  it('responses include X-Content-Type-Options: nosniff security header', async () => {
    const res = await worker.fetch(new Request('http://localhost/api/health'), env as never);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('Access middleware rejects non-RS256 JWT with 403', async () => {
    // Construct a JWT whose header declares alg:HS256 — the algorithm pin rejects it
    // before any JWKS fetch or signature verification.
    const toBase64Url = (s: string) =>
      btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const fakeJwt = [
      toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
      toBase64Url(JSON.stringify({ sub: 'test' })),
      'fakesig',
    ].join('.');

    const res = await worker.fetch(
      new Request('http://localhost/api/projects', {
        headers: { 'Cf-Access-Jwt-Assertion': fakeJwt },
      }),
      env as never,
    );
    expect(res.status).toBe(403);
  });

  describe('branch validation', () => {
    beforeEach(async () => {
      await testEnv.DB.prepare(
        `INSERT OR IGNORE INTO owners (id, github_id, login, type) VALUES (1, 1, 'testorg', 'Organization')`,
      ).run();
      await testEnv.DB.prepare(
        `INSERT OR IGNORE INTO projects (id, owner_id, github_repo_id, repo_name, full_slug, installation_id, default_branch)
         VALUES (1, 1, 1, 'repo', 'testorg/repo', 1, 'main')`,
      ).run();
    });

    it('GET /api/projects/:owner/:repo/metrics returns 400 for branch longer than 255 chars', async () => {
      // DEV_BYPASS_SECRET is a local-dev-only secret not declared in wrangler.jsonc, so the
      // test pool doesn't expose it as a binding. Inject a value directly into the env object
      // so the bypass check in access.ts sees the same value as the request header.
      const bypass = 'test-bypass-only';
      (testEnv as Record<string, unknown>).DEV_BYPASS_SECRET = bypass;
      try {
        const longBranch = 'a'.repeat(256);
        const res = await worker.fetch(
          new Request(`http://localhost/api/projects/testorg/repo/metrics?branch=${longBranch}`, {
            headers: { 'x-dev-bypass': bypass },
          }),
          testEnv as never,
        );
        expect(res.status).toBe(400);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('Invalid branch');
      } finally {
        delete (testEnv as Record<string, unknown>).DEV_BYPASS_SECRET;
      }
    });
  });
});
