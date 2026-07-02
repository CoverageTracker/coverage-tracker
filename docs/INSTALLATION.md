<!-- GENERATED from coveragetracker.dev src/lib/docs-content (03-quick-start.svx, 04-prerequisites.svx, 05-domain-database.svx, 06-github-app.svx, 07-cloudflare-access.svx, 08-secrets.svx, 09-deploy.svx, 10-verify.svx, 11-ingest.svx, 13-badges.svx, 14-dashboard.svx) — do not edit here -->

# Installation Guide

This guide walks through deploying coverage-tracker to your own Cloudflare account.
Follow the sections in order — several decisions depend on values produced by earlier steps.

---

## Quick start

If you already run on Cloudflare, the whole setup is six moves. Each links to its full section below.

1. Add your domain to Cloudflare (DNS proxied through Cloudflare).
2. Create the D1 database and apply the migration.
3. Create a **GitHub App** (webhooks + API access).
4. Create a **GitHub OAuth App** (Cloudflare Access login).
5. Configure Cloudflare Zero Trust, set secrets, and deploy the Worker.
6. Install the GitHub App on your repos.

Or skip the manual route entirely — the **Deploy to Cloudflare** button provisions the Worker and D1 automatically. You still complete the GitHub App, Zero Trust, and secrets steps afterward.

```bash file="clone & install"
git clone https://github.com/your-org/coverage-tracker
cd coverage-tracker
npm install
```

---

## Prerequisites

- A **Cloudflare account** (free tier is sufficient).
- A **domain managed by Cloudflare** — DNS must be proxied through Cloudflare.
- A **GitHub account** (personal or org) with admin access to the repos you want to track.
- **Node.js 18+** and **npm** installed locally.
- **Wrangler** authenticated: `npx wrangler login`.

If your domain's DNS lives elsewhere, add the domain in the Cloudflare dashboard, pick the Free plan, and replace the registrar's nameservers with the two Cloudflare provides. You do **not** need to create a DNS record for the Worker subdomain — the deploy step handles that.

---

## Domain & database

Create your D1 database, then wire its id into `wrangler.json` and apply the schema migration.

```bash file="create D1"
npx wrangler d1 create coverage
```

Copy the `database_id` from the output into the `d1_databases` entry of `wrangler.json`:

```jsonc file="wrangler.json"
{
  // ...
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "coverage",
      "database_id": "paste-your-id-here",   // ← add this line
      "migrations_dir": "migrations"
    }
  ],
  // ...
}
```

Then apply the migration to your remote database:

```bash file="migrate"
npm run db:migrate:remote
```

> [!NOTE]
> The committed `wrangler.json` intentionally omits `database_id` so the Deploy to Cloudflare button can provision D1 automatically. For manual installs, add the field as shown. The custom domain is attached in the Cloudflare dashboard after first deploy — no `routes` entry is needed.

---

## GitHub App

> [!WARNING]
> **Two separate integrations**
> The **GitHub App** (this step) handles webhook events and API access. The **GitHub OAuth App** (next section) handles dashboard login via Cloudflare Access. Create them separately — do not conflate them.

From the account or org that will host the app, go to **Settings → Developer settings → GitHub Apps → New GitHub App** and fill in:

<table class="deftable">
  <thead><tr><th>Field</th><th>Value</th></tr></thead>
  <tbody>
    <tr><td>GitHub App name</td><td>Globally unique, e.g. <code>your-coverage-tracker</code></td></tr>
    <tr><td>Homepage URL</td><td><code>https://coverage-tracker.yourdomain.com</code></td></tr>
    <tr><td>Webhook → Active</td><td>checked</td></tr>
    <tr><td>Webhook URL</td><td><code>…/webhooks/github</code></td></tr>
    <tr><td>Webhook secret</td><td>Generate 32 random bytes — save this value:<br /><code>node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"</code></td></tr>
  </tbody>
</table>

