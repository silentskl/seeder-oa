#!/usr/bin/env bash
# Consistent local SQLite/files backup. Briefly stops app and scheduler.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA="$ROOT/data"
OUT="${1:-$ROOT/backups}"
[[ -f "$DATA/seeder.db" && -d "$DATA/uploads" ]] || { echo "No migrated SQLite/uploads found" >&2; exit 1; }
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
NAME="seeder-oa-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
# Remember exactly which services were running; never turn on a previously
# disabled finance cron merely because a backup was performed.
RUNNING="$(docker compose -f "$ROOT/docker-compose.yml" ps --services --status running)"
restore_service(){
  for service in $RUNNING; do
    case "$service" in
      seeder-oa|finance-mail-scheduler)
        docker compose -f "$ROOT/docker-compose.yml" start "$service" >/dev/null || true ;;
    esac
  done
}
echo "Stopping app and scheduler briefly for a consistent local backup..."
docker compose -f "$ROOT/docker-compose.yml" stop finance-mail-scheduler seeder-oa
trap restore_service EXIT
tar -C "$DATA" -czf "$OUT/$NAME" seeder.db uploads migration-report.json
chmod 600 "$OUT/$NAME"
echo "Saved: $OUT/$NAME"
