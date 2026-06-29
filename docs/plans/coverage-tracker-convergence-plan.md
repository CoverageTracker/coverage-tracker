# coverage-tracker — Convergence Refactor Plan

**Audience:** Claude Code CLI
**Goal:** Collapse the current Cloudflare Pages site + separate Worker(s) into a **single Worker serving static assets and API routes** from one apex domain, with one `wrangler.json`, path-scoped Cloudflare Access, three-tier API auth, and a D1 raw-runs + daily-rollup model with a cron-driven prune.

---

## 1. Objective

Serve the dashboard SPA and the API from the **same apex domain** out of **one Worker** with one Wrangler config. Cloudflare Access protects only the dashboard paths at the edge; the API enforces its own auth in code (or none, for the public route). D1 stores fine-grained `coverage_runs` for a bounded retention window and permanent `coverage_daily` snapshots produced by a scheduled rollup that then prunes the raw rows.

---

## 2. Current → Target state

| Aspect | Current | Target |
|---|---|---|
| Frontend hosting | Cloudflare Pages project on apex | Static assets served by the Worker (`assets.directory`) |
| API hosting | Separate Worker(s) / Pages Functions | Same Worker, `/api/*` routed via `run_worker_first` |
| Config files | Pages config + Worker `wrangler.*` | Single `wrangler.json` |
| Domain routing | Pages custom domain + Worker route precedence | One Worker custom domain on the apex |
| Dashboard auth | Cloudflare Access (scoped apps already in place) | Cloudflare Access scoped to dashboard paths only |
| API auth | per-Worker | In-code: OIDC (CI), HMAC (webhooks), none (health) |
| Coverage storage | (new) | `coverage_runs` (pruned) + `coverage_daily` (permanent) |
| Trend computation | (new) | Daily cron: last-of-day rollup → prune |

---

## 3. Locked decisions (do not re-litigate)

- **Single Worker, single D1, one instance per deployer.** Not multi-tenant.
- **Free-tier constraint is 500 MB per database**, 5 GB per account. At realistic scale (≤30 repos), storage is a non-issue because raw runs are pruned to a steady state; the binding constraint is the **write limit** (~100k rows/day free), not bytes.
- **Retention window: 14 days** of raw runs (`RETENTION_DAYS = 14`). Configurable up to ~60 days without storage concern.
- **Rollup semantics: last-run-of-day** per `(project_id, day)` — the day's final coverage value, not an average. Picked via `ROW_NUMBER() … ORDER BY ran_at DESC`.
- **`coverage_daily` is permanent** and survives the prune; it is the historical trend source.
- **SPA fallback** via `not_found_handling = "single-page-application"`.
- **`/api/*` runs the Worker first**; everything else is asset-first.
- **Dashboard data endpoints (`/api/projects/*`) validate the Cloudflare Access JWT in-code.** They sit under `/api/*` and so bypass edge Access by design; access is enforced by verifying the `Cf-Access-Jwt-Assertion` header against the Access team's JWKS and checking the application `aud`. Read endpoints are login-only.
- Stack: **Hono** (router) + **jose** (OIDC + Access JWKS verify) + **zod** (payload validation). TypeScript throughout.

---

## 4. Manual / out-of-band steps (HUMAN — not Claude Code)

These touch the Cloudflare dashboard, DNS, secrets, or GitHub config and **cannot be done from the repo**. Claude Code should treat these as preconditions/post-conditions and **not** attempt them. Flag clearly in the cutover phase.

1. **Secrets** (set via `wrangler secret put`, see §8). Claude Code may write the *names* into `wrangler.json`/types but must never commit values.
2. **Cloudflare Access apps**: after cutover, scope Access application(s) to the dashboard paths on the apex (e.g. `/`, `/dashboard*`), and ensure **no Access app covers `/api/*`** — machine callers (OIDC CI, webhooks, public health) must reach the Worker unauthenticated at the edge. This is the same scoped-app pattern already adopted; re-verify it against the new single-origin path layout.
3. **Custom domain cutover**: detach the apex from the Pages project, attach it to the Worker (Workers custom domain). Brief downtime window — sequence per §7 Phase 9.
4. **GitHub App / OAuth App**: webhook secret + (if dashboard login uses GitHub OAuth via Access) the OAuth app credentials. Existing config from the locked architecture; verify callback URLs still resolve on the converged origin.

