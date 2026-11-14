#!/usr/bin/env python3
"""Fail-closed D1 SQL + R2 snapshot migration into Seeder Ubuntu Docker data.

No Cloudflare writes. No existing Ubuntu database or upload directory is replaced.
Migrations use the original D1 SQLite schema, IDs, users and encryption ciphertext.
"""
import argparse
import hashlib
import json
import mimetypes
import os
import pathlib
import shutil
import sqlite3
import sys
import uuid

REQUIRED_TABLES=("user","oa_entity","oa_finance_invoice","oa_finance_document")
MAX_ERRORS=15

def fail(message):
    raise RuntimeError(message)

def key_path(root, key):
    if not isinstance(key,str) or not key or key.startswith("/") or "\\" in key or "\x00" in key:
        fail("Unsafe R2 object key")
    parts=key.split("/")
    if any(part in ("", ".", "..") for part in parts):
        fail("Unsafe R2 object key")
    candidate=root.joinpath(*parts)
    if not candidate.resolve().is_relative_to(root.resolve()):
        fail("R2 object escapes upload root")
    return candidate

def objects(stage):
    file=stage/"r2-objects.json"
    if not file.is_file(): fail("Missing R2 object manifest")
    raw=json.loads(file.read_text(encoding="utf-8"))
    if raw.get("IsTruncated"):
        fail("R2 list result is truncated; obtain all pages before migrating")
    contents=raw.get("Contents") or []
    if not isinstance(contents,list):fail("Invalid R2 Contents list")
    data={}
    for entry in contents:
        key=entry.get("Key")
        size=entry.get("Size")
        if not isinstance(size,int) or size<0:fail("Invalid R2 object length")
        # S3 console folder markers are not actual file payloads.
        if isinstance(key,str) and key.endswith("/") and size==0:continue
        key_path(stage/"uploads",key)
        if key in data:fail("R2 manifest contains duplicate keys")
        data[key]=size
    for key in data:
        if key+".meta.json" in data:
            fail("R2 contains a key that conflicts with local storage metadata sidecars")
    return data

def validate_files(stage):
    expected=objects(stage)
    directory=stage/"uploads"
    if not directory.is_dir():fail("Missing R2 objects download directory")
    missing=[]
    total=0
    for key,size in expected.items():
        p=key_path(directory,key)
        if not p.is_file() or p.is_symlink() or p.stat().st_size!=size:
            missing.append(key)
            if len(missing)>=MAX_ERRORS:break
        else:total+=size
    if missing:fail("Missing/wrong-sized R2 downloads (first %d): %s"%(len(missing),missing))
    # S3 sync is expected to mirror the bucket; extra files may be stale.
    extra=[]
    for p in directory.rglob("*"):
        if p.is_symlink():fail("Symlink detected in snapshot uploads")
        if p.is_file() and p.relative_to(directory).as_posix() not in expected:
            extra.append(p.relative_to(directory).as_posix())
            if len(extra)>=MAX_ERRORS:break
    if extra:fail("Unexpected files in snapshot uploads: "+str(extra))
    return {"objects":len(expected),"bytes":sum(expected.values())}

def sha256_file(p):
    h=hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):
            h.update(chunk)
    return h.hexdigest()

