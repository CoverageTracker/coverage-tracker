#!/usr/bin/env node
// Creates WAF skip rules for machine-to-machine endpoints that must not be
// gated by Bot Fight Mode or Browser Integrity Check.
//
//   /ingest          — protected by GitHub Actions OIDC token
//   /webhooks/github — protected by HMAC webhook signature
//
// Usage:
//   CLOUDFLARE_API_TOKEN=... ZONE_DOMAIN=yourdomain.com node scripts/setup-waf-rules.mjs
//
// Requires: Node.js 18+ (uses built-in fetch)

const { CLOUDFLARE_API_TOKEN, ZONE_DOMAIN } = process.env;
if (!CLOUDFLARE_API_TOKEN) throw new Error('CLOUDFLARE_API_TOKEN is required');
if (!ZONE_DOMAIN) throw new Error('ZONE_DOMAIN is required (e.g. yourdomain.com)');

const API = 'https://api.cloudflare.com/client/v4';
const PHASE = 'http_request_firewall_custom';
const DESCRIPTION = 'Skip bot/BIC checks for OIDC+HMAC-protected endpoints';
const EXPRESSION =
  '(http.request.uri.path eq "/ingest") or (http.request.uri.path eq "/webhooks/github")';

const headers = {
  Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
  'Content-Type': 'application/json',
};

async function cf(path, options = {}) {
  const res = await fetch(`${API}${path}`, { headers, ...options });
  const body = await res.json();
  if (!body.success) {
    throw new Error(`Cloudflare API error on ${path}: ${JSON.stringify(body.errors)}`);
  }
  return body.result;
}

// 1. Look up zone ID by domain name
console.log(`Looking up zone for ${ZONE_DOMAIN}...`);
const zones = await cf(`/zones?name=${ZONE_DOMAIN}`);
if (!zones.length) {
  throw new Error(`No zone found for ${ZONE_DOMAIN}. Check ZONE_DOMAIN and token permissions.`);
}
const zoneId = zones[0].id;
console.log(`Zone ID: ${zoneId}`);

// 2. Get (or create) the WAF custom rules phase entrypoint
let rulesetId;
try {
  const entrypoint = await cf(`/zones/${zoneId}/rulesets/phases/${PHASE}/entrypoint`);
  rulesetId = entrypoint.id;
} catch {
  console.log('No WAF custom ruleset found — creating empty entrypoint...');
  const created = await cf(`/zones/${zoneId}/rulesets/phases/${PHASE}/entrypoint`, {
    method: 'PUT',
    body: JSON.stringify({ rules: [] }),
  });
  rulesetId = created.id;
}
console.log(`Ruleset ID: ${rulesetId}`);

// 3. Check if the skip rule already exists (idempotent)
const ruleset = await cf(`/zones/${zoneId}/rulesets/${rulesetId}`);
const existing = ruleset.rules?.find((r) => r.description === DESCRIPTION);
if (existing) {
  console.log(`Skip rule already exists (${existing.id}) — nothing to do.`);
  process.exit(0);
}

// 4. Add the skip rule
console.log('Adding skip rule...');
const added = await cf(`/zones/${zoneId}/rulesets/${rulesetId}/rules`, {
  method: 'POST',
  body: JSON.stringify({
    action: 'skip',
    action_parameters: { products: ['botFightMode', 'browserIntegrityCheck'] },
    expression: EXPRESSION,
    description: DESCRIPTION,
    enabled: true,
  }),
});
console.log(`Done — rule ID: ${added.id}`);
