#!/usr/bin/env bash
# Apply the OA overlay to the already downloaded Seeder app WITHOUT publishing Workers.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="${1:-$ROOT/seeder-oa-app}"
[[ -f "$APP/package.json" ]] || { echo "Seeder source missing: $APP" >&2; exit 1; }
[[ -f "$APP/Dockerfile" && -f "$APP/scripts/migrate-node.ts" ]] ||
 { echo "Seeder upstream v2.1.0 Node Docker support required" >&2; exit 1; }
OA_SKIP_DEPLOY=1 bash "$ROOT/apply-to-existing.sh" "$APP"
echo "OA overlay applied. Cloudflare production was NOT changed."
echo "Next: configure deploy/ubuntu/.env, restore the D1/R2 export, and run docker compose."
