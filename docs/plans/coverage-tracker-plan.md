# Coverage Tracker — Build Plan (Claude Code handoff)

This document is a handoff spec for building a self-hostable, multi-project code-quality
dashboard on Cloudflare. Read the whole thing before writing code. **We are building the
schema + Worker core FIRST**, but every decision below must be made with the full target
end-state in mind (multi-project, public OSS, one-click deploy). Do not paint us into a
corner that a later phase has to rip out.

---

## 1. What this project is

A self-hosted dashboard that tracks **code coverage, cyclomatic/cognitive complexity, and
code duplication** over time for one or more GitHub repositories, with trend charts,
per-PR diff checks, and README badges.

### Deployment model (important — read carefully)

This is **one instance per deployer**, NOT a multi-tenant SaaS.

- Every user deploys their own copy onto their own Cloudflare account (Worker + D1 + Pages).
- Their data lives only in their own D1 database. There is no cross-tenant isolation to
  build, no billing, no abuse handling, because no one shares an instance.
- "Multi-project" means **one deployer tracking several of their own repos/orgs in their
  own instance** — not multiple customers sharing infrastructure.

Keep this model front-of-mind: it is the reason auth and data isolation stay simple.

### Why we're not using the alternatives (context, don't re-litigate)

- **GitHub Pages for the dashboard**: rejected. Published Pages sites are publicly
  reachable by URL even from a private repo on a paid plan. There is no way to keep the
  dashboard private while the source repo is public. Cloudflare Access solves exactly this.
- **Neon / external Postgres**: rejected. Costs money and is unrelated to this project.
  D1's free tier (5 GB storage, 5M reads/day) is far more than enough.
- **Codecov / Coveralls / Codacy / Qlty**: the SaaS options we're replacing. Out of scope.

---

## 2. Target end-state (build toward this, even in early phases)

Phases, in eventual build order. **Only Phase 1–3 (core) are in scope right now**; the rest
are documented so current designs accommodate them.

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | D1 schema (multi-project from day one) | ✅ complete |
| 2 | Worker core: ingest (OIDC-verified), metrics read, badge | ✅ complete |
| 3 | GitHub App registration webhooks → projects table | ✅ complete |
| 4 | Thresholds + PR diff checks (reporting Action logic) | ✅ complete |
| 5 | Svelte dashboard on Cloudflare Pages, behind Access | not started |
| 6 | Reusable composite reporting Action (in this repo) | ✅ complete |
| 7 | "Deploy to Cloudflare" button + one-click onboarding | not started |
| 8 | Docs, OSS hygiene, public release | 🔶 in progress |

---

## 3. Tech stack & decisions (locked)

- **Worker**: TypeScript. Use the Cloudflare Workers runtime, `wrangler` for dev/deploy,
  D1 bindings. Prefer a thin router (Hono is fine and Workers-native) over hand-rolled
  routing.
- **Database**: Cloudflare D1 (SQLite). Migrations via `wrangler d1 migrations`.
- **Dashboard (Phase 5)**: Svelte + Cloudflare Pages. TypeScript.
- **Reporting Action (Phase 6)**: composite action living in **this same repo** at
  `.github/actions/report/`, referenced as
  `uses: <owner>/coverage-tracker/.github/actions/report@vX.Y.Z`. Do NOT split into a
  separate repo — the Action payload and the Worker `/ingest` schema are tightly coupled
  and must stay version-locked.
- **Metrics collection script** (inside the Action): keep language-agnostic. It shells out
  to per-language tools and emits one normalized JSON payload. Tools we standardize on:
  - Coverage: `go test -coverprofile` (Go), `coverage.py`/`pytest-cov` (Python),
    Vitest/Istanbul `coverage-summary.json` (TS).
  - Complexity: `gocyclo`/`gocognit` (Go), `radon` (Python), ESLint complexity rule (TS),
    or `lizard` as a multi-language fallback.
  - Duplication: `jscpd` (supports Go, Python, TS; structured JSON output).
- **License**: MIT.
- **Repo visibility**: public from first push. Scrub all personal IDs/secrets before pushing.

### Auth model (three separate surfaces — do not conflate)

