# Implementation Progress

Tracks completion status for all phases defined in `docs/plans/coverage-tracker-plan.md`.

---

## Phase 1 — D1 schema ✅ Complete

- [x] `migrations/0001_initial.sql` with `owners`, `projects`, `metrics` tables
- [x] `idx_metrics_idempotent` UNIQUE constraint on `(project_id, commit_sha, metric_name)` (A11)
- [x] `webhook_deliveries` table for replay protection (A5)
- [x] Migration applied to remote D1 database

---

## Phase 2 — Worker core ✅ Complete

### Auth middleware
- [x] OIDC verification: RS256, pins `iss` + `aud=coverage-tracker`, JWKS cache with refetch-on-unknown-`kid` (A1, A8)
- [x] Cloudflare Access JWT verification on all `/api` and `/admin` routes (A2)
- [x] GitHub webhook HMAC verification: constant-time compare via `crypto.subtle.verify` (A5)
- [x] `workers_dev = false` — no `.workers.dev` bypass (A2)

### Routes
- [x] `POST /ingest` — derives `repository`/`branch`/`sha` from OIDC token claims, not body (A3); INSERT OR IGNORE for idempotency (A11)
- [x] `GET /api/projects` — Access-gated
- [x] `GET /api/projects/:owner/:repo/metrics` — Access-gated, trend data
- [x] `GET /api/projects/:owner/:repo/baseline` — OIDC-gated, for Action threshold checks
- [x] `GET /badge/:owner/:repo/:metric.json` — public, shields.io format; returns 404 for `badge_enabled=0` (A12)

### Security
- [x] All D1 queries use `.prepare().bind()` — no string interpolation (A10)
- [x] `.dev.vars` gitignored; `.dev.vars.example` committed as template (A9)
- [x] `wrangler.json` gitignored; `wrangler.example.jsonc` committed as template

---

## Phase 3 — GitHub App webhooks ✅ Complete

### Webhook handler
- [x] `POST /webhooks/github` — HMAC-verified, delivery ID dedup (A5)
- [x] `installation: created` — upserts owner + all repos
- [x] `installation: deleted` — removes all projects for the installation
- [x] `installation_repositories: added/removed` — adds/removes individual projects

### Admin / resync
- [x] `performResync()` as a shared function (callable from HTTP and future dashboard)
- [x] `POST /admin/resync` — Access-gated, triggers reconciliation against GitHub API
- [x] `PATCH /admin/projects/:id/badge` — Access-gated, toggles `badge_enabled`

