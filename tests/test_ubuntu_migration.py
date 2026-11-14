#!/usr/bin/env python3
"""No Cloudflare credentials required: migration/Node adapter regression tests."""
import hashlib
import importlib.machinery
import json
import pathlib
import shutil
import sqlite3
import subprocess
import tempfile
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
UBUNTU=ROOT/"deploy/ubuntu"
RESTORE=importlib.machinery.SourceFileLoader(
    "seeder_ubuntu_restore",str(UBUNTU/"restore-cloudflare.py")
).load_module()
ENV=(ROOT/"overlay/lib/oa/env.ts").read_text()
NODE=(ROOT/"overlay/lib/oa/node-bindings.ts").read_text()
COMPOSE=(UBUNTU/"docker-compose.yml").read_text()
DOCKERFILE=(UBUNTU/"Dockerfile").read_text()

class UbuntuMigrationTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory()
  self.addCleanup(self.temp.cleanup)
  self.root=pathlib.Path(self.temp.name)
  self.snapshot=self.root/"export"
  (self.snapshot/"r2"/"oa"/"company"/"user").mkdir(parents=True)
  self.payload=b"%PDF-1.7\nold invoice\n"
  self.key="oa/company/user/invoice.pdf"
  p=self.snapshot/"r2"/self.key
  p.write_bytes(self.payload)
  self.digest=hashlib.sha256(self.payload).hexdigest()
  pathlib.Path(str(p)+".meta.json").write_text(json.dumps({
   "sha256":self.digest,"contentType":"application/pdf","etag":'"'+self.digest+'"'"'
  }))
  self.manifest={"format":"seeder-oa-r2-v1","bucket":"fixture-bucket",
   "objectCount":1,"totalBytes":len(self.payload),"objects":[{
    "key":self.key,"size":len(self.payload),"sha256":self.digest,"contentType":"application/pdf"
   }]}
  (self.snapshot/"r2-manifest.json").write_text(json.dumps(self.manifest))
  db=self.root/"fixture.sqlite"
  c=sqlite3.connect(db)
  c.executescript("""
   CREATE TABLE user(id TEXT PRIMARY KEY);
   CREATE TABLE session(id TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES user(id));
   CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE);
   CREATE TABLE oa_file(id TEXT PRIMARY KEY,r2_key TEXT);
   CREATE TABLE oa_finance_invoice(id TEXT PRIMARY KEY);
   CREATE TABLE oa_finance_document(id TEXT PRIMARY KEY,r2_key TEXT);
   INSERT INTO user VALUES('owner'); INSERT INTO session VALUES('session1','owner');
   INSERT INTO d1_migrations VALUES(1,'0001_initial.sql');
   INSERT INTO oa_file VALUES('attachment','oa/company/user/invoice.pdf');
   INSERT INTO oa_finance_invoice VALUES('invoice1');
   INSERT INTO oa_finance_document VALUES('doc','oa/company/user/invoice.pdf');
  """)
  c.commit()
  dump="\n".join(c.iterdump())+"\n"
  c.close()
  (self.snapshot/"d1.sql").write_text(dump)
  self.source={"format":"seeder-oa-cloudflare-export-v1",
   "d1_database_id":"00000000-1111-2222-3333-444444444444",
   "r2_bucket":"fixture-bucket","d1_sql_bytes":len(dump.encode()),
   "d1_sha256":hashlib.sha256(dump.encode()).hexdigest()}
  (self.snapshot/"source.json").write_text(json.dumps(self.source))
  self.data=self.root/"data"

 def test_snapshot_validation_preserves_accounts_and_invoice_attachments(self):
  source,manifest,sql=RESTORE.load_snapshot(self.snapshot)
  self.assertEqual(source["d1_database_id"],self.source["d1_database_id"])
  self.assertEqual(manifest["objectCount"],1)
  self.assertEqual(RESTORE.validate_objects(self.snapshot/"r2",manifest),{self.key})

 def test_sqlite_import_and_all_references(self):
  if not shutil.which("sqlite3"):self.skipTest("sqlite3 CLI unavailable on test host")
  RESTORE.restore(self.snapshot,self.data)
  db=sqlite3.connect(self.data/"seeder.db")
  self.assertEqual(db.execute("SELECT COUNT(*) FROM user").fetchone()[0],1)
  self.assertEqual(db.execute("SELECT COUNT(*) FROM oa_finance_invoice").fetchone()[0],1)
  self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(),[])
  db.close()
  self.assertEqual((self.data/"uploads"/self.key).read_bytes(),self.payload)
  report=json.loads((self.data/"migration-report.json").read_text())
  self.assertEqual(report["database"]["r2_references"],2)
  with self.assertRaisesRegex(RuntimeError,"already exists"):
   RESTORE.restore(self.snapshot,self.data)

 def test_reject_wrong_manifest_hash(self):
  (self.snapshot/"d1.sql").write_text("tampered")
  with self.assertRaisesRegex(ValueError,"SQL"):
   RESTORE.load_snapshot(self.snapshot)

 def test_reject_missing_invoice_attachment(self):
  p=self.snapshot/"r2"/self.key
  p.unlink()
  with self.assertRaisesRegex(RuntimeError,"Missing"):
   RESTORE.validate_objects(self.snapshot/"r2",self.manifest)

 def test_reject_unsafe_r2_keys(self):
  for key in ("../other","/etc/shadow","x.meta.json","foo//bar","foo/../../secrets"):
   with self.subTest(key=key),self.assertRaises(ValueError):
    RESTORE.safe_key(self.root,key)

 def test_reject_snapshot_with_broken_database_reference(self):
  # A complete object manifest can still omit a DB-referenced R2 object.
  keys=set()
  if not shutil.which("sqlite3"):self.skipTest("sqlite3 CLI unavailable")
  restored=self.root/"raw.sqlite"
  with (self.snapshot/"d1.sql").open("rb") as data:
   subprocess.run(["sqlite3","-bail",str(restored)],stdin=data,check=True)
  with self.assertRaisesRegex(RuntimeError,"references R2 objects"):
   RESTORE.inspect_database(restored,keys)

 def test_node_wiring_matches_upstream_filesystem_and_sqlite(self):
  self.assertIn('process.env.RUNTIME==="node"',ENV)
  self.assertIn('require("./node-bindings")',ENV)
  self.assertIn("getStorage()",NODE)
  self.assertIn("@libsql/client",NODE)
  self.assertIn("SQLITE_DB_PATH",NODE)
  self.assertIn("last_row_id",NODE)
  self.assertIn("RUNTIME: node",COMPOSE)
  self.assertIn("finance-scheduler.mjs",DOCKERFILE)
  self.assertIn("entrypoint.sh",DOCKERFILE)
  self.assertIn("OA_DATA_DIR",COMPOSE)

if __name__=="__main__":
 unittest.main(verbosity=2)