1. **Dashboard login (browser, the deployer viewing their own data)** — Cloudflare Access
   in front of the Pages app, with a GitHub **OAuth App** (not a GitHub App) as the login
   method, and an Access policy restricting to the deployer's own email. **No auth code is
   written by us** — Access handles the OAuth exchange, session cookie, CSRF `state`, etc.
   This is configured per-deployer via the README, not provisioned by the deploy button
   (secrets must stay with the deployer).
2. **CI → `/ingest` (machine)** — GitHub Actions OIDC token. The workflow mints a
   short-lived signed JWT (`token.actions.githubusercontent.com`). The Worker verifies the
   signature against GitHub's JWKS and checks the `repository` / `ref` claims **against the
   registered-projects table** (not merely "is this a valid GitHub token"). This matters
   because the tool is public and self-deployable: without the registered-project check,
   any repo's CI could push fake data. **No static ingest secret** anywhere.
3. **Project registration (GitHub App installation)** — a lightweight GitHub App that the
   deployer installs on the repos/orgs they want tracked. Installing the App *is* the
   registration step. Its webhooks populate the `owners`/`projects` tables.

---

## 4. Phase 1 — D1 schema

Create as the first migration. Design notes inline.

```sql
-- owners: a GitHub user or org that owns tracked repos
CREATE TABLE owners (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id     INTEGER NOT NULL UNIQUE,      -- GitHub's numeric account id (stable across renames)
  login         TEXT    NOT NULL,             -- current login/handle (may change; github_id is the key)
  type          TEXT    NOT NULL CHECK (type IN ('User','Organization')),
  avatar_url    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- projects: a single repo under an owner, registered via App installation
CREATE TABLE projects (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id        INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  github_repo_id  INTEGER NOT NULL UNIQUE,    -- GitHub's numeric repo id (survives renames)
  repo_name       TEXT    NOT NULL,           -- short name, e.g. "coverage-tracker"
  full_slug       TEXT    NOT NULL UNIQUE,    -- "owner/repo", denormalized for fast lookup from OIDC claim
  installation_id INTEGER NOT NULL,           -- GitHub App installation that authorizes this repo
  default_branch  TEXT    NOT NULL DEFAULT 'main', -- source of truth for ingest-gate, baseline, badge; set from repo metadata at registration
  badge_enabled   INTEGER NOT NULL DEFAULT 0, -- 0 = off (default). Per-project opt-in to expose the public /badge number (see A12)
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_projects_owner ON projects(owner_id);
CREATE INDEX idx_projects_installation ON projects(installation_id);

-- metrics: one row per (project, branch, commit, metric)
CREATE TABLE metrics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  branch        TEXT    NOT NULL,
  commit_sha    TEXT    NOT NULL,
  metric_name   TEXT    NOT NULL,             -- 'coverage' | 'complexity' | 'duplication' | future
  value         REAL    NOT NULL,
  unit          TEXT    NOT NULL,             -- '%', 'score', etc.
  recorded_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Primary query is "trend for one repo/branch/metric over time"
CREATE INDEX idx_metrics_trend
  ON metrics(project_id, branch, metric_name, recorded_at);

-- Fast "latest value" lookups for badges and baselines
CREATE INDEX idx_metrics_latest
  ON metrics(project_id, branch, metric_name, commit_sha);
```

Design notes:
- Key on GitHub **numeric ids** (`github_id`, `github_repo_id`), not logins/slugs, so renames
  don't orphan data. Keep `full_slug` denormalized only as a fast lookup path from the OIDC
  `repository` claim.
- `metrics` is append-only. Never update/delete on normal operation. Trends come from
  ordering by `recorded_at`.
