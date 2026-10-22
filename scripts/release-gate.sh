#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${1:-$ROOT/seeder-oa-app}"
MODE="${2:-staging}"
[[ "$MODE" == staging || "$MODE" == production ]] || { echo 'Usage: bash scripts/release-gate.sh /path/to/seeder-app [staging|production]' >&2; exit 2; }
fail(){ echo "RELEASE BLOCKED: $*" >&2; exit 1; }
command -v node >/dev/null || fail 'Node.js missing'
command -v npm >/dev/null || fail 'npm missing'
command -v python3 >/dev/null || fail 'Python missing'
node -e 'if(+process.versions.node.split(".")[0]<22)process.exit(1)' || fail 'Node.js 22+ required'
python3 "$ROOT/scripts/test-medical-allowance.py" || fail "Medical allowance atomicity tests failed"
python3 "$ROOT/tests/test_migrations.py" || fail 'SQLite migration tests failed'
node "$ROOT/tests/check-ts-syntax.cjs" "$ROOT/overlay" || fail 'TypeScript syntax test failed'
[[ -f "$APP/package.json" ]] || fail "Full Seeder source unavailable at $APP; full build NOT verified"
[[ -f "$APP/wrangler.jsonc" ]] || fail 'wrangler.jsonc missing'
[[ -f "$APP/migrations/9008_medical_allowance_atomic.sql" ]] || fail "Medical allowance guard migration missing"
[[ -f "$APP/migrations/9007_expense_items.sql" ]] || fail 'Overlay not applied: migration missing'
[[ -d "$APP/node_modules" ]] || { echo 'Installing locked dependencies'; (cd "$APP" && npm ci); }
(cd "$APP" && npm run build) || fail 'Full Next.js build failed'
[[ -f "$ROOT/tests/acceptance-signoff.env" ]] || fail 'Staging D1/R2 and functional regression sign-off missing'
# This file is created manually by the release operator after actual testing.
# shellcheck disable=SC1091
source "$ROOT/tests/acceptance-signoff.env"
for name in MIGRATION_REMOTE R2_UPLOAD_DOWNLOAD CLAIM_MULTI_ITEM APPROVAL_WORKFLOW MEDICAL_ANNUAL_LIMIT LEGACY_CLAIMS AUTHORIZATION LEAVE_PAYROLL_PASSWORD_RESET; do
 [[ "${!name:-}" == PASS ]] || fail "$name not signed off PASS"
done
if [[ "$MODE" == production ]]; then
 [[ "${D1_BACKUP_VERIFIED:-}" == PASS ]] || fail 'D1 backup not verified'
 [[ "${ROLLBACK_PLAN_VERIFIED:-}" == PASS ]] || fail 'Rollback plan not verified'
fi
echo "RELEASE GATE PASS ($MODE) — full build and all required sign-offs verified"
