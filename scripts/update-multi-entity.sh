#!/usr/bin/env bash
# Safely synchronize and verify the Seeder OA Multi-Entity overlay.
# Default CHECK mode does not touch Cloudflare production D1 or Workers.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="check"
APP="$ROOT/seeder-oa-app"
usage() {
  cat <<'EOF'
Usage: bash scripts/update-multi-entity.sh [--check|--deploy] [APP_DIR]
  --check   (default) sync overlay, run static isolation guards,
            migration fixture tests and Next.js production build; no remote changes
  --deploy  perform all check steps, then guarded production D1 backup,
            reviewed migrations, schema verification and Worker publication
APP_DIR defaults to ./seeder-oa-app relative to this OA overlay repository.
Do not enable OA_MULTI_ENTITY_BUSINESS_ENABLED before staging isolation acceptance.
EOF
}
if [[ "${1:-}" == "--check" || "${1:-}" == "--deploy" ]]; then
  MODE="${1#--}"
  shift
fi
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then usage;exit 0;fi
if [[ $# -gt 1 ]]; then usage >&2;exit 2;fi
if [[ $# -eq 1 ]]; then APP="$1";fi
[[ -d "$APP" ]] || { echo "ERROR: Seeder app directory not found: $APP" >&2;exit 2; }
APP="$(cd "$APP" && pwd)"
[[ -f "$APP/package.json" ]] || { echo "ERROR: missing Seeder package.json: $APP" >&2;exit 2; }
for tool in node npm python3;do command -v "$tool" >/dev/null || { echo "ERROR: $tool required" >&2;exit 2; };done
echo "[MULTI-ENTITY] Mode: $MODE"
echo "[MULTI-ENTITY] Source: $ROOT"
echo "[MULTI-ENTITY] App: $APP"
# The apply script historically deploys by default. Explicitly inhibit it here
# so safety checks must finish before the only remote publication step.
OA_SKIP_DEPLOY=1 bash "$ROOT/apply-to-existing.sh" "$APP"
echo "[MULTI-ENTITY] Checking Phase 2B source permissions..."
node "$ROOT/scripts/check-phase2b-isolation.mjs" "$APP"
echo "[MULTI-ENTITY] Checking Phase 3/4 UI, API and document downloads..."
node "$ROOT/scripts/check-phase34-release.mjs" "$APP"
echo "[MULTI-ENTITY] Running local SQLite migration fixtures..."
node "$ROOT/tests/multi-entity-migrations.test.mjs"
echo "[OA] Checking TypeScript/TSX parser diagnostics before Next.js build..."
node "$ROOT/scripts/check-oa-syntax.mjs" "$APP"
echo "[OA] Running complete TypeScript type check (before Webpack build)..."
(cd "$APP" && ./node_modules/.bin/tsc --noEmit)
echo "[MULTI-ENTITY] Building production bundle..."
(cd "$APP" && npm run build)
if [[ "$MODE" == "check" ]]; then
  echo "[MULTI-ENTITY] Local checks complete. No production migration or Worker deploy performed."
  echo "[MULTI-ENTITY] To publish with feature still disabled: bash scripts/update-multi-entity.sh --deploy '$APP'"
  exit 0
fi
if [[ "${OA_MULTI_ENTITY_BUSINESS_ENABLED:-}" == "true" ]]; then
  echo "ERROR: refusing production deployment with multi-Entity access enabled before acceptance." >&2
  exit 1
fi
echo "[MULTI-ENTITY] Starting guarded production deployment (backups before any D1 migration)..."
bash "$ROOT/update-deploy.sh" "$APP"
echo "[MULTI-ENTITY] Deployment finished; verify existing OA functionality and keep multi-Entity access disabled until Phase 4 acceptance."