- Add a future-friendly retention/pruning consideration (don't build it yet): a scheduled
  Worker cron could prune metrics older than N months per project if D1 ever fills. Out of
  scope now; just don't design anything that prevents it.

---

## 5. Phase 2 — Worker routes

Router skeleton. Each route's auth requirement is explicit — **enforce it, don't assume**.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/ingest` | OIDC + project check | Insert a metrics datapoint (push on main) |
| GET | `/api/projects` | Access (browser session) | List owners → repos for dashboard |
| GET | `/api/projects/:owner/:repo/metrics` | Access | Trend data for one repo |
| GET | `/api/projects/:owner/:repo/baseline` | OIDC + project check | Baseline value for threshold/PR checks |
| GET | `/badge/:owner/:repo/:metric.json` | **public** | Single number, shields.io endpoint format |
| POST | `/webhooks/github` | GitHub webhook HMAC | App install events → owners/projects sync |

Critical auth notes:
- `/badge/...` is the **only** intentionally-public data route, and it returns exactly one
  number in shields.io endpoint format. Everything else with real data is gated.
- `/api/projects/:owner/:repo/baseline` must be **OIDC-gated, project-scoped** — NOT public.
  It's read by the Action during threshold/PR checks. Do not let it become a "just reading my
  baseline" side door that leaks coverage numbers. The deployer explicitly does not want
  coverage data public.
- `/ingest` and `/baseline` both verify: (a) OIDC JWT signature against GitHub JWKS,
  (b) `repository` claim resolves to a row in `projects`, (c) for ingest, only persist on the
  configured default branch.

### `/ingest` payload shape (this is the contract with the Action — version it)

```json
{
  "repository": "owner/repo",
  "branch": "main",
  "commit_sha": "abc123...",
  "metrics": [
    { "name": "coverage",    "value": 82.4, "unit": "%" },
    { "name": "complexity",  "value": 4.2,  "unit": "score" },
    { "name": "duplication", "value": 1.8,  "unit": "%" }
  ]
}
```

The `repository`/`branch`/`commit_sha` are cross-checked against the OIDC token claims; the
client cannot spoof a different repo than the one its token was minted for.

---

## 6. Phase 3 — GitHub App registration webhooks

The App is how projects get created. Worker handles these webhook events at
`/webhooks/github` (verify HMAC signature with the App's webhook secret first, always):

- `installation` (`action: created`) → upsert owner + all included repos into
  `owners`/`projects` with the `installation_id`.
- `installation` (`action: deleted`) → remove all projects for that `installation_id`.
- `installation_repositories` (`added`/`removed`) → add/remove individual projects.

Resilience requirement (build this now, it's cheap): webhooks can be missed (delivery
failure, or repos that existed before the Worker was deployed). Add a **manual resync**
path — an authenticated endpoint or a `wrangler`-invokable script — that fetches
`GET /installation/repositories` with a fresh installation token and reconciles the
`projects` table. Don't rely on webhooks as the only source of truth.

---

## 7. Phases 4 & PR checks — DESIGN FOR NOW, build later

Not in the current core build, but the schema and routes above must already support them:

- **Thresholds** live as **inputs to the reporting Action** in each repo's workflow
  (`min-coverage: 80`, `max-coverage-drop: 2`), NOT as dashboard/D1 config. No settings UI.
- The Action reads a baseline via `GET .../baseline?metric=coverage&branch=main` (the gated
  endpoint above), compares current vs. baseline, and fails the job (non-zero exit) when a
  threshold is breached. Same mechanism covers absolute floors and relative drops.
- **PR checks** are the same logic on a `pull_request` trigger: compute metrics on the PR
  branch, fetch the main baseline, diff, post a PR comment via `GITHUB_TOKEN`.
  - Fork PRs don't get write `GITHUB_TOKEN` by default — handle/flag this.
  - Optional richer UX (later): use the GitHub App installation token to post a **Check Run**
    with line-level annotations instead of a plain comment.
  - **PR-trigger jobs read and compare only; they NEVER persist to `metrics`.** Persistence
    happens only on push-to-default-branch. This keeps trend history clean.

---

## 8. Phases 5–8 — later, but don't foreclose

- **Dashboard (Svelte/Pages)**: top-level view groups owners/orgs, each showing their repos
  as cards with latest values + sparklines; drill-in shows full trend charts with a branch
  selector per metric. Sits behind Cloudflare Access. Charting lib: keep it light
  (uPlot or Chart.js).
- **Composite reporting Action**: in this repo at `.github/actions/report/`. Wraps the
  collection script + OIDC POST. Inputs: `worker-url`, threshold knobs. Version-locked to
  the Worker by tagging the whole repo together. **Testing strategy (three layers, decided):**
  - *Layer 1 (prerequisite):* vitest unit tests for the pure helpers in `src/run.ts`
    (`parseThreshold`, `buildSummary`, etc.). vitest's `json-summary` coverage reporter
    emits `coverage/coverage-summary.json` in the Istanbul shape `collect.sh` already
    parses — the Action dogfoods itself, and the self-test workflow reads real coverage
    instead of a hardcoded fake.
  - *Layer 2:* a committed bash fixture script (`test/collect-parsers.sh`) that pipes sample
    tool output through each inline Python parser in `collect.sh` and asserts the result.
    This is the only way to cover the Go/Python/lizard parser branches, since those tools
    are absent from this repo's CI environment.
  - *Layer 3 (follow-on):* `@cloudflare/vitest-pool-workers` Worker route tests — OIDC
    middleware rejection cases, ingest idempotency, baseline gating. Real setup cost;
    does not block the self-test.
  - Self-test workflow: `.github/workflows/action-test.yml` in this repo, using the local
    action path `uses: ./.github/actions/report` and `coverage-report-js` pointing at the
    vitest output. See `docs/PROGRESS.md` Phase 6 for the full checklist and workflow.
- **Deploy to Cloudflare button**: relies on `wrangler` config declaring the D1 binding so
  Cloudflare auto-provisions it on fork+deploy, including running D1 migrations via the
  `package.json` deploy script (reference the **binding name**, not the DB name, so it works
  when the user picks a different DB name). The GitHub OAuth App (Access login) and GitHub
  App (registration) are created manually by each deployer per README — they hold secrets the
  button must not provision.
- **Docs/OSS**: README walking the manual steps (create OAuth App, create GitHub App,
  configure Access policy, click deploy), CONTRIBUTING.md, issue templates, secret scrub.

---

## 9. Recommended build order for THIS session (core first)

1. Repo scaffold: `wrangler` project, TypeScript, Hono router, `package.json`, `.gitignore`,
   MIT `LICENSE`. Public-repo-safe from the start (no secrets committed; use
   `wrangler secret` / env bindings).
2. D1 schema as first migration (Section 4). Apply locally, verify.
3. Worker routes (Section 5) with auth middleware stubbed but structured correctly:
   - OIDC verification helper (JWKS fetch + cache + claim checks).
   - GitHub webhook HMAC verification helper.
   - Project-lookup-from-claim helper.
4. `/webhooks/github` handler (Section 6) + manual resync path.
5. `/ingest`, `/api/projects`, `/api/projects/:owner/:repo/metrics`, `/baseline`, `/badge`.
6. Local tests with `wrangler dev` and a mock OIDC token / mock webhook payloads.
7. Stop at a working, tested core. Dashboard, Action, and deploy button are later phases.

---

## 10. Guardrails / non-negotiables (repeat to yourself while building)

- One-instance-per-deployer. No multi-tenant complexity.
- Coverage data is **private**. Only `/badge` (one number) is public. Everything else gated.
- Ingest auth is **OIDC + registered-project check**. No static ingest secret.
- Key DB rows on GitHub numeric ids, not mutable logins/slugs.
- `metrics` is append-only; PR jobs never write to it.
- Action lives in this repo, version-locked to the Worker. Don't split it out.
- Dashboard login is Cloudflare Access + GitHub OAuth App — we write zero auth-exchange code.
- Public repo: no personal IDs/secrets in source, ever.

---

## Appendix A — Security review

Threat-model assumption for everything below: **the source is public and self-deployable, so
an attacker has read the full code.** Security must come from real gating, never from obscurity
of endpoints or payload shapes. Findings are ordered by severity.

### A1. (CRITICAL) OIDC tokens must validate `aud`, `iss`, and algorithm — not just signature

The plan says "verify signature against JWKS + check `repository`/`ref`." That is necessary but
**not sufficient**. A GitHub Actions OIDC token is a general-purpose credential; its default
audience is the repo owner's URL, and the *same* repo's CI could mint a validly-signed token for
some *other* service and have it replayed against `/ingest`.

Required, in addition to signature:
- **Pin `iss`** to exactly `https://token.actions.githubusercontent.com`. Reject anything else.
- **Require a custom `aud`** — set a fixed audience (e.g. the deployer's Worker URL or a constant
  like `coverage-tracker`) and have the Action request that exact audience via
  `core.getIDToken(audience)`. Reject tokens whose `aud` doesn't match. Without this, signature
  validity alone is meaningless.
- **Pin the algorithm to RS256.** Reject `alg: none` and reject HS256 (classic
  public-key-as-HMAC-secret confusion). Use a JWT lib that lets you whitelist the alg explicitly.

### A2. (CRITICAL) Cloudflare Access only protects the hostname — the raw `workers.dev` URL bypasses it

Access gates the *route/hostname* it's configured on. The underlying `*.workers.dev` URL (and any
unprotected custom route) stays directly reachable, so anyone hitting the Worker URL directly skips
Access entirely and reaches `/api/projects`, `/api/.../metrics`, etc. — all the gated, private
coverage data.

