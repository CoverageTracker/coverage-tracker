# Plan: Refactor Dashboard Auth to Cloudflare Access Service Tokens

## Context

The current architecture has the dashboard's SSR load functions forward the end-user's
`Cf-Access-Jwt-Assertion` header to the Worker API. This works in production (Cloudflare
Access injects the header), but breaks in local dev (no Access edge layer). The workaround
is a `ENVIRONMENT` shared between the Worker and the dashboard.

The proper server-to-server auth primitive in Cloudflare Access is a **Service Token**: a
`client_id` + `client_secret` pair that authenticates a machine caller independently of any
user session. The dashboard's Pages Functions would authenticate to the Worker API using a
Service Token, and the end-user's GitHub OAuth auth would continue to protect the Pages URL
(handled by Access, not by the dashboard's code).

Benefits over the current approach:
- No JWT forwarding — the user's browser session token is never sent to the Worker
- Works identically in local dev and production (just set the env vars)
- Removes the `ENVIRONMENT` workaround and its associated risk
- Cleaner separation: user auth protects the Pages URL; service auth protects the API

## What to Build

### 1. Cloudflare Access: create a Service Token

In the Cloudflare Zero Trust dashboard:
- **Access → Service Auth → Service Tokens → Create Service Token**
- Name: `coverage-tracker-dashboard`
- Copy the generated `Client ID` and `Client Secret` (the secret is only shown once)
- On the Worker's Access application, add a policy that allows this Service Token:
  - Policy name: `dashboard-service`
  - Rule: Service Token = `coverage-tracker-dashboard`

### 2. Worker: accept Service Token auth in `requireAccess()`

Cloudflare Access injects `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers for
Service Token callers. The Worker's `requireAccess()` middleware should check these before
falling back to JWT verification.

**File: `src/middleware/access.ts`**

```typescript
// At the top of the middleware, before the JWT path:
const clientId = c.req.header('cf-access-client-id');
const clientSecret = c.req.header('cf-access-client-secret');
const { CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET } = c.env;

if (
  CF_ACCESS_CLIENT_ID &&
  CF_ACCESS_CLIENT_SECRET &&
  clientId === CF_ACCESS_CLIENT_ID &&
  clientSecret === CF_ACCESS_CLIENT_SECRET
) {
  return next();
}
```

Add to `Bindings` in `src/types.ts`:
```typescript
CF_ACCESS_CLIENT_ID?: string;
CF_ACCESS_CLIENT_SECRET?: string;
```

Set in production via `wrangler secret put CF_ACCESS_CLIENT_ID` and
`wrangler secret put CF_ACCESS_CLIENT_SECRET`.

Set in local dev via `.dev.vars`.

### 3. Dashboard: send Service Token headers instead of forwarding user JWT

**File: `dashboard/src/lib/api.ts`**

Replace the `jwt` + `extraHeaders` pattern with a single `authHeaders` object:

```typescript
export function buildAuthHeaders(jwt: string, clientId?: string, clientSecret?: string) {
  if (clientId && clientSecret) {
    return {
      'CF-Access-Client-Id': clientId,
      'CF-Access-Client-Secret': clientSecret,
    };
  }
  return { 'Cf-Access-Jwt-Assertion': jwt };
}
```

**Files: `dashboard/src/routes/+page.server.ts` and `[owner]/[repo]/+page.server.ts`**

Read `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` from `$env/dynamic/private` and
pass them to `buildAuthHeaders`. Drop the `ENVIRONMENT` reads.

### 4. Dashboard: add Service Token env vars

**File: `dashboard/.env.example`** — add:
```
CF_ACCESS_CLIENT_ID=
CF_ACCESS_CLIENT_SECRET=
```

In Cloudflare Pages production environment variables, set both.
In local dev (`.env` or `.dev.vars`), set both.

### 5. Remove the dev bypass

Once Service Tokens are wired up, the `ENVIRONMENT` bypass is no longer needed:
- Remove `ENVIRONMENT` check from `src/middleware/access.ts`
- Remove `ENVIRONMENT` from `src/types.ts`
- Remove `ENVIRONMENT` from both `.dev.vars.example` files
- Remove `extraHeaders` params from `fetchProjects` and `fetchTrend` in `api.ts`
  (or keep them for other future use cases)

## Verification

1. Create the Service Token in Cloudflare Zero Trust
2. Set `CF_ACCESS_CLIENT_ID` + `CF_ACCESS_CLIENT_SECRET` in `.dev.vars` (Worker) and `.env`
   (dashboard)
3. Run both local servers; confirm the dashboard loads with no bypass secret set
4. Confirm the production Worker rejects requests with a wrong `CF-Access-Client-Secret`
5. Confirm the end-user Access policy (GitHub OAuth) still protects the Pages URL

## Notes

- The Service Token secret is a Wrangler secret (not a `vars` entry) — it must never
  appear in source or `wrangler.json`.
- If the Worker later exposes routes that need to identify *which user* is making the
  request (e.g., per-user data isolation), the JWT forwarding path would need to be
  reinstated for those routes. This tool only tracks a single deployer's data, so
  service-level auth is sufficient.
