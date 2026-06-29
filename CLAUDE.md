# CLAUDE.md

Operating manual for **coverage-tracker**. Read this first every session. For the one-time convergence refactor, see `coverage-tracker-convergence-plan.md`; this file is the durable spec that stays true after it lands.

## What this is

A self-hostable, open-source (MIT) code-quality dashboard. **One instance per deployer, not multi-tenant.** A single Cloudflare Worker serves the SPA dashboard *and* the API from one apex domain, backed by D1. CI jobs push coverage/complexity metrics; the dashboard reads trends.

## Architecture invariants

- **One Worker, one `wrangler.json`.** Static assets (`assets.directory` → `dist/`) and API live in the same Worker. Do not reintroduce a separate Pages project or a second Worker for the API.
- **Routing:** `assets.run_worker_first = ["/api/*"]` — only `/api/*` hits the Worker first; everything else is asset-first with `not_found_handling = "single-page-application"` (SPA deep links serve `index.html`).
- **Single D1 database** (`DB` binding) holds all repos' data. Free-tier cap is **500 MB/database**; the real ceiling is the **write limit** (~100k rows/day), not bytes.
- **Two coverage tables:**
  - `coverage_runs` — raw per-commit rows, **pruned** after `RETENTION_DAYS` (14). Upsert on `(project_id, commit_sha)`.
  - `coverage_daily` — **permanent** last-of-day snapshots produced by the cron; the historical trend source. Survives the prune.
- **Rollup is last-run-of-day**, not an average (`ROW_NUMBER() … ORDER BY ran_at DESC`). Idempotent: upsert + predicate delete, safe to re-run.
- Stack: **Hono** (router), **jose** (JWT/JWKS), **zod** (validation). TypeScript only — no JS.

## Auth model (per route)

| Route | Edge (Cloudflare Access) | In-code |
|---|---|---|
| Dashboard SPA (`/`, `/dashboard*`) | **Access-protected** | — |
| `/api/health` | none | none (public) |
| `/api/ci/coverage` | none | GitHub Actions **OIDC** (jose, JWKS) |
| `/api/webhooks/github` | none | GitHub App **HMAC** (`X-Hub-Signature-256`) |
| `/api/projects/*` | none | **Cloudflare Access JWT** (`Cf-Access-Jwt-Assertion`, verify `aud`) |

## Guardrails (do not violate)

- **Never put a Cloudflare Access application on `/api/*`.** Machine callers (CI OIDC, webhooks, health) must reach the Worker unauthenticated at the edge. API auth is enforced in code. This is the single most important invariant.
- **Never commit secrets.** Values are set with `wrangler secret put`. Code and `wrangler.json` may reference names only: `GITHUB_OIDC_AUDIENCE`, `GITHUB_WEBHOOK_SECRET`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `GITHUB_APP_*`.
- **Don't hand-write the `Bindings`/`Env` type.** Run `wrangler types` after any `wrangler.json` change.
- **Don't use Workers Sites** (deprecated). Workers Static Assets only; requires Wrangler v4+.
- **Don't make `coverage_daily` writes lossy on re-run.** All rollup writes are `ON CONFLICT … DO UPDATE`.
- Don't widen retention or change rollup semantics without updating `RETENTION_DAYS` / the documented contract; both are single points of change.

## Commands

```bash
# Dev — uses the named `dev` environment (wrangler.json env.dev), which sets
# ENVIRONMENT=development via vars to bypass Access JWT verification locally.
npm run dev                 # wrangler dev --env dev (local assets + Worker)
wrangler types              # regenerate Bindings after wrangler.json changes

# Database (local)
npm run db:migrate:local    # wrangler d1 migrations apply DB --local --env dev
npm run db:seed:local       # load test/seed-local.sql into the local D1

# Database (remote / production)
wrangler d1 migrations apply DB --remote
wrangler d1 execute DB --remote --command "SELECT ..."

# Test (runs in the Workers runtime with real D1 bindings)
npm test                    # @cloudflare/vitest-pool-workers

# Deploy
wrangler deploy --dry-run   # validate before shipping
wrangler deploy
wrangler tail               # live logs

# Secrets (values never committed)
wrangler secret put <NAME>
```

## Conventions

- **DB access** goes through prepared statements with bound params — no string interpolation into SQL.
- **Validation** at the edge of every write route via zod; invalid → `422` with issues.
- **Auth failures:** missing credential → `401`, present-but-invalid → `403`.
- **Logging:** structured `console.log`/`console.error`; observability is enabled — keep it that way.
- **The Hono catch-all** `app.all('*', c => c.env.ASSETS.fetch(c.req.raw))` must remain the last route so non-API requests reaching the Worker fall through to assets.
- **Tests:** confirm `nodejs_compat` is in `wrangler.json` directly — the vitest pool injects it and can mask a missing flag that then fails at deploy.

## Local dev

`wrangler dev --env dev` activates the `dev` named environment defined in `wrangler.json`. That environment's `vars` block sets `ENVIRONMENT = "development"`, which `requireAccess()` checks first to skip Access JWT verification. No `.dev.vars` entry is needed — the var is declared directly in `wrangler.json` and only applies to the `dev` named environment. The bypass is absent from production because `wrangler deploy` (which uses `--env prod`) does not apply the `env.dev` overlay.

## Gotchas

- `Cf-Access-Jwt-Assertion`'s `aud` is **per Access application**. If the dashboard is ever split across multiple Access apps, the `/api/projects/*` middleware must accept an array of audiences.
- The cron (`30 6 * * *` UTC) is the only thing that moves rows from `coverage_runs` to `coverage_daily`. If it stops firing, raw rows accumulate and the historical series stops advancing — check Observability if trends look stale.
- D1 is single-threaded per database and bills on **rows scanned**. Keep `/api/projects/*` reads index-backed (`idx_runs_project_time`); avoid full scans.
- A large `DELETE` in the prune is fine at current scale; if raw volume ever grows, batch deletes ~1,000 rows at a time to stay under execution limits.
