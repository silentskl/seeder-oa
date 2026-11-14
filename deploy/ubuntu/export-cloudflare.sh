#!/usr/bin/env bash
# READ-ONLY Cloudflare snapshot: D1 full SQL and R2 objects, with manifest.
# Run from a machine authenticated to the account that owns production smarten-oa.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="${SEEDER_APP_DIR:-$ROOT/seeder-oa-app}"
STAGE="${1:-$ROOT/recovery-backups/ubuntu-snapshot-$(date -u +%Y%m%dT%H%M%SZ)}"
BUCKET="${R2_BUCKET:-seeder-oa-uploads}"
: "${CLOUDFLARE_ACCOUNT_ID:?Set Cloudflare account ID for read-only R2 S3 endpoint}"
: "${AWS_ACCESS_KEY_ID:?Set read-only R2 S3 access key}"
: "${AWS_SECRET_ACCESS_KEY:?Set read-only R2 S3 secret}"
for cmd in aws npx python3; do command -v "$cmd" >/dev/null || { echo "Missing $cmd" >&2; exit 1; }; done
[[ -f "$APP/wrangler.jsonc" ]] || { echo "Seeder app wrangler.jsonc not found at $APP" >&2; exit 1; }
[[ ! -e "$STAGE" ]] || { echo "Refusing to overwrite existing snapshot: $STAGE" >&2; exit 1; }
mkdir -p "$STAGE/uploads"
chmod 700 "$STAGE"
STAGE="$(cd "$STAGE" && pwd)"
ENDPOINT="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"
export AWS_DEFAULT_REGION=auto
echo "[1/3] Export full production D1 schema + rows (READ ONLY)..."
(
 cd "$APP"
 npx wrangler d1 export PM_DB --remote --skip-confirmation --output "$STAGE/database.sql"
)
[[ -s "$STAGE/database.sql" ]] || { echo "D1 export is empty" >&2; exit 1; }
echo "[2/3] Read complete R2 bucket manifest..."
aws --endpoint-url "$ENDPOINT" s3api list-objects-v2 --bucket "$BUCKET" --output json > "$STAGE/r2-objects.json"
python3 "$ROOT/deploy/ubuntu/migrate.py" validate-manifest --stage "$STAGE"
echo "[3/3] Download R2 objects (no deletes, no R2 writes)..."
aws --endpoint-url "$ENDPOINT" s3 sync "s3://$BUCKET/" "$STAGE/uploads/" --only-show-errors
python3 "$ROOT/deploy/ubuntu/migrate.py" validate-files --stage "$STAGE"
echo "Snapshot complete: $STAGE"
echo "Next: transfer this directory privately to Ubuntu and run migrate.py import."
echo "Preserve existing BETTER_AUTH_SECRET, VCS_ENCRYPTION_KEY and OA_SETTINGS_MASTER_KEY."
