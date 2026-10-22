#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-.}"
TARGET="$(cd "$TARGET" && pwd)"
[[ -f "$TARGET/package.json" ]] || { echo "ERROR: package.json not found in $TARGET" >&2; exit 1; }
grep -q '"name"[[:space:]]*:[[:space:]]*"seeder"' "$TARGET/package.json" || { echo "ERROR: target is not the Seeder repository" >&2; exit 1; }
mkdir -p "$TARGET/app/(app)/oa" "$TARGET/app/api/oa/files/[id]" "$TARGET/components/oa" "$TARGET/lib/oa" "$TARGET/migrations"
cp -R "$ROOT/overlay/." "$TARGET/"
python3 "$ROOT/patch-sidebar.py" "$TARGET/components/app/app-sidebar.tsx"
echo ""
echo "Seeder OA v0.1.0 overlay applied to: $TARGET"
echo "Run: npm run db:migrate:local && npm run dev"