---

## 5. Target repository layout

```
.
├── wrangler.json
├── package.json
├── tsconfig.json
├── migrations/
│   ├── 0001_projects.sql          # existing (projects table) — verify present
│   └── 0002_coverage.sql          # NEW: coverage_runs + coverage_daily
├── src/
│   ├── worker.ts                  # entry: { fetch, scheduled }
│   ├── app.ts                     # Hono app + route mounting
│   ├── auth/
│   │   ├── oidc.ts                # GitHub Actions OIDC middleware
│   │   ├── hmac.ts                # GitHub webhook HMAC verify
│   │   └── access.ts             # Cloudflare Access JWT middleware (/api/projects/*)
│   ├── routes/
│   │   ├── health.ts              # public
│   │   ├── ci.ts                  # OIDC-gated coverage ingest
│   │   ├── webhooks.ts            # HMAC-gated GitHub App webhooks
│   │   └── dashboard-data.ts      # trend read path (union query)
│   ├── db/
│   │   └── rollup.ts              # rollupAndPrune()
│   └── types.ts                   # Bindings, shared types
├── dist/                          # SPA build output (assets.directory)
└── test/
    ├── ci.test.ts
    ├── rollup.test.ts
    └── routing.test.ts
```

(Frontend SPA — Svelte or React — builds into `dist/`. If it lives in a subdir or monorepo package, point `assets.directory` at its build output and wire the build into the deploy step.)

---

## 6. Configuration contract — `wrangler.json`

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "coverage-tracker",
  "main": "src/worker.ts",
  "compatibility_date": "2026-06-25",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "observability": { "enabled": true },
  "triggers": { "crons": ["30 6 * * *"] },   // 06:30 UTC daily
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "coverage",
      "database_id": "<existing-id>",
      "migrations_dir": "migrations"
    }
  ]
}
```

Run `wrangler types` after this lands to generate the `Bindings` interface — do **not** hand-write it.

---

## 7. Phased implementation

Each phase is independently committable with its own acceptance check. Do them in order.

### Phase 0 — Branch & dependencies
- Create branch `feat/converge-worker-assets`.
- `npm i hono jose zod`. Confirm `wrangler` is v4+ (Workers Static Assets requires it; Workers Sites is deprecated and must not be used).
- **Accept:** `npm ls hono jose zod wrangler` resolves; `wrangler --version` ≥ 4.

### Phase 1 — Wrangler convergence
- Replace existing config with §6. Keep the existing `database_id`.
- Verify `migrations/0001_projects.sql` (the `projects` table that webhook registration writes to) exists; `coverage_runs.project_id` FKs into it.
- **Accept:** `wrangler deploy --dry-run` succeeds; `wrangler types` emits a `Bindings` type containing `ASSETS: Fetcher` and `DB: D1Database`.

### Phase 2 — Worker skeleton + auth middleware
- `src/worker.ts` exports `{ fetch: app.fetch, scheduled }`.
- `src/app.ts`: Hono app, mounts routes, **final catch-all** `app.all('*', c => c.env.ASSETS.fetch(c.req.raw))`.
- `src/auth/oidc.ts`: middleware verifying GitHub Actions OIDC JWT via `createRemoteJWKSet('https://token.actions.githubusercontent.com/.well-known/jwks')`, issuer `https://token.actions.githubusercontent.com`, audience from `GITHUB_OIDC_AUDIENCE`. Optionally pin `payload.repository`/`repository_owner`. On failure → `401`.
- `src/auth/hmac.ts`: constant-time HMAC-SHA256 verify of raw body against `X-Hub-Signature-256` using `GITHUB_WEBHOOK_SECRET` (WebCrypto `crypto.subtle`).
- **Accept:** unit tests assert 401 on missing/garbage OIDC token and bad HMAC signature; a non-`/api` request falls through to `ASSETS`.

