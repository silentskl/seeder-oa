#!/usr/bin/env bash
# Run on a trusted workstation with Cloudflare access and the original source config.
# This NEVER deletes or modifies D1 / R2. Re-export after writes are frozen.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$ROOT/../../seeder-oa-app" && pwd)"
if [[ "$#" -ne 1 ]]; then
 echo "Usage: CONFIRM_D1_DATABASE_ID=<id> CONFIRM_R2_BUCKET_NAME=<bucket> bash deploy/ubuntu/export-cloudflare.sh /secure/export-dir" >&2
 exit 2
fi
DEST="$(mkdir -p "$1" && cd "$1" && pwd)"
[[ -f "$APP/wrangler.jsonc" && -f "$APP/package.json" ]] || { echo "Missing original Seeder app/wrangler.jsonc" >&2; exit 1; }
for cmd in node npm python3; do command -v "$cmd" >/dev/null || { echo "Missing executable: $cmd" >&2; exit 1; }; done
[[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" && -n "${R2_ACCESS_KEY_ID:-}" && -n "${R2_SECRET_ACCESS_KEY:-}" ]] || {
 echo "Set CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in your shell (do not commit them)" >&2; exit 1;
}
[[ -n "${CONFIRM_D1_DATABASE_ID:-}" && -n "${CONFIRM_R2_BUCKET_NAME:-}" ]] || {
 echo "Explicitly confirm the production D1 database ID and R2 bucket before exporting" >&2; exit 1;
}
SOURCE="$(cd "$APP" && node - <<'NODE'
const fs=require("fs"),ts=require("typescript");
const file="wrangler.jsonc",parsed=ts.parseConfigFileTextToJson(file,fs.readFileSync(file,"utf8"));
if(parsed.error)process.exit(10);
const db=(parsed.config.d1_databases||[]).filter(x=>x.binding==="PM_DB");
const r2=(parsed.config.r2_buckets||[]).filter(x=>x.binding==="UPLOADS");
if(db.length!==1||r2.length!==1)process.exit(11);
console.log(db[0].database_id+"|"+r2[0].bucket_name);
NODE
)"
IFS='|' read -r DBID BUCKET <<< "$SOURCE"
if [[ "$DBID" != "$CONFIRM_D1_DATABASE_ID" || "$BUCKET" != "$CONFIRM_R2_BUCKET_NAME" ]]; then
 echo "SOURCE BINDING MISMATCH. wrangler.jsonc has D1=$DBID R2=$BUCKET. Refusing unconfirmed export." >&2; exit 1
fi
if [[ -e "$DEST/d1.sql" ]]; then
 echo "D1 export already exists: $DEST/d1.sql. Use a fresh destination for a consistent snapshot." >&2
 exit 1
fi
echo "Exporting read-only source: D1=$DBID, R2=$BUCKET"
echo "WARNING: For final cutover, disable all writes and the old Cloudflare cron BEFORE starting this export."
(cd "$APP" && npx wrangler d1 export PM_DB --remote --output "$DEST/d1.sql")
[[ -s "$DEST/d1.sql" ]] || { echo "D1 export missing or empty" >&2; exit 1; }
python3 "$ROOT/export-r2.py" --bucket "$BUCKET" --output "$DEST/r2" --manifest "$DEST/r2-manifest.json"
python3 - "$DEST" "$DBID" "$BUCKET" <<'PY'
import hashlib,json,sys,datetime,pathlib
p=pathlib.Path(sys.argv[1])
f=p/"d1.sql"
h=hashlib.sha256()
with f.open("rb") as inp:
 for chunk in iter(lambda:inp.read(1024*1024),b""):
  h.update(chunk)
meta={"format":"seeder-oa-cloudflare-export-v1","created_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
 "d1_database_id":sys.argv[2],"r2_bucket":sys.argv[3],"d1_sql_bytes":f.stat().st_size,"d1_sha256":h.hexdigest()}
(p/"source.json").write_text(json.dumps(meta,indent=2)+"\n")
print("Source manifest saved to",p/"source.json")
PY
echo "Export complete. Transport the WHOLE directory securely to Ubuntu; do not expose it on a public web path."