def audit_db(conn,upload_root=None):
    integrity=conn.execute("PRAGMA integrity_check").fetchone()[0]
    if integrity!="ok":fail("SQLite integrity_check failed: "+str(integrity))
    foreign=conn.execute("PRAGMA foreign_key_check").fetchmany(MAX_ERRORS)
    if foreign:fail("SQLite foreign-key errors: "+str(foreign))
    tables={row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    missing=set(REQUIRED_TABLES)-tables
    if missing:fail("Missing required OA tables: "+str(sorted(missing)))
    counts={}
    for table in sorted(tables):
        if table.startswith("sqlite_"):continue
        counts[table]=int(conn.execute('SELECT COUNT(*) FROM "'+table.replace('"','""')+'"').fetchone()[0])
    if upload_root is not None:
        rows=conn.execute("SELECT r2_key FROM oa_finance_document WHERE r2_key IS NOT NULL AND r2_key<>''").fetchall()
        missing_docs=[row[0] for row in rows if not key_path(upload_root,row[0]).is_file()]
        if missing_docs:fail("Missing finance invoice/payment attachments: "+str(missing_docs[:MAX_ERRORS]))
    return counts

def sidecars(root,expected):
    for key in expected:
        target=key_path(root,key)
        mime=mimetypes.guess_type(key)[0] or "application/octet-stream"
        # Seeder upstream local storage reads .meta.json files to preserve Content-Type.
        meta={"contentType":mime,"etag":'"'+sha256_file(target)+'"'}
        sidecar=key_path(root,key+".meta.json")
        sidecar.write_text(json.dumps(meta,separators=(",",":")),encoding="utf-8")
        sidecar.chmod(0o600)

def restore(stage,data_dir):
    sql=stage/"database.sql"
    if not sql.is_file() or sql.stat().st_size==0:fail("Missing/empty D1 database.sql")
    info=validate_files(stage)
    data_dir.mkdir(mode=0o700,parents=True,exist_ok=True)
    destination=data_dir/"seeder.db"
    upload_dest=data_dir/"uploads"
    if destination.exists() or upload_dest.exists():
        fail("Refusing overwrite: target seeder.db or uploads already exists. Restore into a NEW data directory.")
    temp_db=data_dir/(".seeder-restore-"+uuid.uuid4().hex+".db")
    temp_uploads=data_dir/(".uploads-restore-"+uuid.uuid4().hex)
    try:
        conn=sqlite3.connect(temp_db)
        try:
            conn.executescript(sql.read_text(encoding="utf-8"))
            # Ensure FK constraints are checked against the full finished import.
            conn.execute("PRAGMA foreign_keys=ON")
            before=audit_db(conn)
        finally:conn.close()
        shutil.copytree(stage/"uploads",temp_uploads,symlinks=False)
        sidecars(temp_uploads,objects(stage))
        conn=sqlite3.connect(temp_db)
        try:
            after=audit_db(conn,temp_uploads)
            if after!=before:fail("Row counts changed during file import")
        finally:conn.close()
        os.chmod(temp_db,0o600)
        os.replace(temp_uploads,upload_dest)
        os.replace(temp_db,destination)
        report={
            "sql_sha256":sha256_file(sql),
            "sqlite_sha256":sha256_file(destination),
            "r2":info,
            "table_counts":before,
            "status":"imported",
            "note":"Never start both Cloudflare and Docker as active writers after cutover"
        }
        (data_dir/"migration-report.json").write_text(json.dumps(report,indent=2,sort_keys=True),encoding="utf-8")
        os.chmod(data_dir/"migration-report.json",0o600)
        print("RESTORED D1/R2 snapshot successfully")
        print("Tables:",len(before),"Objects:",info["objects"],"Bytes:",info["bytes"])
        print("Report:",data_dir/"migration-report.json")
    except BaseException:
        if temp_db.exists():temp_db.unlink()
        if temp_uploads.exists():shutil.rmtree(temp_uploads)
        raise

def verify(data_dir):
    db=data_dir/"seeder.db"
    report_path=data_dir/"migration-report.json"
    if not db.is_file() or not report_path.is_file():fail("Missing migrated database or report")
    report=json.loads(report_path.read_text(encoding="utf-8"))
    conn=sqlite3.connect(f"file:{db}?mode=ro",uri=True)
    try:counts=audit_db(conn,data_dir/"uploads")
    finally:conn.close()
    expected=report["table_counts"]
    drift={name:(value,counts.get(name)) for name,value in expected.items() if counts.get(name)!=value}
    if drift:fail("Database changed since snapshot; for cutover verification stop writers and re-import final snapshot: "+str(drift)[:500])
    upload_files=[p for p in (data_dir/"uploads").rglob("*") if p.is_file() and not p.name.endswith(".meta.json")]
    if len(upload_files)!=report["r2"]["objects"]:
        fail("R2 file count differs from migration report")
    print("PASS: SQLite integrity, foreign keys, table counts, invoice attachments, R2 object count")

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest="action",required=True)
    for action in ("validate-manifest","validate-files","import"):
        p=sub.add_parser(action);p.add_argument("--stage",type=pathlib.Path,required=True)
        if action=="import":
            p.add_argument("--data-dir",type=pathlib.Path,required=True)
            p.add_argument("--apply",action="store_true",help="Explicitly allow writing a NEW SQLite/uploads directory")
    sub.add_parser("verify").add_argument("--data-dir",type=pathlib.Path,required=True)
    a=parser.parse_args()
    if a.action=="validate-manifest":
        print("R2 manifest entries:",len(objects(a.stage)))
    elif a.action=="validate-files":
        print(json.dumps(validate_files(a.stage),sort_keys=True))
    elif a.action=="import":
        if not a.apply:fail("Dry-run guard: pass --apply to import into a NEW data directory")
        restore(a.stage,a.data_dir)
    elif a.action=="verify":verify(a.data_dir)

if __name__=="__main__":
    try:main()
    except (RuntimeError,ValueError,sqlite3.Error,OSError) as error:
        print("MIGRATION FAILED:",error,file=sys.stderr)
        sys.exit(1)