### Phase 3 — D1 migration
- Author `migrations/0002_coverage.sql` exactly as §9.
- Apply: `wrangler d1 migrations apply coverage --local` then `--remote`.
- **Accept:** `coverage_runs`, `coverage_daily`, and the three indexes exist; FK to `projects` resolves.

### Phase 4 — Coverage ingest route
- `src/routes/ci.ts`: `POST /api/ci/coverage`, behind OIDC middleware.
- Validate body with the zod `CoverageReport` schema (§10). On invalid → `422` with issues.
- Upsert into `coverage_runs` on conflict `(project_id, commit_sha)` (§10 SQL). Set `ran_at = unixepoch()`. Return `202`.
- **Accept:** integration test (vitest-pool-workers, real D1) — valid payload inserts a row; re-POST of same `(project_id, commit_sha)` updates, does not duplicate; invalid payload → 422; missing OIDC → 401.

### Phase 5 — Scheduled rollup + prune
- `src/db/rollup.ts`: `rollupAndPrune(env)` per §11 — snapshot last-of-day for runs older than `RETENTION_DAYS`, upsert into `coverage_daily`, then `DELETE FROM coverage_runs WHERE ran_at < cutoff`.
- `worker.ts` `scheduled` handler wraps it in `ctx.waitUntil(...)`.
- **Accept:** test seeds runs spanning >14 days with multiple runs/day; after `rollupAndPrune`, each old `(project, day)` has exactly one `coverage_daily` row equal to that day's latest run with correct `run_count`; old raw rows are gone; rows inside the window remain. Re-running is idempotent (no dup snapshots, no error).

### Phase 6 — Dashboard read path
- `src/routes/dashboard-data.ts`: `GET /api/projects/:id/trend` returning a single ordered series that **unions** recent fine-grained points from `coverage_runs` with historical points from `coverage_daily` (recent window from runs, older from daily), ordered by day ascending. De-dup the boundary day in favor of the rollup.
- This endpoint is under `/api/*` so it bypasses edge Access. **It must be gated in-code** by an Access JWT middleware (`src/auth/access.ts`) applied to all `/api/projects/*` routes:
  - Read the `Cf-Access-Jwt-Assertion` header (fall back to the `CF_Authorization` cookie). Missing → `401`.
  - Verify the JWT via `createRemoteJWKSet('https://<team>.cloudflareaccess.com/cdn-cgi/access/certs')`, issuer `https://<team>.cloudflareaccess.com`, audience = the Access application's **AUD tag** (`CF_ACCESS_AUD`). Invalid/expired → `403`.
  - On success, the verified identity (`payload.email`) is available to the handler.
  - The team domain and AUD tag come from config/secrets (§8), not hard-coded.
- **Accept:** test with seeded runs + daily rows returns a contiguous, correctly ordered series with no duplicate boundary day. A request with no/invalid `Cf-Access-Jwt-Assertion` is rejected (401/403); a request with a valid Access assertion succeeds.

### Phase 7 — Tests
- Use `@cloudflare/vitest-pool-workers` so tests run in the Workers runtime with real D1 bindings.
- Confirm `nodejs_compat` is present in `wrangler.json` (the pool injects it for tests, masking a missing flag at deploy — verify explicitly).
- **Accept:** `npm test` green; coverage of auth, ingest, rollup, routing.

### Phase 8 — CI ingest workflow
- Add a GitHub Actions step (reusable) that:
  - requests an OIDC token with `permissions: id-token: write` and the configured audience,
  - parses the project's coverage report into the `CoverageReport` shape,
  - `POST`s to `https://<apex>/api/ci/coverage` with `Authorization: Bearer <oidc-token>`.
