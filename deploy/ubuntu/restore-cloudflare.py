#!/usr/bin/env python3
"""Offline, fail-closed D1 SQL + R2 object restore into Seeder Node SQLite/storage.

Source: export-cloudflare.sh snapshot directory (source.json, d1.sql, r2, r2-manifest.json).
Target: the EMPTY bind mount data directory. No existing database is overwritten.
Uses sqlite3 CLI for streaming large D1 dumps; checks foreign keys, manifest hashes,
all database r2_key references, and row counts before publishing.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import uuid

def sha256(path:Path)->str:
 digest=hashlib.sha256()
 with path.open("rb") as f:
  for chunk in iter(lambda:f.read(1024*1024),b""):
   digest.update(chunk)
 return digest.hexdigest()

def safe_key(root:Path,key:str)->Path:
 if not isinstance(key,str) or not key or key.startswith("/") or "\\" in key or "\x00" in key:
  raise ValueError("Unsafe upload key")
 if key.endswith(".meta.json") or any(p in ("",".","..") for p in key.split("/")):
  raise ValueError("Unsafe upload key path or reserved metadata suffix")
 file=(root/key).resolve()
 file.relative_to(root.resolve())
 return file

def load_snapshot(snapshot:Path):
 source=json.loads((snapshot/"source.json").read_text("utf-8"))
 manifest=json.loads((snapshot/"r2-manifest.json").read_text("utf-8"))
 if source.get("format")!="seeder-oa-cloudflare-export-v1":
  raise ValueError("Unrecognized D1 source manifest")
 if manifest.get("format")!="seeder-oa-r2-v1":
  raise ValueError("Unrecognized R2 object manifest")
 if source.get("r2_bucket")!=manifest.get("bucket"):
  raise ValueError("D1 source and R2 bucket manifest disagree")
 sql=snapshot/"d1.sql"
 if not sql.is_file() or sql.stat().st_size!=source.get("d1_sql_bytes"):
  raise ValueError("D1 SQL export missing/incomplete")
 if sha256(sql)!=source.get("d1_sha256"):
  raise ValueError("D1 SQL SHA256 does not match snapshot manifest")
 objects=manifest.get("objects")
 if not isinstance(objects,list) or len(objects)!=manifest.get("objectCount"):
  raise ValueError("R2 manifest object count mismatch")
 if sum(int(x["size"]) for x in objects)!=manifest.get("totalBytes"):
  raise ValueError("R2 manifest byte count mismatch")
 if len({x["key"] for x in objects})!=len(objects):
  raise ValueError("R2 manifest has duplicate keys")
 return source,manifest,sql

def validate_objects(source_dir:Path,manifest:dict):
 source_dir=source_dir.resolve()
 names=set()
 for obj in manifest["objects"]:
  key=obj["key"]
  f=safe_key(source_dir,key)
  if not f.is_file() or f.is_symlink():
   raise RuntimeError("Missing or unsafe R2 object: "+key)
  if f.stat().st_size!=int(obj["size"]) or sha256(f)!=obj["sha256"]:
   raise RuntimeError("Corrupt R2 object: "+key)
  meta=Path(str(f)+".meta.json")
  if not meta.is_file() or meta.is_symlink():
   raise RuntimeError("R2 metadata missing for "+key)
  sidecar=json.loads(meta.read_text("utf-8"))
  if sidecar.get("sha256")!=obj["sha256"]:
   raise RuntimeError("R2 metadata checksum disagreement: "+key)
  names.add(key)
 # Skip .meta.json sidecars, but reject any unexplained payload.
 extra=[]
 for f in source_dir.rglob("*"):
  if not f.is_file():
   continue
  if f.name.endswith(".meta.json"):
   continue
  rel=str(f.relative_to(source_dir))
  if rel not in names:
   extra.append(rel)
 if extra:
  raise RuntimeError("Unexpected extra files in R2 export: "+repr(extra[:5]))
 return names

def inspect_database(database:Path,object_keys:set[str])->dict:
 db=sqlite3.connect(f"file:{database}?mode=ro",uri=True)
 try:
  integrity=db.execute("PRAGMA integrity_check").fetchone()[0]
  if integrity!="ok":raise RuntimeError("SQLite integrity_check failed: "+str(integrity))
  foreign=db.execute("PRAGMA foreign_key_check").fetchmany(5)
  if foreign:raise RuntimeError("SQLite foreign_key_check failed: "+repr(foreign))
  tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
  must_have={"user","session","d1_migrations","oa_file","oa_finance_invoice","oa_finance_document"}
  if not must_have.issubset(tables):
   raise RuntimeError("Snapshot does not have the expected production OA tables: "+
    repr(sorted(must_have-set(tables))))
  counters={}
  references=0
  missing=[]
  for table in tables:
   name='"'+table.replace('"','""')+'"'
   counters[table]=int(db.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0])
   columns=[r[1] for r in db.execute(f"PRAGMA table_info({name})")]
   if "r2_key" in columns:
    for (key,) in db.execute(f"SELECT r2_key FROM {name} WHERE r2_key IS NOT NULL AND r2_key<>''"):
     references+=1
     if key not in object_keys:missing.append((table,key))
  if missing:
   raise RuntimeError("Database references R2 objects not included in export: "+repr(missing[:10]))
  if counters["user"]==0:
   raise RuntimeError("Source snapshot contains zero users: refusing to replace existing production")
  return {"tables":counters,"r2_references":references,"objects":len(object_keys),"integrity":"ok","foreign_keys":"ok"}
 finally:db.close()

def check_target(data:Path):
 if data.is_symlink():raise RuntimeError("Data destination must not be a symlink")
 db=data/"seeder.db"
 upload=data/"uploads"
 if db.exists() or upload.exists():
  raise RuntimeError("Destination database or uploads already exists. Restore to an EMPTY data directory; never overwrite live data.")
 if any(data.glob("seeder.db-*")):
  raise RuntimeError("Existing SQLite WAL/journal found: refuse to restore into potentially active data directory")

def restore(snapshot:Path,data:Path):
 snapshot=snapshot.resolve()
 data=data.resolve()
 if data==snapshot or snapshot in data.parents or data in snapshot.parents:
  raise RuntimeError("Snapshot and destination must be separate directories")
 source,manifest,sql=load_snapshot(snapshot)
 if not shutil.which("sqlite3"):
  raise RuntimeError("Install sqlite3 CLI before restore (sudo apt install sqlite3)")
 data.mkdir(parents=True,exist_ok=True)
 check_target(data)
 objects=validate_objects(snapshot/"r2",manifest)
 stage_db=data/(".seeder-db-"+uuid.uuid4().hex)
 stage_uploads=data/(".seeder-uploads-"+uuid.uuid4().hex)
 try:
  with sql.open("rb") as input_stream:
   subprocess.run(["sqlite3","-bail",str(stage_db)],stdin=input_stream,check=True)
  report=inspect_database(stage_db,objects)
  shutil.copytree(snapshot/"r2",stage_uploads,symlinks=False)
  validate_objects(stage_uploads,manifest)
  # The two renames are only done after both artifacts are fully verified.
  # The application MUST remain stopped until post-restore verification succeeds.
  stage_uploads.rename(data/"uploads")
  stage_db.rename(data/"seeder.db")
  record={
   "format":"seeder-oa-restore-v1","source":source,
   "r2_manifest_sha256":sha256(snapshot/"r2-manifest.json"),
   "source_r2_manifest":manifest,
   "database":report,
  }
  (data/"migration-report.json").write_text(json.dumps(record,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
  print("RESTORE OK:",report["tables"].get("user"),"users,",
        report["tables"].get("oa_finance_invoice"),"invoices,",
        report["objects"],"R2 objects;",report["r2_references"],"database references")
  print("Run verify-migration.py before starting Docker.")
 except Exception:
  # Never delete successfully published destination data; it may be needed for recovery.
  if stage_db.exists():stage_db.unlink()
  if stage_uploads.exists():shutil.rmtree(stage_uploads)
  raise

def main():
 p=argparse.ArgumentParser(description="Restore D1/R2 snapshot to an empty local Seeder data directory")
 p.add_argument("--snapshot",required=True,type=Path)
 p.add_argument("--data",required=True,type=Path)
 args=p.parse_args()
 restore(args.snapshot,args.data)

if __name__=="__main__":
 try:main()
 except Exception as error:
  print("RESTORE REFUSED:",error,file=sys.stderr)
  sys.exit(1)
