#!/usr/bin/env bash
# Apply the exact OA overlay without touching the existing Cloudflare Worker.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$ROOT/seeder-oa-app"
[[ -f "$APP/package.json" ]] || {
 echo "Missing Seeder upstream submodule. Run git submodule update --init --recursive." >&2
 exit 1
}
if ! grep -q '"build:node"' "$APP/package.json"; then
 echo "Seeder upstream revision does not have supported Node build scripts; use v2.1.0 or a verified newer revision" >&2
 exit 1
fi
OA_SKIP_DEPLOY=1 bash "$ROOT/apply-to-existing.sh" "$APP"
echo "Ubuntu application overlay ready: $APP"
echo "Next: configure deploy/ubuntu/.env, restore D1/R2, and docker compose build."