Fix (do both):
- In the Worker, **verify the `Cf-Access-Jwt-Assertion` header** on every Access-gated route:
  validate it against your Access application's public keys (the team's `/cdn-cgi/access/certs`)
  and check the `aud` matches your Access app. Do not trust "Access is in front of me."
- Set `workers_dev = false` in `wrangler` config and only serve via the Access-protected custom
  domain, removing the bypass route.

### A3. (HIGH) Trust the OIDC token claims over the request body for repo/branch/commit

`/ingest` receives `repository`, `branch`, `commit_sha` in the JSON body — all attacker-controlled.
The OIDC token already carries authoritative `repository`, `ref`, and `sha` claims. Don't merely
"cross-check" the body against the token; **derive the persisted repo/branch/commit from the token
claims and ignore or strictly reject any body value that disagrees.** The body should really only
carry the metric values. Also: `ref` may be a tag (`refs/tags/...`), not a branch — reject non-branch
refs for the persist-on-default-branch rule rather than mis-parsing a tag as a branch name.

### A4. (HIGH) GitHub App private key: storage and least privilege

Minting installation tokens (for resync and Check Runs) requires the App private key. Two
requirements the plan currently omits:
- Store it **only** as a `wrangler secret`, never in source (public repo — a committed key is a
  permanent leak even after deletion; rotation would be mandatory).
