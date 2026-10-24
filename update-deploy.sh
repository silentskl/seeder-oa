#!/usr/bin/env bash
# Publish an already-applied Seeder OA overlay. Fail closed on unknown production bindings.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="${1:-$ROOT/seeder-oa-app}"
APP="$(cd "$APP" && pwd)"
cd "$APP"
command -v node >/dev/null || { echo "ERROR: node required" >&2; exit 1; }
command -v npm >/dev/null || { echo "ERROR: npm required" >&2; exit 1; }
[[ -f package.json && -f wrangler.jsonc ]] || { echo "ERROR: expected Seeder app with wrangler.jsonc" >&2; exit 1; }
# Production custom domain oa.smartenx.com is attached to the smarten-oa Worker.
# Refuse to publish to the obsolete seeder-oa Worker; only the Worker name is changed.
# D1/R2 bindings, secrets and custom domain routing are NOT modified by this patch.
node - <<'NODE'
const fs = require('fs');
const ts = require('typescript');
const file = 'wrangler.jsonc';
const source = fs.readFileSync(file, 'utf8');
const ast = ts.parseJsonText(file, source);
const props = ast.statements[0]?.expression?.properties || [];
const names = props.filter(p => p.name?.text === 'name');
if (names.length !== 1 || !ts.isStringLiteral(names[0].initializer)) {
  console.error('ERROR: expected one top-level string Worker name in wrangler.jsonc');
  process.exit(1);
}
const nameNode = names[0].initializer;
const current = nameNode.text;
if (!['seeder-oa', 'smarten-oa'].includes(current)) {
  console.error('ERROR: unexpected Worker name:', current);
  process.exit(1);
}
if (current === 'seeder-oa') {
  const updated = source.slice(0, nameNode.getStart(ast)) + JSON.stringify('smarten-oa') + source.slice(nameNode.getEnd());
  fs.writeFileSync(file, updated);
  console.log('[DEPLOY] Worker name updated: seeder-oa -> smarten-oa; D1/R2 unchanged');
} else {
  console.log('[DEPLOY] Worker target already smarten-oa');
}
NODE
# Strip JSONC comments safely using TypeScript if available, otherwise use Wrangler's config parser via JSONC package.
node - <<'NODE'
const fs=require('fs');
const ts=require('typescript');
const parsed=ts.parseConfigFileTextToJson('wrangler.jsonc',fs.readFileSync('wrangler.jsonc','utf8'));
if(parsed.error){console.error('ERROR: invalid wrangler.jsonc');process.exit(1)}
const cfg=parsed.config;
const db=(cfg.d1_databases||[]).find(x=>x.binding==='PM_DB');
const bucket=(cfg.r2_buckets||[]).find(x=>x.binding==='UPLOADS');
if(cfg.name!=='smarten-oa' || !db || !db.database_id || !db.database_name || db.database_name==='seeder' || !bucket || bucket.bucket_name==='seeder-uploads'){
 console.error('ERROR: default or incomplete production bindings. Verify Worker name, PM_DB and UPLOADS in wrangler.jsonc before deploying.');
 process.exit(1);
}
console.log('Deployment target:',cfg.name,'D1:',db.database_name,'('+db.database_id+')','R2:',bucket.bucket_name);
NODE
# Ensure the application source matches the overlay being published.
OVERLAY_CONSOLE="$ROOT/overlay/components/oa/oa-console.tsx"
APP_CONSOLE="$APP/components/oa/oa-console.tsx"
[[ -f "$OVERLAY_CONSOLE" && -f "$APP_CONSOLE" ]] || { echo "ERROR: OA console missing from overlay or app. Run apply-to-existing.sh first." >&2; exit 1; }
if ! cmp -s "$OVERLAY_CONSOLE" "$APP_CONSOLE"; then
  echo "ERROR: application OA console differs from the checked-out overlay." >&2
  echo "Run: bash \"$ROOT/apply-to-existing.sh\" \"$APP\" (or OA_SKIP_DEPLOY=1 first)." >&2
  exit 1
fi
if ! grep -q 'Current claim · Expense items' "$APP_CONSOLE" || ! grep -q 'Claim history (' "$APP_CONSOLE"; then
  echo "ERROR: OA console does not contain the claim-workspace UI. Update the overlay checkout first." >&2
  exit 1
fi
printf '[DEPLOY] Verified OA frontend source SHA256: '
shasum -a 256 "$APP_CONSOLE" | awk '{print $1}'
echo "[DEPLOY] Checking Cloudflare access and D1 migration state..."
npx wrangler whoami
# Do not apply unreviewed SQL to an existing production database.
PENDING="$(npx wrangler d1 migrations list PM_DB --remote 2>&1)" || { echo "$PENDING" >&2; exit 1; }
echo "$PENDING"
if [[ "$PENDING" =~ 900[0-9]_ ]] || [[ "$PENDING" =~ 9999_ ]]; then
  echo "ERROR: Pending OA migrations may exist. Review, back up and apply them manually before deploying." >&2
  exit 1
fi
echo "[DEPLOY] Building production bundle..."
npm run build
echo "[DEPLOY] Publishing Cloudflare Worker smarten-oa (oa.smartenx.com)..."
npm run deploy
echo "[DEPLOY] Completed: smarten-oa. Verify oa.smartenx.com login, OA pages, D1 and R2 access before deleting seeder-oa."
