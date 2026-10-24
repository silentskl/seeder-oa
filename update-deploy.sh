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
# Refuse to publish to obsolete seeder-oa Worker. Production PM_DB must be smarten-oa.
# Secrets, custom domain routing and database contents are not modified.
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
  console.log('[DEPLOY] Worker name updated: seeder-oa -> smarten-oa');
} else {
  console.log('[DEPLOY] Worker target already smarten-oa');
}
NODE
# Restore the original production D1 binding; never deploy against the one-employee seeder-oa database.
node - <<'NODE'
const fs=require('fs');
const ts=require('typescript');
const file='wrangler.jsonc';
let source=fs.readFileSync(file,'utf8');
const ast=ts.parseJsonText(file,source);
const root=ast.statements[0]?.expression;
const property=(node,key)=>node?.properties?.find(p=>p.name?.text===key);
const array=property(root,'d1_databases')?.initializer;
const entries=array?.elements||[];
const entry=entries.find(e=>property(e,'binding')?.initializer?.text==='PM_DB');
if(!entry||entries.length!==1){console.error('ERROR: expected exactly one PM_DB D1 binding');process.exit(1)}
const expected={database_name:'smarten-oa',database_id:'a2113d04-54d8-4a16-b4e6-d0a1300ea341',preview_database_id:'a2113d04-54d8-4a16-b4e6-d0a1300ea341'};
const changes=[];
for(const [key,value] of Object.entries(expected)){
  const node=property(entry,key)?.initializer;
  if(!node||!ts.isStringLiteral(node)){console.error('ERROR: missing string D1 field',key);process.exit(1)}
  if(node.text!==value)changes.push({start:node.getStart(ast),end:node.getEnd(),replacement:JSON.stringify(value)});
}
for(const c of changes.sort((a,b)=>b.start-a.start))source=source.slice(0,c.start)+c.replacement+source.slice(c.end);
if(changes.length)fs.writeFileSync(file,source);
console.log('[DEPLOY] Production PM_DB verified: smarten-oa (a2113d04-54d8-4a16-b4e6-d0a1300ea341)');
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
if(cfg.name!=='smarten-oa' || !db || db.database_id!=='a2113d04-54d8-4a16-b4e6-d0a1300ea341' || db.database_name!=='smarten-oa' || !bucket || !bucket.bucket_name){
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
echo "[DEPLOY] Validating Cloudflare account and production D1 access..."
# Explicit account selection prevents Wrangler from using a stale or unrelated account.
EXPECTED_ACCOUNT="171a0b87cb7aa3df044f301599d7d86e"
if [[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" && "$CLOUDFLARE_ACCOUNT_ID" != "$EXPECTED_ACCOUNT" ]]; then
  echo "ERROR: CLOUDFLARE_ACCOUNT_ID differs from expected production account." >&2
  exit 1
fi
npx wrangler whoami
# Fail closed on auth errors including 7403; NEVER deploy without database verification.
npx wrangler d1 execute PM_DB --remote --command="SELECT COUNT(*) AS employees FROM oa_employee;"
echo "[DEPLOY] Synchronizing migrations from reviewed overlay..."
mkdir -p migrations
for source in "$ROOT"/overlay/migrations/*.sql; do
  [[ -f "$source" ]] || continue
  target="migrations/$(basename "$source")"
  if [[ -f "$target" ]] && ! cmp -s "$source" "$target"; then
    echo "ERROR: migration differs from reviewed overlay: $target" >&2
    exit 1
  fi
  cp "$source" "$target"
done
# Historical duplicate is not a valid production migration.
if [[ -f migrations/9999_oa_expense_items.sql ]]; then
  mkdir -p "$ROOT/recovery-backups/quarantined"
  mv migrations/9999_oa_expense_items.sql "$ROOT/recovery-backups/quarantined/9999_oa_expense_items-$(date -u +%Y%m%dT%H%M%SZ).sql"
fi
PENDING="$(npx wrangler d1 migrations list PM_DB --remote 2>&1)" || { echo "$PENDING" >&2; exit 1; }
echo "$PENDING"
# Whitelist only migrations reviewed for this production upgrade.
MIGRATIONS="$(printf '%s\n' "$PENDING" | grep -Eo '[0-9]{4}_[[:alnum:]_-]+\\.sql' | sort -u || true)"
if [[ -n "$MIGRATIONS" ]]; then
  UNKNOWN="$(printf '%s\n' "$MIGRATIONS" | grep -Ev '^(9007_expense_items|9008_medical_allowance_atomic|9009_expense_category_management)\\.sql$' || true)"
  if [[ -n "$UNKNOWN" ]]; then
    echo "ERROR: unexpected pending migrations: $UNKNOWN" >&2
    exit 1
  fi
  if [[ "${OA_SKIP_MIGRATIONS:-0}" == "1" ]]; then
    echo "ERROR: pending migrations detected while OA_SKIP_MIGRATIONS=1; refusing incompatible deployment." >&2
    exit 1
  fi
  BACKUP_DIR="$ROOT/recovery-backups/$(date -u +%Y%m%dT%H%M%SZ)-pre-deploy"
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
  echo "[DEPLOY] Backing up production D1 to $BACKUP_DIR..."
  npx wrangler d1 export PM_DB --remote --output="$BACKUP_DIR/smarten-oa.sql"
  [[ -s "$BACKUP_DIR/smarten-oa.sql" ]] || { echo "ERROR: missing or empty D1 backup; deployment aborted." >&2; exit 1; }
  echo "[DEPLOY] Applying reviewed migrations..."
  npx wrangler d1 migrations apply PM_DB --remote
  echo "[DEPLOY] Re-checking remaining migrations..."
  AFTER="$(npx wrangler d1 migrations list PM_DB --remote 2>&1)" || { echo "$AFTER" >&2; exit 1; }
  echo "$AFTER"
  if printf '%s\n' "$AFTER" | grep -Eq '[0-9]{4}_[[:alnum:]_-]+\\.sql'; then
    echo "ERROR: unapplied migration remains; deployment aborted." >&2; exit 1
  fi
else
  echo "[DEPLOY] No pending migrations; backup and migration skipped."
fi
# Verify the schema actually exists, even when Wrangler's migration ledger is out of sync.
SCHEMA_CHECK="$(npx wrangler d1 execute PM_DB --remote --command="SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='oa_expense_category';" 2>&1)" || { echo "$SCHEMA_CHECK" >&2; exit 1; }
echo "$SCHEMA_CHECK"
if ! printf '%s\n' "$SCHEMA_CHECK" | grep -Eq '(^|[[:space:]│])1([[:space:]│]|$)'; then
  echo "ERROR: oa_expense_category is missing in production D1; refusing to deploy." >&2
  exit 1
fi
echo "[DEPLOY] Building production bundle..."
npm run build
echo "[DEPLOY] Publishing Cloudflare Worker smarten-oa (oa.smartenx.com)..."
npm run deploy
echo "[DEPLOY] Completed: smarten-oa. Verify oa.smartenx.com login, OA pages, D1 and R2 access before deleting seeder-oa."
