#!/usr/bin/env bash
# Create Cloudflare rate-limiting rules for the store API (run once, after the
# theodore.net zone is on Cloudflare). Wrangler's OAuth token can't edit WAF rules,
# so this uses a zone-scoped API token you create:
#
#   Cloudflare dashboard -> My Profile -> API Tokens -> Create Token -> Custom token
#   Permissions: Zone > Zone WAF > Edit   (and Zone > Zone > Read)
#   Zone Resources: Include > Specific zone > theodore.net
#
# Then run from the repo root:
#   CF_API_TOKEN=xxxxx CF_ZONE_ID=yyyyy tools/setup-rate-limits.sh
#
# Find CF_ZONE_ID on the theodore.net zone Overview page (right rail, "Zone ID").
# Re-running replaces the rate-limit ruleset with exactly these rules (idempotent).
set -euo pipefail
: "${CF_API_TOKEN:?set CF_API_TOKEN (Zone WAF: Edit)}"
: "${CF_ZONE_ID:?set CF_ZONE_ID (theodore.net zone id)}"

BODY='{
  "rules": [
    {
      "description": "rl payment-intent: 20/min per IP",
      "expression": "(http.request.uri.path eq \"/api/payment-intent\")",
      "action": "block",
      "ratelimit": { "characteristics": ["ip.src"], "period": 60, "requests_per_period": 20, "mitigation_timeout": 60 }
    },
    {
      "description": "rl order lookup (anti-enumeration): 8 / 10min per IP",
      "expression": "(http.request.uri.path eq \"/api/order-lookup\" or http.request.uri.path eq \"/api/order\")",
      "action": "block",
      "ratelimit": { "characteristics": ["ip.src"], "period": 600, "requests_per_period": 8, "mitigation_timeout": 600 }
    },
    {
      "description": "rl subscribe: 5/min per IP",
      "expression": "(http.request.uri.path eq \"/api/subscribe\")",
      "action": "block",
      "ratelimit": { "characteristics": ["ip.src"], "period": 60, "requests_per_period": 5, "mitigation_timeout": 300 }
    },
    {
      "description": "rl all /api fallback: 60/min per IP (managed challenge)",
      "expression": "(starts_with(http.request.uri.path, \"/api/\"))",
      "action": "managed_challenge",
      "ratelimit": { "characteristics": ["ip.src"], "period": 60, "requests_per_period": 60, "mitigation_timeout": 60 }
    }
  ]
}'

curl -sS -X PUT \
  "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/rulesets/phases/http_ratelimit/entrypoint" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" -H "content-type: application/json" \
  --data "$BODY" \
| python3 -c "import sys,json; d=json.load(sys.stdin); ok=d.get('success'); print('rate-limit rules:', 'OK' if ok else 'ERROR'); [print('  error:', e.get('message')) for e in (d.get('errors') or [])]; print('  active rules:', len((d.get('result') or {}).get('rules') or []))"
