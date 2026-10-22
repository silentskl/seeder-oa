#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-$ROOT/seeder-oa-app}"
[[ -d "$TARGET" ]] || { echo "ERROR: Seeder application directory not found: $TARGET" >&2; echo "Usage: bash apply-to-existing.sh /path/to/Seeder" >&2; exit 1; }
TARGET="$(cd "$TARGET" && pwd)"
[[ -f "$TARGET/package.json" ]] || { echo "ERROR: package.json not found in $TARGET" >&2; exit 1; }
grep -q '"name"[[:space:]]*:[[:space:]]*"seeder"' "$TARGET/package.json" || { echo "ERROR: target is not the Seeder repository" >&2; exit 1; }
# v0.1.10 keeps OA pages out of Seeder's heavy `(app)` layout into a lightweight
# `(oa)` route group. These paths are created by older OA releases, not upstream Seeder.
rm -rf "$TARGET/app/(app)/oa" "$TARGET/app/(app)/admin/oa" "$TARGET/app/(app)/admin/dashboard"
# Old OA overlay used (app) route group. Remove legacy copies before writing (oa).
if [[ -e "$TARGET/app/(app)/oa/page.tsx" ]]; then
  echo "ERROR: legacy /oa route still exists; refusing conflicting routes" >&2
  exit 1
fi
mkdir -p "$TARGET/app/api/oa/files/[id]" "$TARGET/components/oa" "$TARGET/lib/oa" "$TARGET/migrations"
cp -R "$ROOT/overlay/." "$TARGET/"
python3 "$ROOT/patch-sidebar.py" "$TARGET/components/app/app-sidebar.tsx"
python3 "$ROOT/patch-wrangler-free.py" "$TARGET/wrangler.jsonc"
python3 "$ROOT/patch-bootstrap-vcs.py" "$TARGET"
python3 "$ROOT/patch-oa-entry.py" "$TARGET"
python3 "$ROOT/patch-password-reset.py" "$TARGET"
echo ""
echo "Seeder OA v0.1.14 overlay applied to: $TARGET"
echo "Run: npm run db:migrate:local && npm run dev"
echo "For email settings on an existing deployment, run: $ROOT/configure-email-secret.sh $TARGET"