### Deployment (live)
- [x] Worker deployed to `demo.coveragetracker.dev`
- [x] All `wrangler secret`s configured: `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `CF_ACCESS_AUD`, `CF_ACCESS_TEAM_DOMAIN`
- [x] GitHub App created, installed on CoverageTracker org (7 repos registered)
- [x] Cloudflare Access: Allow application on root domain + Bypass application on `/api` (machine callers bypass edge Access; in-code auth handles all `/api/*` routes)
- [x] `scripts/setup-waf-rules.mjs` — Node.js script (no external deps) to add WAF skip rule bypassing Browser Integrity Check for `/api/ci/coverage` and `/api/webhooks/github`; idempotent, documented in INSTALLATION.md step 11 (only needed if Bot Fight Mode is enabled)

---

## Phase 4 — Thresholds + PR diff checks ✅ Complete

Implemented as part of the Phase 6 Action (the two are tightly coupled). E2E verified via PR #2 self-test: `min-coverage: '20'` passed, `min-coverage: '99'` breached with correct Check Run failure, baselines fetched from prior main push.

- [x] Threshold logic in the reporting Action (`min-coverage`, `max-coverage-drop`, `max-complexity`, `max-duplication` inputs)
- [x] PR diff checks: collect metrics, fetch baseline via OIDC-gated `GET /baseline`, compare
- [x] Check Run posting via `GITHUB_TOKEN` with `permissions: checks: write` (Option A)
- [x] Fork PR degradation: OIDC mint failure and Check Run post failure are warnings, not errors (Option C deferred for per-line annotations only)

---

## Phase 5 — Svelte dashboard ✅ Complete (integrated into Worker — see Convergence Refactor)

Dashboard built in `dashboard/` (SvelteKit 5). Builds to `dashboard/build/` and is served by the Worker via Workers Static Assets. All API calls are server-side; local dev uses the `ENVIRONMENT=development` var bypass.

- [x] SvelteKit 5 app in `dashboard/` with `@sveltejs/adapter-cloudflare`
- [x] Owner/repo grouping — top-level cards with latest coverage % + uPlot sparklines
- [x] Drill-in view: full uPlot trend charts per metric (coverage/complexity/duplication), branch selector
- [x] `Cf-Access-Jwt-Assertion` forwarded server-side to Worker; never touches browser JS
- [x] Local dev bypass (`ENVIRONMENT=development` var in `wrangler.json env.dev`) — absent from production
- [x] `test/seed-local.sql` + `db:seed:local` npm script for local D1 test data
- [x] ~~Separate Cloudflare Pages project~~ — superseded by Convergence Refactor; dashboard now ships with the Worker

---

## Phase 6 — Composite reporting Action ✅ Complete

Lives at `.github/actions/report/`. All files written and TypeScript compiled clean; `dist/run.js` committed. E2E self-test verified: push-to-main ingests, feature-branch push skips cleanly, PR Check Runs post correctly with threshold enforcement.

- [x] Action scaffold (`action.yml`, inputs: `worker-url`, threshold knobs; invokes `collect.sh` via `bash` to avoid exec-permission issues)
- [x] OIDC token minting: `core.getIDToken('coverage-tracker')`; non-default-branch pushes skip before mint to avoid 422
- [x] Metrics collection script (`collect.sh`) — language-agnostic shell dispatcher
  - [x] Language detection: `go.mod` → Go; `requirements.txt`/`setup.py`/`pyproject.toml` → Python; `package.json`/`tsconfig.json` → JS/TS
  - [x] Coverage (reads pre-generated artifacts; consumer runs tests first): `go tool cover -func` (Go), `coverage.py` JSON (Python), Istanbul/Vitest `coverage-summary.json` (JS/TS)
  - [x] Complexity (skipped if no tool present): `gocyclo`/`gocognit` (Go), `radon` (Python), `lizard` CPPNCSS XML fallback
  - [x] Duplication: `jscpd` (auto-installed via `npm install -g` if absent)
- [x] `POST /ingest` with `{ metrics }` body only; repo/branch/commit derived from OIDC token on Worker side (A3)
- [x] `GET /baseline` fetch + threshold comparison + `core.setFailed` on breach
- [x] PR job path: collect → baseline → Check Run via `GITHUB_TOKEN` — never writes to metrics table
- [x] `node_modules/` gitignored; `dist/run.js` committed (esbuild bundle, ~990 KB)
- [x] Parser fixture tests passed locally: radon, jscpd, Istanbul, lizard CPPNCSS

### Testing plan (next session) — Option A: self-test in this repo

Testing via a workflow in `coverage-tracker` itself. The GitHub App is already installed on the CoverageTracker org, so the repo is already registered in D1. The action is referenced with its local path (`uses: ./.github/actions/report`) — no version pinning needed.

#### Layer 1 — Action runner unit tests (prerequisite — do this first)

The Action runner (`src/run.ts`) contains pure helper functions that unit-test trivially. More importantly, vitest's `json-summary` coverage reporter emits `coverage/coverage-summary.json` in exactly the Istanbul shape `collect.sh` already parses. **This closes the dogfood loop: real coverage from testing the runner replaces the hardcoded fake artifact in the self-test workflow.** The self-test becomes meaningful: the Action reads its own real coverage and reports it.

- [x] Export pure helpers from `run.ts`: `parseThreshold`, `buildSummary`, `formatValue`, `formatDelta`, `thresholdConfigured`; export `ThresholdResult` interface; guard `run()` call with `require.main === module`
- [x] Add `vitest` and `@vitest/coverage-v8` to devDependencies in `.github/actions/report/package.json`
- [x] Add `vitest.config.ts` to `.github/actions/report/`
- [x] Update `test` script in `package.json`: `"test": "vitest run --coverage"`
- [x] Write `src/__tests__/run.test.ts` — 52 tests covering all helpers + I/O paths; all green
- [x] Rebuild `dist/run.js` after adding exports (`npm run build`); verified `run()` fires in bundle (`node dist/run.js` → "WORKER_URL is not set")

#### Layer 2 — `collect.sh` parser fixtures

The inline Python parsers are the riskiest part of `collect.sh` — tool output formats are not guaranteed and can't be verified without actually running the tools. Formalise the smoke tests run by hand into a committed fixture script.

- [x] Create `test/collect-parsers.sh` — fixture tests covering all 6 parsers (Istanbul, coverage.py, go cover, radon, jscpd, lizard CPPNCSS)

#### Layer 3 — Worker route + middleware tests ✅ Complete

Implemented with `@cloudflare/vitest-pool-workers` and real D1 bindings during the Convergence Refactor.

- [x] `vitest-pool-workers` setup at repo root
- [x] OIDC middleware: bad `alg`, wrong `aud`, wrong `iss`, expired token, unknown `kid` all reject (`test/ci.test.ts`)
- [x] `POST /api/ci/coverage`: repo/branch/commit derive from token claims; non-default branch → 422; duplicate commit → idempotent upsert (`test/ci.test.ts`)
- [x] Coverage run queries and trend data (`test/db.test.ts`)
- [x] Daily rollup + prune idempotency (`test/rollup.test.ts`)
- [x] Route registration, catch-all SPA fallback (`test/routing.test.ts`)

---

#### Step 1 — Create `.github/workflows/action-test.yml` ✅ Done

Self-test workflow created. Uses `min-coverage: '20'`; actual coverage is 98.09% (52 tests covering all helpers + I/O paths). Layer 2 fixture step added alongside the runner tests.

#### Step 2 — End-to-end test matrix (run in order)

- [x] **Push to main** — OIDC token mints, `/ingest` accepts it, 2 metrics ingested (`coverage: 98.09%`, `duplication: 0.00%`)
- [x] **Push to feature branch** — Action exits cleanly with "Not on default branch (test/matrix-threshold-and-branch ≠ main) — skipping ingest." info log; job green, no 422, no metric written
- [x] **PR from same repo** — baselines fetched, Check Run posted on PR head SHA with summary table; pass (`min-coverage: '20'`) and fail (`min-coverage: '99'`) cases both verified via PR #2
- [ ] **Fork PR** (if applicable) — OIDC mint fails gracefully (warning, not failure); Check Run post skipped gracefully
- [x] **jscpd** — auto-installs on fresh runner; `Duplication: 0.00% (no clones detected)` collected; appears in Check Run summary table
- [x] **Threshold breach** — `min-coverage: '99'` with coverage at 98.09%; action fails with "One or more coverage thresholds were not met.", Check Run posted with `conclusion: failure`

**Go/Python parser paths are not exercised by this workflow.** The Layer 2 fixture script covers those; a repo with `go.mod` or `pyproject.toml` and a real coverage artifact is needed for full end-to-end verification of those paths.

---

---

## Convergence Refactor ✅ Complete

Collapsed the old separate Cloudflare Pages dashboard + standalone Worker into a single Worker serving both the SvelteKit SPA and all API routes. See `docs/plans/coverage-tracker-convergence-plan.md` for the full design.

- [x] Single `wrangler.json` — `assets.directory: ./dashboard/build`, `run_worker_first: ["/api/*"]`, `not_found_handling: single-page-application`
- [x] `build.command: npm --prefix dashboard run build` — SvelteKit compiles on `wrangler deploy`
- [x] All routes moved under `/api/*`; SPA served via `ASSETS` catch-all
- [x] `coverage_runs` (14-day retention) + `coverage_daily` (permanent) tables — `migrations/0002_coverage.sql`
- [x] Daily rollup cron (`30 6 * * *`) — `src/db/rollup.ts` → last-of-day snapshot + prune
- [x] Cloudflare Access: Allow app on root domain + Bypass app on `/api`; in-code auth enforced for all `/api/*` routes
- [x] Stack: Hono + jose + zod; `nodejs_compat` compatibility flag
- [x] `src/lib/metrics.ts` — metric name → D1 column mapping
- [x] `src/routes/ci.ts` → `POST /api/ci/coverage` (typed columns, not EAV)
- [x] `src/routes/baseline.ts` → `GET /api/baseline/:owner/:repo` (OIDC-gated)

---

## Phase 7 — "Deploy to Cloudflare" button 🔶 In progress

- [x] `deploy` npm script runs `wrangler d1 migrations apply DB --remote` before `wrangler deploy` — uses binding name (`DB`) not database name so the deploy flow works when users specify a different database name
- [x] `wrangler.json` committed without `database_id` — Cloudflare's deploy flow provisions D1 automatically and fills in the ID
- [x] Button added to `README.md`
- [ ] Validate end-to-end via the deploy button flow (fork the repo, click button, confirm D1 is provisioned and migrations apply)

---

## Phase 8 — Docs, OSS hygiene, public release 🔶 In progress

- [x] `docs/INSTALLATION.md` — full setup guide, updated for converged architecture
- [x] Repository public at `github.com/CoverageTracker/coverage-tracker`
- [x] `wrangler.example.jsonc` and `.dev.vars.example` committed as templates (updated for convergence)
- [x] `README.md` — root-level project overview, quick-start, badge examples (updated for convergence)
- [ ] `CONTRIBUTING.md`
- [ ] GitHub issue templates
- [ ] Pre-commit secret scan (gitleaks) in CI (A9)
