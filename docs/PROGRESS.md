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
- [x] `wrangler.jsonc` gitignored; `wrangler.example.jsonc` committed as template

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
- [x] Worker deployed to `coverage-tracker.zerostash.org`
- [x] All `wrangler secret`s configured: `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `CF_ACCESS_AUD`, `CF_ACCESS_TEAM_DOMAIN`
- [x] GitHub App created, installed on ZeroStash org (7 repos registered)
- [x] Cloudflare Access application protecting `/api` and `/admin` paths only

---

## Phase 4 — Thresholds + PR diff checks ⬜ Not started

Designed for in the plan; routes and schema already support it. No code to write until the reporting Action (Phase 6) exists.

- [ ] Threshold logic in the reporting Action (`min-coverage`, `max-coverage-drop` inputs)
- [ ] PR diff checks: compute on PR branch, fetch baseline via `GET /baseline`, compare
- [ ] Check Run posting via `GITHUB_TOKEN` with `permissions: checks: write` (Option A)
- [ ] Fork PR limitation documented (read-only `GITHUB_TOKEN` — Option C deferred)

---

## Phase 5 — Svelte dashboard ⬜ Not started

- [ ] Cloudflare Pages project wired to this repo
- [ ] Owner/repo grouping — top-level cards with latest values + sparklines
- [ ] Drill-in view: full trend charts per metric, branch selector
- [ ] Cloudflare Access protecting the Pages app
- [ ] Charting library decision (uPlot or Chart.js)

---

## Phase 6 — Composite reporting Action ⬜ Not started

Lives at `.github/actions/report/` in this repo, version-locked to the Worker.

- [ ] Action scaffold (`action.yml`, inputs: `worker-url`, threshold knobs)
- [ ] OIDC token minting: `core.getIDToken('coverage-tracker')`
- [ ] Metrics collection script (language-agnostic shell dispatcher)
  - [ ] Coverage: `go test -coverprofile` (Go), `pytest-cov` (Python), Istanbul `coverage-summary.json` (TS)
  - [ ] Complexity: `gocyclo`/`gocognit` (Go), `radon` (Python), ESLint complexity rule (TS), `lizard` fallback
  - [ ] Duplication: `jscpd` (Go, Python, TS)
- [ ] `POST /ingest` with the normalized JSON payload
- [ ] `GET /baseline` fetch + threshold comparison + non-zero exit on breach
- [ ] PR job path: compute, compare, post Check Run via `GITHUB_TOKEN` — never persist

---

## Phase 7 — "Deploy to Cloudflare" button ⬜ Not started

- [ ] `deploy` npm script that includes `wrangler d1 migrations apply` so D1 is provisioned on first deploy
- [ ] Button in README pointing at Cloudflare Workers deploy flow
- [ ] Validate that the deploy flow handles the D1 binding name (not DB name) correctly

---

## Phase 8 — Docs, OSS hygiene, public release 🔶 In progress

- [x] `docs/INSTALLATION.md` — full 13-step guide with lessons learned
- [x] Repository public at `github.com/ZeroStash/coverage-tracker`
- [x] `wrangler.example.jsonc` and `.dev.vars.example` committed as templates
- [ ] `README.md` — root-level project overview, quick-start, badge examples
- [ ] `CONTRIBUTING.md`
- [ ] GitHub issue templates
- [ ] Pre-commit secret scan (gitleaks) in CI (A9)
