#!/usr/bin/env bash
# Set LIVE Stripe secrets on the Cloudflare Pages projects (production only).
# Does NOT touch .dev.vars, so local dev stays in TEST mode. Keys are read hidden
# and never echoed. Run from the repo root:  bash tools/set-live-stripe.sh
#
# You need three values from the Stripe dashboard (toggle "Test mode" OFF):
#   STRIPE_SECRET_KEY      -> Developers > API keys > Secret key (sk_live_… or a live rk_live_…)
#   STRIPE_PUBLISHABLE_KEY -> Developers > API keys > Publishable key (pk_live_…)
#   STRIPE_WEBHOOK_SECRET  -> Developers > Webhooks > your theodore.net endpoint > Signing secret (whsec_…)
#
# STRIPE_MODE is a BUILD-time switch (bakes live price IDs into the catalog); it is
# NOT set here. Claude runs the live build + deploy after you finish this.
set -euo pipefail

prompt_set() {
  local name="$1"; shift
  local projects=("$@")
  printf 'Paste LIVE %s (hidden, Enter to skip): ' "$name"
  read -rs val; echo
  if [ -z "$val" ]; then echo "  skipped $name"; return 0; fi
  for p in "${projects[@]}"; do
    printf '%s' "$val" | npx --yes wrangler pages secret put "$name" --project-name="$p" >/dev/null \
      && echo "  set $name on $p" || { echo "  FAILED $name on $p"; }
  done
  unset val
}

echo "Setting LIVE Stripe secrets on Cloudflare production (test mode and .dev.vars untouched)…"
prompt_set STRIPE_SECRET_KEY      theodore-net theodore-ops
prompt_set STRIPE_PUBLISHABLE_KEY theodore-net
prompt_set STRIPE_WEBHOOK_SECRET  theodore-net
echo
echo "Done. Tell Claude the live keys are set and it will rebuild in live mode,"
echo "redeploy to theodore-net.pages.dev, and run the full live smoke test."