Leave **Callback URL**, **OAuth during installation**, and **Setup URL** blank. Under repository permissions set **Metadata: read-only** and **Checks: read & write** — nothing else. Subscribe to both **Installation target** and **Installation repositories** events. For a private instance, choose **Only on this account**.

### Convert the private key

GitHub downloads a PKCS#1 `.pem`; the Worker requires PKCS#8. Convert it with Node — no OpenSSL needed:

```bash file="convert key"
node -e "const c=require('crypto'), fs=require('fs');
const key=c.createPrivateKey(fs.readFileSync(process.argv[1],'utf8'));
process.stdout.write(key.export({type:'pkcs8',format:'pem'}));" \
  your-app.private-key.pem | npx wrangler secret put GITHUB_APP_PRIVATE_KEY
```

From the app's settings page, note the **App ID** and **Client ID** — you set these as secrets next.

---

## Cloudflare Access

In **Zero Trust**, choose a team name (becomes `myteam.cloudflareaccess.com`). Then create a **GitHub OAuth App** for dashboard login with callback URL `https://myteam.cloudflareaccess.com/cdn-cgi/access/callback`, and add GitHub as an identity provider in **Settings → Authentication** using that OAuth App's client id and secret.

You will create **two** Access applications for the same hostname. The Dashboard app redirects visitors through GitHub login and sets a `CF_Authorization` session cookie, which the Worker verifies on subsequent browser API calls; the API Bypass app is more specific (`/api`), so Cloudflare applies it to machine callers — CI OIDC, webhooks, health checks, badges — that cannot complete the browser OAuth flow.

<table class="deftable">
  <thead><tr><th>App</th><th>Path</th><th>Policy</th></tr></thead>
  <tbody>
    <tr><td>Dashboard (Allow)</td><td><em>blank — whole host</em></td><td>Allow → your email. Copy the <strong>AUD tag</strong> → <code>CF_ACCESS_AUD</code></td></tr>
    <tr><td>API Bypass</td><td><code>/api</code></td><td>Bypass → Everyone</td></tr>
  </tbody>
</table>

> [!WARNING]
> **Critical invariant**
> Never put an Access *Allow* policy on `/api/*`. Machine callers (CI OIDC, webhooks, health) must reach the Worker unauthenticated at the edge — API auth is enforced in code. The bypass only removes the edge OAuth redirect; no `/api/*` route is left unprotected.

---

## Secrets

Set every value with `wrangler secret put` — secrets are never committed. `wrangler.json` references names only.

```bash file="wrangler secrets"
npx wrangler secret put GITHUB_APP_ID          # numeric, e.g. 1234567
npx wrangler secret put GITHUB_APP_CLIENT_ID   # starts with "Iv23…"
npx wrangler secret put GITHUB_APP_PRIVATE_KEY # if not piped earlier
npx wrangler secret put GITHUB_WEBHOOK_SECRET  # from the GitHub App step
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN  # myteam.cloudflareaccess.com
npx wrangler secret put CF_ACCESS_AUD          # AUD tag UUID from Access app
```

> [!WARNING]
> **Never set in production**
> `DEV_BYPASS_SECRET` belongs only in `.dev.vars` for local dev. Setting it via `wrangler secret put` silently disables all Access JWT verification.

---

## Deploy the Worker

Make sure dashboard dependencies are installed, then deploy. The command applies pending D1 migrations and compiles the SvelteKit dashboard before uploading.

```bash file="deploy"
npm --prefix dashboard install
npm run deploy

# Deployed coverage-tracker triggers
#   coverage-tracker.yourdomain.com (custom domain)
```

If **Bot Fight Mode** or **Browser Integrity Check** is enabled on your zone, add WAF skip rules for the machine-caller routes (this is separate from the Access bypass — Bot Fight Mode fires before Access):

```bash file="WAF skip rules"
CLOUDFLARE_API_TOKEN=<token> ZONE_DOMAIN=yourdomain.com \
  node scripts/setup-waf-rules.mjs
```

