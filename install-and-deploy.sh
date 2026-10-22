#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
read_required() { local name="$1" prompt="$2"; if [[ -z "${!name:-}" ]]; then read -r -p "$prompt: " "$name"; export "$name"; fi; [[ -n "${!name:-}" ]] || { echo "ERROR: $name is required" >&2; exit 1; }; }
read_required OWNER_EMAIL "Owner email"
read_required APP_URL "Public OA URL (for example https://oa.example.com)"
WORKER_NAME="${WORKER_NAME:-seeder-oa}"
D1_NAME="${D1_NAME:-seeder-oa}"
R2_NAME="${R2_NAME:-seeder-oa-uploads}"
TARGET_DIR="${TARGET_DIR:-$PWD/seeder-oa-app}"
SEEDER_REF="${SEEDER_REF:-v2.1.0}"
for cmd in git node npm python3; do command -v "$cmd" >/dev/null || { echo "ERROR: $cmd is required" >&2; exit 1; }; done
node -e 'const n=+process.versions.node.split(".")[0];if(n<22){console.error("Node.js 22+ is required");process.exit(1)}'
if [[ ! -d "$TARGET_DIR/.git" ]]; then
  git clone --depth 1 --branch "$SEEDER_REF" https://github.com/danielsyauqi/Seeder.git "$TARGET_DIR"
fi
"$ROOT/apply-to-existing.sh" "$TARGET_DIR"
cd "$TARGET_DIR"
npm ci
npx wrangler whoami >/dev/null
# Create or locate D1.
set +e
CREATE_OUT="$(npx wrangler d1 create "$D1_NAME" 2>&1)"
CREATE_RC=$?
set -e
DBID="$(printf '%s\n' "$CREATE_OUT" | grep -Eo '[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}' | head -1 || true)"
if [[ -z "$DBID" ]]; then
  DBID="$(npx wrangler d1 list --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s);const x=a.find(v=>v.name===process.argv[1]);if(x)process.stdout.write(x.uuid||x.id||'')})" "$D1_NAME")"
fi
[[ -n "$DBID" ]] || { echo "$CREATE_OUT"; echo "ERROR: could not determine D1 database id" >&2; exit 2; }
# R2 create is idempotent enough for this installer; existing-bucket error is acceptable.
npx wrangler r2 bucket create "$R2_NAME" >/dev/null 2>&1 || true
python3 - "$WORKER_NAME" "$D1_NAME" "$DBID" "$R2_NAME" <<'PY'
from pathlib import Path
import re,sys
worker,d1,dbid,r2=sys.argv[1:]
p=Path('wrangler.jsonc'); s=p.read_text()
s=re.sub(r'"name"\s*:\s*"[^"]+"', f'"name": "{worker}"', s, count=1)
s=re.sub(r'"database_name"\s*:\s*"[^"]+"', f'"database_name": "{d1}"', s, count=1)
s=re.sub(r'"database_id"\s*:\s*"[^"]+"', f'"database_id": "{dbid}"', s, count=1)
s=re.sub(r'"preview_database_id"\s*:\s*"[^"]+"', f'"preview_database_id": "{dbid}"', s, count=1)
s=re.sub(r'"bucket_name"\s*:\s*"[^"]+"', f'"bucket_name": "{r2}"', s, count=1)
s=re.sub(r'"preview_bucket_name"\s*:\s*"[^"]+"', f'"preview_bucket_name": "{r2}"', s, count=1)
p.write_text(s)
PY
# Preserve generated secrets across reruns on the same working directory.
SECRETS_FILE=.oa-deploy-secrets
if [[ -f "$SECRETS_FILE" ]]; then source "$SECRETS_FILE"; fi
BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")}" 
VCS_ENCRYPTION_KEY="${VCS_ENCRYPTION_KEY:-$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")}" 
OA_SETTINGS_MASTER_KEY="${OA_SETTINGS_MASTER_KEY:-$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")}" 
printf 'BETTER_AUTH_SECRET=%q\nVCS_ENCRYPTION_KEY=%q\nOA_SETTINGS_MASTER_KEY=%q\n' "$BETTER_AUTH_SECRET" "$VCS_ENCRYPTION_KEY" "$OA_SETTINGS_MASTER_KEY" > "$SECRETS_FILE"
chmod 600 "$SECRETS_FILE"
printf '%s' "$BETTER_AUTH_SECRET" | npx wrangler secret put BETTER_AUTH_SECRET >/dev/null
printf '%s' "$VCS_ENCRYPTION_KEY" | npx wrangler secret put VCS_ENCRYPTION_KEY >/dev/null
printf '%s' "$OA_SETTINGS_MASTER_KEY" | npx wrangler secret put OA_SETTINGS_MASTER_KEY >/dev/null
printf '%s' "$APP_URL" | npx wrangler secret put BETTER_AUTH_URL >/dev/null
printf '%s' "$OWNER_EMAIL" | npx wrangler secret put OWNER_EMAIL >/dev/null
npm run db:migrate:remote
npm run deploy
cat <<EOF

============================================================
Seeder OA v0.1.14 deployment finished
App URL: $APP_URL
First owner: $OWNER_EMAIL
Sign in: $APP_URL/sign-in
Office:  $APP_URL/oa
============================================================

If APP_URL is a custom domain, bind it to Worker '$WORKER_NAME'
in Cloudflare Workers & Pages → Settings → Domains & Routes.
EOF
