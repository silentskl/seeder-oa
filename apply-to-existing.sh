#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-$ROOT/seeder-oa-app}"
if [[ ! -d "$TARGET" ]]; then
  echo "ERROR: Seeder application directory not found: $TARGET" >&2
  echo "Usage: bash apply-to-existing.sh /absolute/path/to/Seeder" >&2
  exit 1
fi
TARGET="$(cd "$TARGET" && pwd)"
[[ -f "$TARGET/package.json" ]] || { echo "ERROR: package.json not found in $TARGET" >&2; exit 1; }
grep -q '"name"[[:space:]]*:[[:space:]]*"seeder"' "$TARGET/package.json" || { echo "ERROR: target is not the Seeder repository" >&2; exit 1; }
# Safety guard: older overlays lack the v0.1.14 OA layout and medical migration.
# Never silently downgrade an existing v0.1.14 installation.
if [[ -f "$TARGET/migrations/9006_medical_insurance_claims.sql" ]] && \
   { [[ ! -f "$ROOT/overlay/migrations/9006_medical_insurance_claims.sql" ]] || \
     [[ ! -f "$ROOT/overlay/app/(oa)/layout.tsx" ]]; }; then
  echo "ERROR: This overlay is missing v0.1.14 components. Upgrade aborted to prevent feature regression." >&2
  exit 2
fi
mkdir -p "$TARGET/app/(app)/oa" "$TARGET/app/api/oa/files/[id]" "$TARGET/components/oa" "$TARGET/lib/oa" "$TARGET/migrations"
cp -R "$ROOT/overlay/." "$TARGET/"
python3 "$ROOT/patch-sidebar.py" "$TARGET/components/app/app-sidebar.tsx"
echo ""
echo "Seeder OA v0.1.0 overlay applied to: $TARGET"
echo "Run: npm run db:migrate:local && npm run dev"
