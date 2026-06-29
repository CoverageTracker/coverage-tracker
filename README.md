# coverage-tracker

![Endpoint Badge](https://img.shields.io/endpoint?url=https%3A%2F%2Fdemo.coveragetracker.dev%2Fapi%2Fbadge%2FCoverageTracker%2Fcoverage-tracker%2Fcoverage.json)

A self-hosted dashboard that tracks code coverage, cyclomatic complexity, and code duplication across your GitHub repositories — with trend charts, per-PR diff checks, and README badges.

Runs entirely on your own Cloudflare account (Worker + D1). Your data stays in your own database. No SaaS, no subscriptions, no third-party access to your metrics.

<table>
  <tr>
    <td align="center"><img src="screenshots/1-catppuccin.png" alt="Catppuccin theme"><br><sub>Catppuccin</sub></td>
    <td align="center"><img src="screenshots/2-gruvbox.png" alt="Gruvbox theme"><br><sub>Gruvbox</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="screenshots/3-nord.png" alt="Nord theme"><br><sub>Nord</sub></td>
    <td align="center"><img src="screenshots/4-solarized.png" alt="Solarized theme"><br><sub>Solarized</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="screenshots/5-dracula.png" alt="Dracula theme"><br><sub>Dracula</sub></td>
    <td align="center"><img src="screenshots/6-tokyo-night.png" alt="Tokyo Night theme"><br><sub>Tokyo Night</sub></td>
  </tr>
</table>

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/CoverageTracker/coverage-tracker)

> [!NOTE]
> The button deploys the Worker and provisions the D1 database automatically. You still need to complete the GitHub App, Cloudflare Zero Trust, and secrets setup described in [docs/INSTALLATION.md](docs/INSTALLATION.md).

---

## How it works

1. **Install the GitHub App** on the repos you want to track. The Worker registers them automatically via webhook.
2. **Add a workflow step** to your CI that runs the reporting Action after your test suite. It collects coverage/complexity/duplication numbers and pushes them to the Worker using a GitHub Actions OIDC token — no static secrets.
3. **View trends** in the dashboard (served as static assets by the Worker), protected by Cloudflare Access so only you can see it.
4. Optionally **embed a badge** in your README.

```
┌─────────────────────────────────────────────────────────┐
│  Your CI (GitHub Actions)                               │
│                                                         │
│  run tests → collect metrics → POST /api/ci/coverage    │
│              (OIDC token, no static secret)             │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│  Cloudflare Worker  (coverage-tracker.yourdomain.com)   │
│                                                         │
│  POST /api/ci/coverage  ← OIDC-verified, project-scoped │
│  GET  /api/projects/*   ← Cloudflare Access JWT         │
│  GET  /api/badge/*      ← public (per-project opt-in)   │
│  POST /api/webhooks/*   ← GitHub HMAC                   │
│  POST /api/admin/*      ← Cloudflare Access JWT         │
│  GET  /api/health       ← public                        │
│  *                      ← dashboard SPA (static assets) │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│  Cloudflare D1  (your SQLite database)                  │
│  owners · projects · coverage_runs · coverage_daily     │
└─────────────────────────────────────────────────────────┘
```

---

## Features

- **No static ingest secret** — CI authenticates with a GitHub Actions OIDC token. The Worker verifies the signature and checks the `repository` claim against your registered projects, so only your registered repos can push data.
- **Private by default** — all data routes are behind Cloudflare Access. Badge numbers are opt-in per repo.
- **Append-only metrics** — trend history is never modified. PR jobs read baselines but never write.
- **Multi-repo** — one instance tracks all the repos you install the GitHub App on.
- **Idempotent ingest** — re-running CI for the same commit is a safe no-op.
- **shields.io badge format** — drop a badge into any README with a one-liner.

---

## Getting started

See **[docs/INSTALLATION.md](docs/INSTALLATION.md)** for the full setup guide. The short version:

1. Add your domain to Cloudflare (DNS must be proxied through Cloudflare)
2. Create the D1 database and apply the migration
3. Create a GitHub App (for webhooks + API access)
4. Create a GitHub OAuth App (for Cloudflare Access login)
5. Configure Cloudflare Zero Trust and deploy the Worker (the dashboard SPA deploys with it automatically)
6. Install the GitHub App on your repos

---

## Badge

Once a repo has metrics ingested and `badge_enabled` is turned on, add this to your README:

```markdown
![Coverage](https://coverage-tracker.yourdomain.com/api/badge/owner/repo/coverage.json)
```

