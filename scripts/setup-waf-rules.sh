#!/usr/bin/env bash
# Creates WAF skip rules for machine-to-machine endpoints that must not be
# gated by Bot Fight Mode or Browser Integrity Check.
#
#   /ingest          — protected by GitHub Actions OIDC token
#   /webhooks/github — protected by HMAC webhook signature
#
# Usage:
#   CLOUDFLARE_API_TOKEN=... ZONE_DOMAIN=yourdomain.com bash scripts/setup-waf-rules.sh
#
# Requires: curl, jq

set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${ZONE_DOMAIN:?ZONE_DOMAIN is required (e.g. yourdomain.com)}"

API="https://api.cloudflare.com/client/v4"
AUTH=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json")
PHASE="http_request_firewall_custom"
DESCRIPTION="Skip bot/BIC checks for OIDC+HMAC-protected endpoints"
EXPRESSION='(http.request.uri.path eq "/ingest") or (http.request.uri.path eq "/webhooks/github")'

# 1. Look up zone ID by domain name
echo "Looking up zone for ${ZONE_DOMAIN}..."
ZONE_ID=$(curl -sf "${AUTH[@]}" "${API}/zones?name=${ZONE_DOMAIN}" \
  | jq -r '.result[0].id // empty')
if [[ -z "${ZONE_ID}" ]]; then
  echo "Error: no zone found for ${ZONE_DOMAIN}. Check ZONE_DOMAIN and token permissions."
  exit 1
fi
echo "Zone ID: ${ZONE_ID}"

# 2. Get (or create) the WAF custom rules phase entrypoint
ENTRYPOINT=$(curl -sf "${AUTH[@]}" "${API}/zones/${ZONE_ID}/rulesets/phases/${PHASE}/entrypoint" || echo '{"result":{}}')
RULESET_ID=$(echo "${ENTRYPOINT}" | jq -r '.result.id // empty')

if [[ -z "${RULESET_ID}" ]]; then
  echo "No WAF custom ruleset found — creating empty entrypoint..."
  RULESET_ID=$(curl -sf -X PUT "${AUTH[@]}" \
    "${API}/zones/${ZONE_ID}/rulesets/phases/${PHASE}/entrypoint" \
    -d '{"rules":[]}' | jq -r '.result.id')
fi
echo "Ruleset ID: ${RULESET_ID}"

# 3. Check if the skip rule already exists (idempotent)
EXISTING=$(curl -sf "${AUTH[@]}" "${API}/zones/${ZONE_ID}/rulesets/${RULESET_ID}" \
  | jq -r --arg desc "${DESCRIPTION}" '.result.rules[]? | select(.description == $desc) | .id')
if [[ -n "${EXISTING}" ]]; then
  echo "Skip rule already exists (${EXISTING}) — nothing to do."
  exit 0
fi

# 4. Add the skip rule
echo "Adding skip rule..."
RESULT=$(curl -sf -X POST "${AUTH[@]}" \
  "${API}/zones/${ZONE_ID}/rulesets/${RULESET_ID}/rules" \
  -d "{
    \"action\": \"skip\",
    \"action_parameters\": {
      \"products\": [\"botFightMode\", \"browserIntegrityCheck\"]
    },
    \"expression\": \"${EXPRESSION}\",
    \"description\": \"${DESCRIPTION}\",
    \"enabled\": true
  }")

RULE_ID=$(echo "${RESULT}" | jq -r '.result.id')
echo "Done — rule ID: ${RULE_ID}"
