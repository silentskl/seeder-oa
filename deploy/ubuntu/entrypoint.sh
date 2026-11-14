#!/bin/sh
# Fail closed. Never start a new empty SQLite OA in place of migrated production.
set -eu
DB_PATH="$SQLITE_DB_PATH"
UPLOAD_DIR="$UPLOADS_DIR"
if [ ! -s "$DB_PATH" ]; then
 echo "FATAL: missing/nonempty migrated SQLite database: $DB_PATH. Run offline restore first." >&2
 exit 1
fi
if [ ! -d "$UPLOAD_DIR" ]; then
 echo "FATAL: missing restored uploads directory: $UPLOAD_DIR" >&2
 exit 1
fi
for KEY in BETTER_AUTH_SECRET VCS_ENCRYPTION_KEY OA_SETTINGS_MASTER_KEY OA_FINANCE_SYNC_TOKEN BETTER_AUTH_URL; do
 VALUE="$(printenv "$KEY" || true)"
 if [ -z "$VALUE" ]; then
  echo "FATAL: $KEY missing. Carry forward the ORIGINAL Cloudflare secret value." >&2
  exit 1
 fi
 case "$VALUE" in
  REPLACE_*|change-me-in-production)
   echo "FATAL: $KEY is still a placeholder" >&2; exit 1 ;;
 esac
done
if [ "$(printf %s "$OA_FINANCE_SYNC_TOKEN" | wc -c)" -lt 32 ]; then
 echo "FATAL: OA_FINANCE_SYNC_TOKEN must be at least 32 characters" >&2
 exit 1
fi
exec "$@"
