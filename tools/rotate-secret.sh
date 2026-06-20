#!/usr/bin/env bash
# Rotate a store secret: paste the new value once, it is written to the Cloudflare
# Pages secret(s) and to local .dev.vars. Run from the repo root.
#
#   tools/rotate-secret.sh RESEND_API_KEY       # theodore-net + theodore-ops + .dev.vars
#   tools/rotate-secret.sh BUTTONDOWN_API_KEY   # theodore-net + .dev.vars
#   tools/rotate-secret.sh STRIPE_SECRET_KEY    # theodore-net + theodore-ops + .dev.vars
#
# After rotating, redeploy so the running deployment picks it up:
#   npx wrangler pages deploy site --project-name=theodore-net --branch=site-updates
set -euo pipefail

NAME="${1:-}"
[ -n "$NAME" ] || { echo "usage: tools/rotate-secret.sh <SECRET_NAME>"; exit 1; }

# Which projects use this secret.
case "$NAME" in
  BUTTONDOWN_API_KEY)            PROJECTS=(theodore-net) ;;
  RESEND_API_KEY|STRIPE_SECRET_KEY|STRIPE_PUBLISHABLE_KEY|STRIPE_WEBHOOK_SECRET|STORE_FROM_EMAIL|OPERATOR_EMAIL)
                                 PROJECTS=(theodore-net theodore-ops) ;;
  *)                             PROJECTS=(theodore-net) ;;
esac

printf 'Paste new value for %s (input hidden): ' "$NAME"
read -rs VALUE; echo
[ -n "$VALUE" ] || { echo "empty value, aborting"; exit 1; }

for p in "${PROJECTS[@]}"; do
  printf '%s' "$VALUE" | npx --yes wrangler pages secret put "$NAME" --project-name="$p" >/dev/null \
    && echo "  set on Cloudflare project: $p" \
    || { echo "  FAILED on $p"; exit 1; }
done

# Mirror into local .dev.vars (gitignored) so local dev keeps working.
if [ -f .dev.vars ]; then
  NAME="$NAME" VALUE="$VALUE" python3 - <<'PY'
import os, pathlib
k, v, p = os.environ["NAME"], os.environ["VALUE"], pathlib.Path(".dev.vars")
lines = p.read_text().splitlines()
out, found = [], False
for l in lines:
    if l.startswith(k + "="): out.append(k + "=" + v); found = True
    else: out.append(l)
if not found: out.append(k + "=" + v)
p.write_text("\n".join(out) + "\n")
print("  updated local .dev.vars")
PY
fi

echo "done. Redeploy to apply on the live deployment:"
echo "  npx wrangler pages deploy site --project-name=theodore-net --branch=site-updates"
