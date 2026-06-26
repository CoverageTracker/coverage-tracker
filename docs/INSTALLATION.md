# Installation Guide

This guide walks through deploying coverage-tracker to your own Cloudflare account.
Follow the steps in order — several decisions depend on values produced by earlier steps.

---

## Prerequisites

- A **Cloudflare account** (free tier is sufficient)
- A **domain managed by Cloudflare** (DNS must be proxied through Cloudflare — see [Domain setup](#1-domain-setup) below)
- A **GitHub account** (personal or org) with admin access to the repos you want to track
- **Node.js** 18+ and **npm** installed locally
- **Wrangler** authenticated: `npx wrangler login`

---

## 1. Domain setup

The Worker must be served from a domain whose DNS is managed by Cloudflare. This is required for both custom domain routing and Cloudflare Access.

If your domain's DNS is hosted elsewhere (e.g. Porkbun, Namecheap, Route 53):

1. Go to **Cloudflare dashboard → Websites → Add a domain**
2. Enter your domain → select **Free** plan
3. Cloudflare scans and imports your existing DNS records — review them
4. In your registrar's control panel, replace the nameservers with the two Cloudflare nameservers shown
5. Wait for propagation (usually minutes; Cloudflare emails you when active)

You do **not** need to manually create a DNS record for the Worker subdomain — the deploy step handles that automatically.

---

## 2. Clone and install

```bash
git clone https://github.com/your-org/coverage-tracker
cd coverage-tracker
npm install
```

---

## 3. Create the D1 database

First, copy the example config to create your local `wrangler.jsonc` (it is gitignored and holds your personal values):

```bash
cp wrangler.example.jsonc wrangler.jsonc
```

Then create the database:

```bash
npx wrangler d1 create coverage
```

Copy the `database_id` from the output and paste it into `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "coverage",
    "database_id": "YOUR_DATABASE_ID_HERE",   // ← paste here
    "migrations_dir": "migrations"
  }
]
```

Also update the `assets.directory` if you need to change where the SvelteKit build lands (the default `./dashboard/build` is correct for this repo), and verify the `run_worker_first` setting remains `["/api/*"]` so all non-API requests fall through to the SPA assets.

> **Note:** There is no `WORKER_URL` var or `routes` entry in the new config. The custom domain is attached to the Worker directly in the Cloudflare dashboard after first deploy (see Step 11), and the Worker URL is not referenced in Worker code.

---

## 4. Apply the database migration

Apply to your remote D1 database:

```bash
npm run db:migrate:remote
```

---

## 5. Create the GitHub App

> **Important:** There are two separate GitHub integrations in this project:
> - A **GitHub App** (this step) — for webhook events and API access
> - A **GitHub OAuth App** (Step 8) — for Cloudflare Access dashboard login
>
> Do not conflate them. Create them separately.

Go to the account or org where you want to host the app:
- **Personal:** GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**
- **Org:** GitHub → Your org → Settings → Developer settings → GitHub Apps → **New GitHub App**

### Required fields

| Field | Value |
|-------|-------|
| GitHub App name | Something globally unique, e.g. `your-coverage-tracker` |
| Homepage URL | `https://coverage-tracker.yourdomain.com` |
| Webhook → Active | ✓ checked |
| Webhook URL | `https://coverage-tracker.yourdomain.com/webhooks/github` |
| Webhook secret | Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — save this value |

### Leave these blank / unchecked

- **Callback URL** — not used (no OAuth user flow)
- **Request user authorization (OAuth) during installation** — leave unchecked
- **Setup URL** — leave blank

### Permissions (Repository)

| Permission | Level |
|-----------|-------|
| Metadata | Read-only *(auto-selected)* |
| Checks | Read & write |

No other permissions are needed.

### Subscribe to events

Check both:
- **Installation target**
- **Installation repositories**

### Where can this app be installed?

Select **Only on this account** for a private self-hosted instance.

### After creating

On the app's settings page, note:
- **App ID** → you'll set this as `GITHUB_APP_ID`
- **Client ID** → you'll set this as `GITHUB_APP_CLIENT_ID`

Generate a private key: scroll to **Private keys → Generate a private key**.
GitHub downloads a `.pem` file in PKCS#1 format. The Worker requires PKCS#8.

**Convert the private key** (Node.js, no OpenSSL required):

```bash
node -e "
const c = require('crypto'), fs = require('fs');
const key = c.createPrivateKey(fs.readFileSync(process.argv[1], 'utf8'));
process.stdout.write(key.export({ type: 'pkcs8', format: 'pem' }));
" your-app.private-key.pem > private-key-pkcs8.pem
```

Or as a one-liner piped directly into wrangler (no file written to disk):

```bash
node -e "
const c = require('crypto'), fs = require('fs');
const key = c.createPrivateKey(fs.readFileSync(process.argv[1], 'utf8'));
process.stdout.write(key.export({ type: 'pkcs8', format: 'pem' }));
" your-app.private-key.pem | npx wrangler secret put GITHUB_APP_PRIVATE_KEY
```

---

## 6. Set Wrangler secrets

Set the GitHub App credentials:

```bash
npx wrangler secret put GITHUB_APP_ID          # numeric App ID, e.g. 1234567
npx wrangler secret put GITHUB_APP_CLIENT_ID   # starts with "Iv23..."
npx wrangler secret put GITHUB_APP_PRIVATE_KEY # if not piped above
npx wrangler secret put GITHUB_WEBHOOK_SECRET  # the value you generated in step 5
```

The two Cloudflare Access secrets (collect these in Steps 7–8 below, then come back):

```bash
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN  # e.g. myteam.cloudflareaccess.com
npx wrangler secret put CF_ACCESS_AUD          # AUD tag UUID from the Access app
```

---

## 7. Set up Cloudflare Zero Trust

Go to **Cloudflare dashboard → Zero Trust**.

On first visit, choose a **team name** (e.g. `myteam`). This becomes `myteam.cloudflareaccess.com` — your `CF_ACCESS_TEAM_DOMAIN`.

---

## 8. Create a GitHub OAuth App (for dashboard login)

This is separate from the GitHub App created in Step 5. Cloudflare Access uses it to authenticate you when you visit the dashboard.

GitHub → Settings → Developer settings → **OAuth Apps → New OAuth App**

| Field | Value |
|-------|-------|
| Application name | `coverage-tracker-access` (any name) |
| Homepage URL | `https://coverage-tracker.yourdomain.com` |
| Authorization callback URL | `https://myteam.cloudflareaccess.com/cdn-cgi/access/callback` |

Save the **Client ID** and generate a **Client Secret** — you'll need both in the next step.

---

## 9. Add GitHub as an identity provider in Zero Trust

Zero Trust → **Settings → Authentication → Add new** → select **GitHub**

Enter the OAuth App's Client ID and Client Secret from Step 8.

---

## 10. Create the Cloudflare Access application

Zero Trust → **Access → Applications → Add an application → Self-hosted**

| Field | Value |
|-------|-------|
| App name | `coverage-tracker` |
| Session duration | Your preference (e.g. 24 hours) |
| Identity providers | GitHub (the one added in Step 9) |

**Application domain — protect the dashboard only:**

| Domain | Path |
|--------|------|
| `coverage-tracker.yourdomain.com` | *(leave blank — protects the whole domain)* |

> **Critical:** Do **not** add `/api` or `/admin` as protected paths. All `/api/*` routes
> enforce their own auth in code: OIDC for CI ingest, HMAC for webhooks, and Access JWT
> middleware for `/api/projects/*` and `/api/admin/*`. Adding a Cloudflare Access edge policy
> on `/api/*` would block the GitHub Actions runner (OIDC ingest) and GitHub webhook
> deliveries — both are non-browser clients that cannot complete the Access flow.
>
> The dashboard SPA (served from the root and any non-`/api` path) is what Access should
> protect. Because `/api/*` bypasses edge Access by design, the Worker verifies the Access
> JWT in middleware for all routes that require login (`requireAccess()`).

Add a policy:
- **Policy name:** Allow deployer
- **Action:** Allow
- **Rule:** Emails → `your-email@example.com`

After saving, open the application settings and copy the **Application Audience (AUD) Tag** — this is your `CF_ACCESS_AUD`.

Now go back and set the two Access secrets if you haven't already:

```bash
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN
npx wrangler secret put CF_ACCESS_AUD
```

---

## 11. Deploy the Worker

```bash
npx wrangler deploy
```

Expected output:

```
Deployed coverage-tracker triggers
  coverage-tracker.yourdomain.com (custom domain)
```

> **Note:** The first deploy also runs `npm --prefix dashboard run build` to compile the
> SvelteKit dashboard before uploading. Make sure dashboard dependencies are installed
> (`npm --prefix dashboard install`) before running this step.

### Add WAF skip rules

If you enable **Bot Fight Mode** or **Browser Integrity Check** on your Cloudflare zone, those security features will block the GitHub Actions runner (a non-browser client) from reaching `/api/ci/coverage` and `/api/webhooks/github`. Both endpoints have their own auth (OIDC and HMAC respectively), so they don't need zone-level bot protection.

Run the provided setup script to add a WAF skip rule for those paths:

```bash
CLOUDFLARE_API_TOKEN=<your-token> ZONE_DOMAIN=yourdomain.com \
  node scripts/setup-waf-rules.mjs
```

The script is idempotent — safe to re-run. It requires a token with **Zone → WAF → Edit** permission.

---

## 12. Install the GitHub App on your repos

Go to your GitHub App's settings page → **Install App** → select the account or org → choose the repos you want to track (or all repos).

This fires an `installation: created` webhook to your Worker, which populates the `owners` and `projects` tables.

> **If the webhook returns 500:** Check the Worker logs with `npx wrangler tail`, fix the
> issue, clear the failed delivery from the dedup table, then redeliver:
>
> ```bash
> npx wrangler d1 execute DB --remote \
>   --command "DELETE FROM webhook_deliveries WHERE delivery_id = 'THE-DELIVERY-ID'"
> ```
>
> Then go to GitHub App → Advanced → Recent Deliveries → Redeliver.

---

## 13. Verify

Run these two queries to confirm the webhook was received and processed correctly.

**Owners table** — should show the GitHub account or org the App was installed on:

```bash
npx wrangler d1 execute DB --remote --command "SELECT * FROM owners"
```

Expected output (one row per account):

```
┌────┬───────────┬───────────┬──────────────┬────────────┬─────────────────────┐
│ id │ github_id │ login     │ type         │ avatar_url │ created_at          │
├────┼───────────┼───────────┼──────────────┼────────────┼─────────────────────┤
│ 1  │ 128944512 │ YourOrg   │ Organization │ https://…  │ 2026-06-24 04:09:40 │
└────┴───────────┴───────────┴──────────────┴────────────┴─────────────────────┘
```

If this table is empty, the webhook was not received or failed before reaching the database. Check the Worker logs with `npx wrangler tail`, then see the troubleshooting note in Step 12.

---

**Projects table** — should show one row per registered repo:

```bash
npx wrangler d1 execute DB --remote \
  --command "SELECT full_slug, default_branch, badge_enabled FROM projects"
```

Expected output:

```
┌────────────────────────────────────┬────────────────┬───────────────┐
│ full_slug                          │ default_branch │ badge_enabled │
├────────────────────────────────────┼────────────────┼───────────────┤
│ YourOrg/repo-one                   │ main           │ 0             │
├────────────────────────────────────┼────────────────┼───────────────┤
│ YourOrg/repo-two                   │ main           │ 0             │
└────────────────────────────────────┴────────────────┴───────────────┘
```

`badge_enabled` is `0` (off) by default for all repos — this is intentional. See **Next steps** for how to opt a repo into the public badge endpoint.

If the owners table has a row but projects is empty, the GitHub App was likely installed with **All repositories** selected but the webhook payload contained no repo list. Trigger a manual resync:

```bash
# Find your installation ID in the owners table output or in:
# GitHub → Your org → Settings → Third-party Access → GitHub Apps → Configure
# The installation ID is the number at the end of the URL.

curl -X POST https://coverage-tracker.yourdomain.com/api/admin/resync \
  -H "Cf-Access-Jwt-Assertion: <your-access-token>" \
  -H "Content-Type: application/json" \
  -d '{"installationId": YOUR_INSTALLATION_ID}'
```

If both tables have rows, the installation is complete and the Worker is ready to accept metric ingestion from CI.

---

## 14. Dashboard

The SvelteKit dashboard in `dashboard/` is compiled by `wrangler deploy` automatically (via the `build.command` in `wrangler.jsonc`) and served as static assets by the same Worker. There is no separate Cloudflare Pages project.

**After first deploy**, navigate to `https://coverage-tracker.yourdomain.com` — Cloudflare Access will prompt you to log in with the identity provider you configured in Step 9. Once authenticated, the dashboard loads and shows all registered repos.

If the dashboard returns a blank page or 404, check:
- The SvelteKit build completed without errors (`npm --prefix dashboard run build` locally)
- The `assets.directory` in `wrangler.jsonc` points to `./dashboard/build`
- The `run_worker_first: ["/api/*"]` setting is present (so non-API paths serve the SPA)

The dashboard is served from the same domain and behind the same Cloudflare Access application you created in Step 10. No separate Pages project or additional Access app is needed.

---

## Next steps

- **Ingest metrics from CI:** Add a workflow to your repos that posts coverage data to `/api/ci/coverage` using a GitHub Actions OIDC token. See the reporting Action docs (`.github/actions/report/`).
- **Enable badges:** Opt individual repos into the public badge endpoint:
  ```bash
  # Find the project ID first
  npx wrangler d1 execute DB --remote --command "SELECT id, full_slug FROM projects"

  # Enable badge for a specific project
  curl -X PATCH https://coverage-tracker.yourdomain.com/api/admin/projects/1/badge \
    -H "Cf-Access-Jwt-Assertion: <your-access-token>" \
    -H "Content-Type: application/json" \
    -d '{"enabled": true}'
  ```
  Then add the badge to your repo's README:
  ```markdown
  ![Coverage](https://img.shields.io/endpoint?url=https://coverage-tracker.yourdomain.com/api/badge/YourOrg/repo-name/coverage.json)
  ```
- **Resync if repos drift:** If you add/remove repos from the GitHub App installation and the webhook is missed, trigger a manual resync via `POST /api/admin/resync` with `{"installationId": YOUR_INSTALLATION_ID}`.