- **Scope App permissions minimally.** Registration needs only repository `metadata: read`.
  Check Runs (if adopted in Phase 4) add `checks: write`. Request nothing else — no `contents`,
  no `pull_requests` write unless a feature truly needs it. An over-permissioned App is the
  blast radius if the key ever leaks.

### A5. (HIGH) Webhook signature must use constant-time comparison + replay handling

`/webhooks/github` is public; the HMAC is its only gate, and it is load-bearing (a forged
`installation: created` could register arbitrary repos, which then authorizes those repos' OIDC
tokens to ingest). Two pitfalls:
- Compare the computed and received signatures with a **timing-safe** comparison (`crypto.subtle`
  / equivalent), never `===` — naive comparison is a known signature-bypass vector.
- Consider lightweight **replay protection** by deduping on GitHub's `X-GitHub-Delivery` id, so a
  captured `installation: deleted` can't be replayed to wipe projects.

### A6. (MEDIUM) The manual resync path needs a defined auth model

The plan leaves resync as "an authenticated endpoint *or* a wrangler script." As an unauthenticated
HTTP endpoint it's an abuse vector (forces installation-token API calls, can rewrite the projects
table). Pick one: make it a **`wrangler`-invoked script** that uses bindings directly with no public
HTTP surface (preferred), or if it must be HTTP, gate it behind Access *and* verify the Access JWT
per A2.

### A7. (MEDIUM) Rate-limit the public and crypto-heavy routes

`/badge` and `/webhooks/github` are public; `/ingest` and `/baseline` run JWKS fetches + signature
crypto before rejecting a bad token. On the free tier (100k requests/day) an attacker can both
exhaust the request budget (availability DoS) and burn CPU. Add Cloudflare WAF/rate-limiting rules
in front, and do the cheapest possible pre-checks (presence/shape of token, known `kid`) before
expensive crypto.

### A8. (MEDIUM) JWKS caching must handle key rotation