- **Accept:** dry-run against a preview deployment ingests a row; dashboard trend reflects it.

### Phase 9 — Cutover (sequenced; HUMAN executes the dashboard parts)
Order matters to minimize downtime:
1. Deploy the converged Worker **without** a custom domain (gets a `*.workers.dev` URL). Smoke-test SPA + all three API tiers there.
2. **Human:** in Cloudflare Access, create/scope the dashboard Access app to the apex dashboard paths; confirm no app matches `/api/*`.
3. **Human:** detach the apex from the Pages project; attach it as a Worker custom domain.
4. Verify DNS/edge propagation; smoke-test the apex: dashboard prompts Access, `/api/health` is open, `/api/ci/coverage` accepts OIDC, webhook route validates HMAC.
5. **Human:** once green, delete or archive the old Pages project and any now-dead Worker routes.
- **Accept:** end-to-end checklist (§12) passes on the apex.

---

## 8. Secrets & environment

Set via `wrangler secret put <NAME>` (never committed). Reference by the same name in `Bindings`.

| Name | Purpose |
|---|---|
| `GITHUB_OIDC_AUDIENCE` | Expected `aud` of the Actions OIDC token |
| `GITHUB_WEBHOOK_SECRET` | HMAC key for GitHub App webhook signature |
| `CF_ACCESS_TEAM_DOMAIN` | Access team domain, e.g. `<team>.cloudflareaccess.com` (JWKS + issuer) |
| `CF_ACCESS_AUD` | Access application AUD tag, checked as the JWT `aud` for `/api/projects/*` |
| `GITHUB_APP_*` | (existing) GitHub App credentials for project registration, as already defined |
| OAuth/Access | Managed in Access + GitHub OAuth app config, not in the Worker |

---

## 9. `migrations/0002_coverage.sql`

```sql
CREATE TABLE IF NOT EXISTS coverage_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      TEXT    NOT NULL,
  commit_sha      TEXT    NOT NULL,
  branch          TEXT    NOT NULL,
  ran_at          INTEGER NOT NULL,            -- unix seconds
  line_coverage   REAL    NOT NULL,
  branch_coverage REAL,
  cyclomatic      REAL,
  cognitive       REAL,
  duplication_pct REAL,
  maintainability REAL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_project_commit
  ON coverage_runs (project_id, commit_sha);

CREATE INDEX IF NOT EXISTS idx_runs_project_time
  ON coverage_runs (project_id, ran_at);

CREATE TABLE IF NOT EXISTS coverage_daily (
  project_id      TEXT    NOT NULL,
  day             TEXT    NOT NULL,            -- 'YYYY-MM-DD' UTC
  line_coverage   REAL    NOT NULL,
  branch_coverage REAL,
  cyclomatic      REAL,
  cognitive       REAL,
  duplication_pct REAL,
  maintainability REAL,
  run_count       INTEGER NOT NULL,
  PRIMARY KEY (project_id, day),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

---

## 10. Ingest contract

**zod schema:**
```ts
const CoverageReport = z.object({
  projectId: z.string().min(1),
  commitSha: z.string().regex(/^[0-9a-f]{7,40}$/),
  branch: z.string().min(1),
  lineCoverage: z.number().min(0).max(100),
  branchCoverage: z.number().min(0).max(100).optional(),
  cyclomatic: z.number().optional(),
  cognitive: z.number().optional(),
  duplicationPct: z.number().min(0).max(100).optional(),
  maintainability: z.number().optional(),
})
```

**Upsert:**
```sql
INSERT INTO coverage_runs
  (project_id, commit_sha, branch, ran_at,
   line_coverage, branch_coverage, cyclomatic, cognitive,
   duplication_pct, maintainability)