---

## Install & verify

From the GitHub App's settings page → **Install App** → choose the account or org → select repos. This fires an `installation: created` webhook that populates the `owners` and `projects` tables.

Confirm the webhook landed:

```bash file="verify"
npx wrangler d1 execute DB --remote \
  --command "SELECT * FROM owners"

npx wrangler d1 execute DB --remote \
  --command "SELECT full_slug, default_branch, badge_enabled FROM projects"
```

One row per account in `owners` and one per repo in `projects` means the install is complete. `badge_enabled` is `0` by default — opt in per repo below.

If `owners` is empty, the webhook was not received or failed before reaching the database — check the Worker logs with `npx wrangler tail`. If `owners` has rows but `projects` is empty, the App was likely installed with **All repositories** selected and the payload contained no repo list — trigger a manual resync (the installation id is the number at the end of the app's **Configure** URL):

```bash file="resync"
curl -X POST https://coverage-tracker.yourdomain.com/api/admin/resync \
  -H "Cf-Access-Jwt-Assertion: <your-access-token>" \
  -H "Content-Type: application/json" \
  -d '{"installationId": YOUR_INSTALLATION_ID}'
```

> [!NOTE]
> **If the webhook returns 500**
> Fix the issue shown by `npx wrangler tail`, clear the failed delivery from the dedup table, then redeliver from GitHub App → **Advanced → Recent Deliveries → Redeliver**:
>
> ```bash
> npx wrangler d1 execute DB --remote \
>   --command "DELETE FROM webhook_deliveries WHERE delivery_id = 'THE-DELIVERY-ID'"
> ```

With both tables populated, the Worker is ready to accept metrics — have CI produce a coverage report and let the reporting Action pick it up. See [Generating coverage reports](https://coveragetracker.dev/docs#generating-coverage-reports) for the per-language commands.

---

## Ingest from CI

Add a workflow step that runs after your test suite and posts coverage to `/api/ci/coverage` using a GitHub Actions OIDC token. There is **no static ingest secret**: the Worker verifies the token signature and checks the `repository` claim against your registered projects, so only your repos can push data. Re-running CI for the same commit is a safe no-op.

```bash file="upload step"
coverage-tracker upload ./lcov.info
```

The reporting Action accepts LCOV, Cobertura XML, JaCoCo XML, or Go's native coverage profile from any CI — Jest, Vitest, pytest-cov, go test, JaCoCo, SimpleCov. See [Generating coverage reports](https://coveragetracker.dev/docs#generating-coverage-reports) for the per-language commands. Trend history is append-only; PR jobs read baselines but never write.

---

## Status badges

Badge numbers are opt-in per repo. Find the project id, enable it, then paste the snippet into your README. Available metrics: `coverage`, `complexity`, `duplication`.

```bash file="enable badge"
# find the project id
npx wrangler d1 execute DB --remote \
  --command "SELECT id, full_slug FROM projects"

# enable the public badge endpoint
curl -X PATCH …/api/admin/projects/1/badge \
  -H "Cf-Access-Jwt-Assertion: <token>" \
  -d '{"enabled": true}'
```

Then drop the shields.io endpoint badge into your README:

```md file="README.md"
![coverage](https://img.shields.io/endpoint?url=https://coverage-tracker.yourdomain.com/api/badge/owner/repo/coverage.json)
```

---

## Dashboard

The SvelteKit dashboard is compiled by `wrangler deploy` automatically and served as static assets by the same Worker — there is no separate Pages project. After first deploy, visit `https://coverage-tracker.yourdomain.com`; Cloudflare Access prompts you to log in with the identity provider you configured. Once authenticated, the dashboard shows all registered repos and their per-metric, per-branch trend charts.

> [!NOTE]
> **Blank page or 404?**
> Check the SvelteKit build completed, that `assets.directory` points to `./dashboard/build`, and that `run_worker_first: ["/api/*"]` is set so non-API paths serve the SPA.