The endpoint returns [shields.io endpoint format](https://shields.io/endpoint), so you can use the shields.io URL builder to customise the label and style:

```markdown
![Coverage](https://img.shields.io/endpoint?url=https://coverage-tracker.yourdomain.com/api/badge/owner/repo/coverage.json)
```

Available metric names: `coverage`, `complexity`, `duplication`.

To enable the badge for a project:

```bash
# Find the project ID
npx wrangler d1 execute DB --remote --command "SELECT id, full_slug FROM projects"

# Enable badge
curl -X PATCH https://coverage-tracker.yourdomain.com/api/admin/projects/1/badge \
  -H "Cf-Access-Jwt-Assertion: <your-access-token>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

---

## Project layout

```
.
├── migrations/           # D1 schema migrations (0001 owners/projects, 0002 coverage_runs/daily)
├── src/
│   ├── index.ts          # Hono app entry point + scheduled cron handler
│   ├── types.ts          # Bindings and shared types
│   ├── middleware/
│   │   ├── access.ts     # Cloudflare Access JWT verification
│   │   ├── oidc.ts       # GitHub Actions OIDC JWT verification
│   │   └── webhook.ts    # GitHub webhook HMAC + replay protection
│   ├── lib/
│   │   ├── db.ts         # D1 query helpers
│   │   ├── github.ts     # GitHub App token minting
│   │   ├── metrics.ts    # Metric name → column mapping
│   │   └── resync.ts     # Installation reconciliation
│   ├── db/
│   │   └── rollup.ts     # Daily coverage_runs → coverage_daily rollup + prune
│   └── routes/
│       ├── ci.ts         # POST /api/ci/coverage
│       ├── baseline.ts   # GET  /api/baseline/:owner/:repo
│       ├── api.ts        # GET  /api/projects/*
│       ├── badge.ts      # GET  /api/badge/*
│       ├── webhooks.ts   # POST /api/webhooks/github
│       └── admin.ts      # POST /api/admin/*
├── dashboard/            # SvelteKit 5 source; builds to dashboard/build/ (served by Worker)
│   └── src/routes/       # Overview + per-repo drill-in views
├── .github/
│   ├── actions/report/   # Composite reporting Action (collect + ingest + Check Runs)
│   └── workflows/        # CI: action-test.yml, deploy.yml
├── scripts/
│   └── setup-waf-rules.mjs  # WAF skip rule for /api/ci/coverage + /api/webhooks/github
├── test/
│   ├── seed-local.sql       # Local D1 seed data
│   └── collect-parsers.sh   # Parser fixture tests for collect.sh
├── docs/
│   ├── INSTALLATION.md   # Setup guide
│   ├── PROGRESS.md       # Phase implementation status
│   └── plans/            # Design documents
├── wrangler.example.jsonc  # Config template — copy to wrangler.json and fill in
└── .dev.vars.example       # Local secrets template — copy to .dev.vars and fill in
```

---

## API reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/ci/coverage` | OIDC token | Push typed coverage metrics from CI |
| `GET` | `/api/projects` | Access | List all registered owners and repos |
| `GET` | `/api/projects/:owner/:repo/metrics` | Access | Trend data for one repo |
| `GET` | `/api/baseline/:owner/:repo` | OIDC token | Latest value on default branch (threshold checks) |
| `GET` | `/api/badge/:owner/:repo/:metric.json` | Public | shields.io endpoint — only for `badge_enabled` repos |
| `POST` | `/api/webhooks/github` | GitHub HMAC | GitHub App installation events |
| `POST` | `/api/admin/resync` | Access | Reconcile projects table against GitHub |
| `PATCH` | `/api/admin/projects/:id/badge` | Access | Toggle badge visibility |
| `GET` | `/api/health` | Public | Liveness check |

### `/api/ci/coverage` payload

```json
{
  "line_coverage": 82.4,
  "branch_coverage": 79.1,
  "cyclomatic": 4.2,
  "cognitive": 2.1,
  "duplication_pct": 1.8,
  "maintainability": 95.0
}
```

`line_coverage` is required; all other fields are optional. `repository`, `branch`, and `commit_sha` are derived from the OIDC token claims — they are not accepted in the body.

---

## Development

```bash
npm install
npm --prefix dashboard install             # install dashboard dependencies
cp wrangler.example.jsonc wrangler.json   # fill in your D1 database ID
cp .dev.vars.example .dev.vars             # fill in local secrets
npm run db:migrate:local                   # apply schema to local D1
npm run dev                                # start Worker + SPA (builds dashboard first)
```

Type-check:

```bash
npm run typecheck
```

Deploy:

```bash
npm run db:migrate:remote
npm run deploy
```

---

## Implementation status

See [docs/PROGRESS.md](docs/PROGRESS.md) for a full breakdown. Current state:

| Phase | Description | Status |
|-------|-------------|--------|
| 1–6 | Core Worker, webhooks, dashboard, reporting Action | Complete |
| — | Convergence refactor (single Worker + static assets) | Complete |
| 7 | "Deploy to Cloudflare" button | In progress |
| 8 | Docs, OSS hygiene, public release | In progress |

---

## License

MIT — see [LICENSE](LICENSE).
