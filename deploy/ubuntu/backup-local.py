#!/usr/bin/env python3
"""Consistent offline backup for Docker SQLite + uploads.

Stop app and scheduler first: sqlite3.backup() snapshots DB, but object files
cannot be transactionally snapshotted while concurrent uploads are in flight.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tarfile
import tempfile

def main():
 parser=argparse.ArgumentParser(description="Backup stopped Ubuntu Seeder OA instance")
 parser.add_argument("--data",required=True,type=Path)
 parser.add_argument("--output",required=True,type=Path,help="New .tar.gz backup path")
 args=parser.parse_args()
 data=args.data.resolve()
 target=args.output.resolve()
 if target.exists():raise RuntimeError("Refusing to overwrite existing backup")
 if not (data/"seeder.db").is_file() or not (data/"uploads").is_dir():
  raise RuntimeError("Missing production database or uploads folder")
 target.parent.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory(prefix=".oa-backup-",dir=str(target.parent)) as temporary:
  stage=Path(temporary)
  source=sqlite3.connect(f"file:{data/'seeder.db'}?mode=ro",uri=True)
  snapshot=sqlite3.connect(stage/"seeder.db")
  try:source.backup(snapshot)
  finally:source.close();snapshot.close()
  for name in ("migration-report.json",):
   if (data/name).is_file():shutil.copy2(data/name,stage/name)
  shutil.copytree(data/"uploads",stage/"uploads",symlinks=False)
  if sqlite3.connect(stage/"seeder.db").execute("PRAGMA integrity_check").fetchone()[0]!="ok":
   raise RuntimeError("SQLite backup integrity check failed")
  temp_archive=target.with_name("."+target.name+".partial")
  try:
   with tarfile.open(temp_archive,"w:gz") as archive:
    for file in stage.rglob("*"):
     if file.is_symlink():raise RuntimeError("Symlink in backup data directory")
     if file.is_file():archive.add(file,arcname=str(file.relative_to(stage)),recursive=False)
   os.replace(temp_archive,target)
  finally:
   if temp_archive.exists():temp_archive.unlink()
 print("Local backup created:",target,"size",target.stat().st_size)
if __name__=="__main__":
 try:main()
 except Exception as exc:
  print("BACKUP FAILED:",exc,file=sys.stderr)
  sys.exit(1)
