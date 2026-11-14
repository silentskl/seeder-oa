#!/usr/bin/env python3
"""Synthetic offline tests: Cloudflare SQL/R2 snapshot -> Ubuntu SQLite and files."""
import importlib.util
import json
import pathlib
import tempfile
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
MIG=ROOT/"deploy/ubuntu/migrate.py"
spec=importlib.util.spec_from_file_location("ubuntu_migrator",MIG)
migrator=importlib.util.module_from_spec(spec)
spec.loader.exec_module(migrator)

class UbuntuMigrationTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory()
  self.addCleanup(self.tmp.cleanup)
  self.root=pathlib.Path(self.tmp.name)
  self.stage=self.root/"stage";(self.stage/"uploads"/"oa"/"company-a"/"finance").mkdir(parents=True)
  self.key="oa/company-a/finance/invoice.pdf"
  (self.stage/"uploads"/self.key).write_bytes(b"%PDF-1.4\nexample\n")
  (self.stage/"r2-objects.json").write_text(json.dumps({
   "IsTruncated":False,"Contents":[{"Key":self.key,"Size":17}]
  }))
  (self.stage/"database.sql").write_text("""
   PRAGMA foreign_keys=OFF;
   BEGIN TRANSACTION;
   CREATE TABLE user(id TEXT PRIMARY KEY);
   CREATE TABLE oa_entity(id TEXT PRIMARY KEY);
   CREATE TABLE oa_finance_invoice(id TEXT PRIMARY KEY,entity_id TEXT);
   CREATE TABLE oa_finance_document(id TEXT PRIMARY KEY,entity_id TEXT,r2_key TEXT);
   CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT UNIQUE);
   INSERT INTO user VALUES('user-a');
   INSERT INTO oa_entity VALUES('company-a');
   INSERT INTO oa_finance_invoice VALUES('invoice-a','company-a');
   INSERT INTO oa_finance_document VALUES('document-a','company-a','oa/company-a/finance/invoice.pdf');
   INSERT INTO d1_migrations VALUES(1,'0001_initial.sql');
   COMMIT;
  """)
  # correct expected size from the exact bytes
  data=json.loads((self.stage/"r2-objects.json").read_text())
  data["Contents"][0]["Size"]=(self.stage/"uploads"/self.key).stat().st_size
  (self.stage/"r2-objects.json").write_text(json.dumps(data))
 def test_full_restore_and_verify(self):
  data_dir=self.root/"ubuntu-data"
  migrator.restore(self.stage,data_dir)
  self.assertTrue((data_dir/"seeder.db").is_file())
  self.assertEqual((data_dir/"uploads"/self.key).read_bytes(),b"%PDF-1.4\nexample\n")
  meta=json.loads((data_dir/"uploads"/(self.key+".meta.json")).read_text())
  self.assertEqual(meta["contentType"],"application/pdf")
  migrator.verify(data_dir)
  with self.assertRaisesRegex(RuntimeError,"Refusing overwrite"):
   migrator.restore(self.stage,data_dir)
 def test_manifest_rejects_path_traversal(self):
  f=self.stage/"r2-objects.json"
  raw=json.loads(f.read_text());raw["Contents"][0]["Key"]="../outside"
  f.write_text(json.dumps(raw))
  with self.assertRaisesRegex(RuntimeError,"Unsafe R2"):
   migrator.objects(self.stage)
 def test_missing_r2_is_fatal(self):
  (self.stage/"uploads"/self.key).unlink()
  with self.assertRaisesRegex(RuntimeError,"Missing/wrong-sized"):
   migrator.validate_files(self.stage)
 def test_missing_invoice_file_refuses_db_import(self):
  sql=self.stage/"database.sql"
  sql.write_text(sql.read_text().replace("oa/company-a/finance/invoice.pdf","oa/company-a/finance/missing.pdf"))
  with self.assertRaisesRegex(RuntimeError,"Missing finance"):
   migrator.restore(self.stage,self.root/"bad-data")
  self.assertFalse((self.root/"bad-data"/"seeder.db").exists())
 def test_production_secrets_remain_explicit(self):
  env=(ROOT/"deploy/ubuntu/.env.example").read_text()
  for name in ("BETTER_AUTH_SECRET","VCS_ENCRYPTION_KEY","OA_SETTINGS_MASTER_KEY","OA_FINANCE_SYNC_TOKEN"):
   self.assertIn(name+"=",env)
  self.assertIn("RUNTIME=node",(ROOT/"deploy/ubuntu/docker-compose.yml").read_text().replace("RUNTIME: node","RUNTIME=node"))
  node=(ROOT/"overlay/lib/oa/env.ts").read_text()
  self.assertIn('process.env.RUNTIME === "node"',node)
  self.assertIn('require("./node-adapters")',node)
  adapter=(ROOT/"overlay/lib/oa/node-adapters.ts").read_text()
  self.assertIn("nodeOaDb",adapter)
  self.assertIn("nodeOaUploads",adapter)
  self.assertIn("getStorage()",adapter)
  start=(ROOT/"deploy/ubuntu/start.sh").read_text()
  self.assertIn("chown -R seeder:seeder /app/data",start)
  self.assertIn("docker compose",start)

if __name__=="__main__":
 unittest.main(verbosity=2)
