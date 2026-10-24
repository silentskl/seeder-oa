#!/usr/bin/env bash
# One-time production recovery: preserve original smarten-oa D1 and migrate to multi-item claims.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="${1:-$ROOT/seeder-oa-app}"
APP="$(cd "$APP" && pwd)"
cd "$APP"
DB_ID="a2113d04-54d8-4a16-b4e6-d0a1300ea341"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$ROOT/recovery-backups/$STAMP"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
echo "[RECOVERY] Backups: $BACKUP_DIR"
cp wrangler.jsonc "$BACKUP_DIR/wrangler.jsonc.before"
node - <<'NODE'
const fs=require('fs'),ts=require('typescript');
const f='wrangler.jsonc',source=fs.readFileSync(f,'utf8'),ast=ts.parseJsonText(f,source);
const root=ast.statements[0]?.expression;
const prop=(obj,key)=>obj?.properties?.find(x=>x.name?.text===key);
const dbs=prop(root,'d1_databases')?.initializer?.elements||[];
const db=dbs.find(x=>prop(x,'binding')?.initializer?.text==='PM_DB');
if(dbs.length!==1||!db)throw Error('Expected exactly one PM_DB binding');
const expected={database_name:'smarten-oa',database_id:'a2113d04-54d8-4a16-b4e6-d0a1300ea341',preview_database_id:'a2113d04-54d8-4a16-b4e6-d0a1300ea341'};
let out=source;const edits=[];
for(const [k,v] of Object.entries(expected)){const node=prop(db,k)?.initializer;if(!node||!ts.isStringLiteral(node))throw Error('Missing D1 field '+k);edits.push({a:node.getStart(ast),b:node.getEnd(),v:JSON.stringify(v)});}
for(const x of edits.sort((a,b)=>b.a-a.a))out=out.slice(0,x.a)+x.v+out.slice(x.b);
fs.writeFileSync(f,out);
console.log('[RECOVERY] PM_DB bound to original production D1');
NODE
for file in 9007_expense_items.sql 9008_medical_allowance_atomic.sql; do
  [[ -s "migrations/$file" ]] || { echo "ERROR: missing $file" >&2; exit 1; }
  cmp -s "migrations/$file" "$ROOT/overlay/migrations/$file" || { echo "ERROR: migration $file differs from reviewed overlay" >&2; exit 1; }
done
if [[ -f migrations/9999_oa_expense_items.sql ]]; then
  mv migrations/9999_oa_expense_items.sql "$BACKUP_DIR/"
  echo "[RECOVERY] Quarantined duplicate migration 9999 outside migrations/"
fi
echo "[RECOVERY] Confirm remote production identity..."
npx wrangler d1 execute PM_DB --remote --command="SELECT COUNT(*) AS employees FROM oa_employee;"
echo "[RECOVERY] Exporting fresh production backup before schema changes..."
npx wrangler d1 export PM_DB --remote --output="$BACKUP_DIR/smarten-oa-before-migration.sql"
[[ -s "$BACKUP_DIR/smarten-oa-before-migration.sql" ]] || { echo "ERROR: empty backup" >&2; exit 1; }
echo "[RECOVERY] Pending migrations:"
PENDING="$(npx wrangler d1 migrations list PM_DB --remote 2>&1)" || { echo "$PENDING" >&2; exit 1; }
echo "$PENDING"
if echo "$PENDING" | grep -Eq '9999_|900[0-6]_'; then
  echo "ERROR: unexpected old or duplicate pending migration" >&2; exit 1
fi
# Only expected migration names are allowed in pending list.
UNKNOWN="$(printf '%s\n' "$PENDING" | grep -Eo '[[:alnum:]_-]+\.sql' | grep -Ev '^(9007_expense_items|9008_medical_allowance_atomic)\.sql$' || true)"
[[ -z "$UNKNOWN" ]] || { echo "ERROR: unknown pending migrations: $UNKNOWN" >&2; exit 1; }
if ! echo "$PENDING" | grep -q '9007_expense_items.sql'; then
  echo "[RECOVERY] 9007 not pending; checking table exists."
  npx wrangler d1 execute PM_DB --remote --command="SELECT COUNT(*) AS item_rows FROM oa_expense_item;"
fi
if [[ "${OA_RECOVERY_APPLY:-}" != "YES" ]]; then
  echo "[RECOVERY] Preflight and backup complete. No migration applied."
  echo "To migrate: OA_RECOVERY_APPLY=YES bash $ROOT/recover-smarten-oa.sh $APP"
  exit 0
fi
echo "[RECOVERY] Applying reviewed migrations to original production D1..."
npx wrangler d1 migrations apply PM_DB --remote
echo "[RECOVERY] Post-migration verification..."
npx wrangler d1 execute PM_DB --remote --command="SELECT COUNT(*) AS employees FROM oa_employee;"
npx wrangler d1 execute PM_DB --remote --command="SELECT COUNT(*) AS claims FROM oa_expense_claim;"
npx wrangler d1 execute PM_DB --remote --command="SELECT COUNT(*) AS items FROM oa_expense_item;"
npx wrangler d1 execute PM_DB --remote --command="SELECT COUNT(*) AS document_links FROM oa_expense_item_document;"
echo "[RECOVERY] Migration complete. To publish frontend: bash $ROOT/update-deploy.sh $APP"
