# coverage-tracker

A self-hosted dashboard that tracks code coverage, cyclomatic complexity, and code duplication across your GitHub repositories — with trend charts, per-PR diff checks, and README badges.

Runs entirely on your own Cloudflare account (Worker + D1 + Pages). Your data stays in your own database. No SaaS, no subscriptions, no third-party access to your metrics.

---

## How it works

1. **Install the GitHub App** on the repos you want to track. The Worker registers them automatically via webhook.
2. **Add a workflow step** to your CI that runs the reporting Action after your test suite. It collects coverage/complexity/duplication numbers and pushes them to the Worker using a GitHub Actions OIDC token — no static secrets.
3. **View trends** in the Cloudflare Pages dashboard, protected by Cloudflare Access so only you can see it.
4. Optionally **embed a badge** in your README.

```
┌─────────────────────────────────────────────────────────┐
│  Your CI (GitHub Actions)                               │
│                                                         │
│  run tests → collect metrics → POST /ingest             │
│              (OIDC token, no static secret)             │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│  Cloudflare Worker  (coverage-tracker.yourdomain.com)   │
│                                                         │
│  /ingest     ← OIDC-verified, project-scoped            │
│  /api/*      ← Cloudflare Access (browser session)      │
│  /badge/*    ← public (per-project opt-in)              │
│  /webhooks/* ← GitHub HMAC                              │
│  /admin/*    ← Cloudflare Access                        │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│  Cloudflare D1  (your SQLite database)                  │
│  owners · projects · metrics                            │
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
5. Configure Cloudflare Zero Trust and deploy the Worker
6. Install the GitHub App on your repos

---

## Badge

Once a repo has metrics ingested and `badge_enabled` is turned on, add this to your README:

```markdown
![Coverage](https://coverage-tracker.yourdomain.com/badge/owner/repo/coverage.json)
```

The endpoint returns [shields.io endpoint format](https://shields.io/endpoint), so you can use the shields.io URL builder to customise the label and style:

```markdown
![Coverage](https://img.shields.io/endpoint?url=https://coverage-tracker.yourdomain.com/badge/owner/repo/coverage.json)
```

Available metric names: `coverage`, `complexity`, `duplication`.

To enable the badge for a project:

```bash
# Find the project ID
npx wrangler d1 execute DB --remote --command "SELECT id, full_slug FROM projects"

# Enable badge
curl -X PATCH https://coverage-tracker.yourdomain.com/admin/projects/1/badge \
  -H "Cf-Access-Jwt-Assertion: <your-access-token>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

---

## Project layout

```
.
├── migrations/           # D1 schema migrations
├── src/
│   ├── index.ts          # Hono app entry point
│   ├── types.ts          # Bindings and shared types
│   ├── middleware/
│   │   ├── access.ts     # Cloudflare Access JWT verification
│   │   ├── oidc.ts       # GitHub Actions OIDC JWT verification
│   │   └── webhook.ts    # GitHub webhook HMAC + replay protection
│   ├── lib/
│   │   ├── db.ts         # D1 query helpers
│   │   ├── github.ts     # GitHub App token minting
│   │   └── resync.ts     # Installation reconciliation
│   └── routes/
│       ├── ingest.ts     # POST /ingest
│       ├── api.ts        # GET /api/*
│       ├── badge.ts      # GET /badge/*
│       ├── webhooks.ts   # POST /webhooks/github
│       └── admin.ts      # POST /admin/*
├── docs/
│   ├── INSTALLATION.md   # Setup guide
│   ├── PROGRESS.md       # Phase implementation status
│   └── plans/            # Design documents
├── wrangler.example.jsonc  # Config template — copy to wrangler.jsonc and fill in
└── .dev.vars.example       # Local secrets template — copy to .dev.vars and fill in
```

---

## API reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/ingest` | OIDC token | Push a metrics datapoint from CI |
| `GET` | `/api/projects` | Access | List all registered owners and repos |
| `GET` | `/api/projects/:owner/:repo/metrics` | Access | Trend data for one repo |
| `GET` | `/api/projects/:owner/:repo/baseline` | OIDC token | Latest value on default branch (for threshold checks) |
| `GET` | `/badge/:owner/:repo/:metric.json` | Public | shields.io endpoint — only for `badge_enabled` repos |
| `POST` | `/webhooks/github` | GitHub HMAC | GitHub App installation events |
| `POST` | `/admin/resync` | Access | Reconcile projects table against GitHub |
| `PATCH` | `/admin/projects/:id/badge` | Access | Toggle badge visibility |

### `/ingest` payload

```json
{
  "metrics": [
    { "name": "coverage",    "value": 82.4, "unit": "%" },
    { "name": "complexity",  "value": 4.2,  "unit": "score" },
    { "name": "duplication", "value": 1.8,  "unit": "%" }
  ]
}
```

`repository`, `branch`, and `commit_sha` are derived from the OIDC token claims — the body values are ignored for those fields.

---

## Development

```bash
npm install
cp wrangler.example.jsonc wrangler.jsonc   # fill in your D1 database ID and domain
cp .dev.vars.example .dev.vars             # fill in local secrets
npm run db:migrate:local                   # apply schema to local D1
npm run dev                                # start local Worker
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
| 1 | D1 schema | Complete |
| 2 | Worker core (ingest, metrics, badge) | Complete |
| 3 | GitHub App webhooks | Complete |
| 4 | Thresholds + PR diff checks | Complete |
| 5 | Svelte dashboard (Cloudflare Pages) | Planned |
| 6 | Composite reporting Action | Complete |
| 7 | "Deploy to Cloudflare" button | Planned |
| 8 | Docs, OSS hygiene, public release | In progress |

---

## License

MIT — see [LICENSE](LICENSE).
