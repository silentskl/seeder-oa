#!/usr/bin/env bash
set -euo pipefail
TARGET="${1:-.}"
TARGET="$(cd "$TARGET" && pwd)"
[[ -f "$TARGET/wrangler.jsonc" ]] || { echo "ERROR: wrangler.jsonc not found in $TARGET" >&2; exit 1; }
cd "$TARGET"
SECRETS_FILE=.oa-deploy-secrets
if [[ -f "$SECRETS_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$SECRETS_FILE"
fi
if [[ -z "${OA_SETTINGS_MASTER_KEY:-}" ]]; then
  OA_SETTINGS_MASTER_KEY="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))")"
  {
    [[ -f "$SECRETS_FILE" ]] && cat "$SECRETS_FILE" || true
    printf 'OA_SETTINGS_MASTER_KEY=%q\n' "$OA_SETTINGS_MASTER_KEY"
  } > "$SECRETS_FILE.tmp"
  mv "$SECRETS_FILE.tmp" "$SECRETS_FILE"
  chmod 600 "$SECRETS_FILE"
fi
printf '%s' "$OA_SETTINGS_MASTER_KEY" | npx wrangler secret put OA_SETTINGS_MASTER_KEY >/dev/null
echo "OA_SETTINGS_MASTER_KEY is configured for the Worker."
echo "Keep $TARGET/$SECRETS_FILE private; it contains deployment secrets."
