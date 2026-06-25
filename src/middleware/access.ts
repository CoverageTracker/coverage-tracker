import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { importJWK, jwtVerify, decodeProtectedHeader, type JWK } from 'jose';
import type { Bindings, Variables } from '../types';

interface AccessJWKS {
  keys: JWK[];
}

async function fetchAccessJWKS(teamDomain: string, forceRefresh: boolean): Promise<AccessJWKS> {
  const certsUrl = `https://${teamDomain}/cdn-cgi/access/certs`;
  const cacheKey = new Request(certsUrl);

  if (!forceRefresh) {
    const cached = await caches.default.match(cacheKey);
    if (cached) return cached.json() as Promise<AccessJWKS>;
  }

  const res = await fetch(certsUrl);
  if (!res.ok) throw new Error(`Access JWKS fetch failed: ${res.status}`);

  const body = await res.text();
  await caches.default.put(
    cacheKey,
    new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=3600',
      },
    }),
  );

  return JSON.parse(body) as AccessJWKS;
}

export function requireAccess() {
  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
    // Local dev bypass — only active when DEV_BYPASS_SECRET is set (never in production)
    const bypassSecret = c.env.DEV_BYPASS_SECRET;
    if (bypassSecret && c.req.header('x-dev-bypass') === bypassSecret) {
      return next();
    }

    // SPA browser fetches to /api/* arrive without the Cf-Access-Jwt-Assertion header
    // (Cloudflare Access only injects it at the edge for the dashboard routes).
    // The browser sends the CF_Authorization cookie on same-origin requests instead.
    const assertion =
      c.req.header('Cf-Access-Jwt-Assertion') ?? getCookie(c, 'CF_Authorization');

    if (!assertion) {
      return c.json({ error: 'Missing Access token' }, 401);
    }

    const { CF_ACCESS_AUD, CF_ACCESS_TEAM_DOMAIN } = c.env;

    try {
      const header = decodeProtectedHeader(assertion);
      let jwks = await fetchAccessJWKS(CF_ACCESS_TEAM_DOMAIN, false);
      let jwk = jwks.keys.find((k) => k.kid === header.kid);

      if (!jwk) {
        jwks = await fetchAccessJWKS(CF_ACCESS_TEAM_DOMAIN, true);
        jwk = jwks.keys.find((k) => k.kid === header.kid);
      }

      if (!jwk) throw new Error('Unknown Access signing key');

      const publicKey = await importJWK(jwk, 'RS256');
      await jwtVerify(assertion, publicKey, {
        issuer: `https://${CF_ACCESS_TEAM_DOMAIN}`,
        audience: CF_ACCESS_AUD,
        algorithms: ['RS256'],
      });
    } catch {
      return c.json({ error: 'Invalid Access token' }, 403);
    }

    await next();
  });
}
