#!/usr/bin/env python3
"""Verify restored production database AND every R2 object from the export manifest.

Run with the OA application stopped, before cutover. No write operations.
"""
import argparse
import importlib.machinery
import json
from pathlib import Path
import sys

restore=importlib.machinery.SourceFileLoader(
    "seeder_restore_checks",str(Path(__file__).with_name("restore-cloudflare.py"))
).load_module()

def main():
 parser=argparse.ArgumentParser(description="Fail closed on any missing DB row, foreign key or R2 object")
 parser.add_argument("--data",type=Path,required=True)
 args=parser.parse_args()
 data=args.data.resolve()
 record=json.loads((data/"migration-report.json").read_text("utf-8"))
 if record.get("format")!="seeder-oa-restore-v1":
  raise RuntimeError("Missing/invalid migration report")
 objects=record["source_r2_manifest"]
 keys=restore.validate_objects(data/"uploads",objects)
 result=restore.inspect_database(data/"seeder.db",keys)
 expected=record["database"]
 if result["tables"]!=expected["tables"]:
  changed={key:(expected["tables"].get(key),result["tables"].get(key))
   for key in set(expected["tables"])|set(result["tables"])
   if expected["tables"].get(key)!=result["tables"].get(key)}
  raise RuntimeError("Row counts changed since import: "+repr(changed))
 if result["r2_references"]!=expected["r2_references"]:
  raise RuntimeError("R2 foreign key reference count changed")
 print("VERIFIED:",len(result["tables"]),"tables,",
       result["tables"].get("user",0),"users,",
       result["tables"].get("oa_finance_invoice",0),"invoices,",
       len(keys),"R2 objects; all SHA256 hashes and references match")

if __name__=="__main__":
 try:main()
 except Exception as error:
  print("VERIFICATION FAILED:",error,file=sys.stderr)
  sys.exit(1)