VALUES (?, ?, ?, unixepoch(), ?, ?, ?, ?, ?, ?)
ON CONFLICT (project_id, commit_sha) DO UPDATE SET
  branch          = excluded.branch,
  ran_at          = excluded.ran_at,
  line_coverage   = excluded.line_coverage,
  branch_coverage = excluded.branch_coverage,
  cyclomatic      = excluded.cyclomatic,
  cognitive       = excluded.cognitive,
  duplication_pct = excluded.duplication_pct,
  maintainability = excluded.maintainability;
```

---

## 11. Rollup contract (`rollupAndPrune`)

`RETENTION_DAYS = 14`. `cutoff = now − RETENTION_DAYS·86400` (unix seconds).

```sql
INSERT INTO coverage_daily
  (project_id, day, line_coverage, branch_coverage, cyclomatic,
   cognitive, duplication_pct, maintainability, run_count)
SELECT project_id, day, line_coverage, branch_coverage, cyclomatic,
       cognitive, duplication_pct, maintainability, run_count
FROM (
  SELECT
    project_id,
    strftime('%Y-%m-%d', ran_at, 'unixepoch') AS day,
    line_coverage, branch_coverage, cyclomatic, cognitive,
    duplication_pct, maintainability,
    COUNT(*)     OVER (PARTITION BY project_id,
                       strftime('%Y-%m-%d', ran_at, 'unixepoch')) AS run_count,
    ROW_NUMBER() OVER (PARTITION BY project_id,
                       strftime('%Y-%m-%d', ran_at, 'unixepoch')
                       ORDER BY ran_at DESC) AS rn
  FROM coverage_runs
  WHERE ran_at < ?1
)
WHERE rn = 1
ON CONFLICT (project_id, day) DO UPDATE SET
  line_coverage   = excluded.line_coverage,
  branch_coverage = excluded.branch_coverage,
  cyclomatic      = excluded.cyclomatic,
  cognitive       = excluded.cognitive,
  duplication_pct = excluded.duplication_pct,
  maintainability = excluded.maintainability,
  run_count       = excluded.run_count;

DELETE FROM coverage_runs WHERE ran_at < ?1;
```

Both statements take the same `cutoff` bind. Re-runs are safe (upsert + predicate delete). At current scale a single `DELETE` is fine; if raw volume ever grows large, batch the delete in chunks of ~1,000.

---

## 12. End-to-end acceptance checklist (post-cutover, on apex)

- [ ] Navigating to the dashboard root triggers Cloudflare Access login.
- [ ] `GET /api/health` returns 200 with **no** Access challenge.
- [ ] `POST /api/ci/coverage` with a valid OIDC token inserts/updates one row; without a token → 401; bad payload → 422.
- [ ] Webhook route validates a correctly signed payload and rejects a bad signature.
- [ ] `/api/projects/*` rejects requests with no/invalid Access assertion (401/403) and serves data with a valid one.
- [ ] SPA deep links (e.g. `/dashboard/<project>`) serve `index.html` (SPA fallback), not 404.
- [ ] Cron fires (verify in Observability); after it runs, old raw rows are gone and `coverage_daily` has the expected snapshots.
- [ ] Dashboard trend renders a contiguous series across the runs→daily boundary.
- [ ] `wrangler tail` shows structured logs; observability enabled.

---

## 13. Rollback

- Keep the old Pages project **archived, not deleted**, until the checklist passes for 24–48h.
- Rollback = re-attach the apex to the Pages project and re-point any old Worker routes; the converged Worker can keep running on its `workers.dev` URL for diagnosis.
- D1 changes are additive (new tables); no destructive migration to reverse. `coverage_daily` and surviving `coverage_runs` are unaffected by a frontend rollback.

---

## 14. Out of scope / future

- Switching `commit_sha` to a 20-byte BLOB to shave ~30% off raw-table size — unnecessary at single-digit MB.
- Average/best-of-day rollup variants — current spec is last-of-day only.
- Multi-tenant / per-deployer database sharding — explicitly not this project.
- Lengthening `RETENTION_DAYS` to 30–60 for finer recent granularity — safe to do later by changing one constant.