Fetching GitHub's JWKS on every `/ingest` is slow and a self-inflicted DoS; caching it forever
breaks when GitHub rotates signing keys. Cache with a TTL **and** refetch-on-unknown-`kid` (a token
whose `kid` isn't in cache triggers one refresh before rejecting). This is correctness + availability,
not just performance.

### A9. (MEDIUM) Secret hygiene for a public repo

Use a gitignored `.dev.vars` for local secrets; never commit real values even transiently. Document
that any secret that ever touches git history must be rotated, because public history is permanent.
Add a pre-commit secret scan (e.g. gitleaks) to CI before the repo goes public.

### A10. (LOW) Parameterized queries only

`:owner`, `:repo`, `:metric` are attacker-controlled URL params that flow into D1 queries. Always use
prepared statements with `.bind()`; never string-interpolate path params into SQL. Standard, but
state it so it isn't forgotten.

### A11. (LOW) Idempotent ingest to survive token replay

Within an OIDC token's validity window a captured token can be replayed, and `metrics` is append-only,
so replays produce duplicate datapoints that skew trends. Add a unique constraint / upsert on
`(project_id, commit_sha, metric_name)` so re-ingesting the same commit's metric is a no-op rather
than a duplicate.

### A12. (DESIGN DECISION) The badge endpoint *is* public coverage data

Section 10 asserts "coverage data is private" while `/badge` is public. These are in tension: a badge
is, by definition, the latest coverage number exposed publicly, and `/badge/:owner/:repo/:metric`
also lets anyone enumerate which repos are tracked and read their current number. This is probably
fine (a badge in a public README is meant to be seen) — but it should be a conscious choice, not an
asserted-then-contradicted invariant. Suggested resolution: add a per-project `badge_enabled` flag
(default off), so exposing the single number is opt-in per repo and trends/file-level detail always
stay private. See questions below.

---

## Appendix B — Resolved design decisions

These four were confirmed by the deployer and supersede any conflicting language above.

1. **OIDC audience (A1):** the `aud` claim is a **fixed constant string `coverage-tracker`** for
   every deployment. The reporting Action requests this exact audience via
   `core.getIDToken('coverage-tracker')`, and the Worker rejects any token whose `aud` is not
   exactly `coverage-tracker`. Identical Action config across all deployers; no per-instance
   audience value.

2. **Badge privacy (A12):** confirmed — `badge_enabled` per-project flag, **default `0` (off)**
   (now in the `projects` schema). `/badge` returns data only for projects with the flag on;
   for all others it returns 404 (not 403 — don't confirm existence). Toggling the flag before
   the dashboard UI exists is done via the `wrangler`-invoked admin script (same path as resync).

3. **Check Runs (A4):** the **richer PR experience is in scope.** The GitHub App therefore needs
   `metadata: read` **and** `checks: write`. Request nothing beyond those two.

   **Posting mechanism — Option A now:** the reporting Action posts the Check Run itself using the
   workflow's `GITHUB_TOKEN`, elevated with `permissions: checks: write` in the consuming workflow.
   Per-line coverage data is computed during the PR run and used to build annotations **on the
   runner**; it is ephemeral and never sent to the Worker or persisted to D1 (the `metrics` table
   stays aggregate-only, and PR jobs never write to it). The App's `checks: write` permission is
   declared now so it's already present when needed, even though Option A uses `GITHUB_TOKEN`.

   **Known limitation of Option A:** fork PRs receive a read-only `GITHUB_TOKEN`, so pull requests
   **from forks will not get a Check Run.** This is acceptable for the initial release.

   **Option C — deferred, implement on user demand:** if/when fork-PR coverage checks are requested,
   add a Worker-posts path: the Action sends annotation data to a new OIDC-gated `/checks` endpoint,
   and the Worker posts the Check Run using its own App installation token (no token ever handed to
   the runner; line-level data transits the Worker ephemerally and is still never persisted). Build
   Option A now in a way that doesn't foreclose this — keep annotation construction separable from
   the posting step so the post target can later switch from "GITHUB_TOKEN on runner" to "Worker
   endpoint" without reworking the metrics collection. Do **not** build the `/checks` endpoint or
   the token-minting path until there is an actual feature request for fork support.

4. **Resync (A6):** **Phase-now:** a `wrangler`-invoked script with no public HTTP surface.
   **Phase 5 (dashboard):** promote it to an auth-protected button/action in the UI that triggers
   the same reconciliation logic behind Access (with `Cf-Access-Jwt-Assertion` verification per A2).
   Build the resync logic now as a callable function so both entry points can share it.
