#!/usr/bin/env python3
"""Independent per-company ModelBridge AI settings must not leak across entities."""
import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
SCHEMA=(ROOT/"overlay/migrations/9022_finance_ai_settings.sql").read_text()

class FinanceAiMigrationTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(":memory:")
  self.db.execute("PRAGMA foreign_keys=ON")
  self.db.executescript("""
  CREATE TABLE user(id TEXT PRIMARY KEY);
  CREATE TABLE oa_entity(id TEXT PRIMARY KEY);
  INSERT INTO user VALUES('admin1'),('admin2');
  INSERT INTO oa_entity VALUES('entity1'),('entity2');
  """)
  self.db.executescript(SCHEMA)
 def test_multiple_company_settings(self):
  self.db.execute("INSERT INTO oa_finance_ai_settings(entity_id,base_url,model_name,protocol,api_key_encrypted,updated_by) VALUES('entity1','https://one.example/v1','model-a','responses','v1.cipher1','admin1')")
  self.db.execute("INSERT INTO oa_finance_ai_settings(entity_id,base_url,model_name,protocol,api_key_encrypted,updated_by) VALUES('entity2','https://two.example/v1','model-b','chat_completions','v1.cipher2','admin2')")
  self.assertEqual(self.db.execute("SELECT count(*) FROM oa_finance_ai_settings").fetchone()[0],2)
  self.assertEqual(self.db.execute("SELECT model_name FROM oa_finance_ai_settings WHERE entity_id='entity1'").fetchone()[0],"model-a")
 def test_only_allowed_protocols(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("INSERT INTO oa_finance_ai_settings(entity_id,base_url,model_name,protocol,api_key_encrypted,updated_by) VALUES('entity1','https://one.example/v1','model','unknown','v1.cipher','admin1')")
 def test_only_valid_enabled_values(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("INSERT INTO oa_finance_ai_settings(entity_id,base_url,model_name,protocol,api_key_encrypted,enabled,updated_by) VALUES('entity1','https://one.example/v1','model','responses','v1.cipher',2,'admin1')")
 def test_duplicate_company_not_allowed(self):
  self.db.execute("INSERT INTO oa_finance_ai_settings(entity_id,base_url,model_name,api_key_encrypted,updated_by) VALUES('entity1','https://one.example/v1','model','v1.cipher','admin1')")
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("INSERT INTO oa_finance_ai_settings(entity_id,base_url,model_name,api_key_encrypted,updated_by) VALUES('entity1','https://one.example/v1','model','v1.cipher','admin1')")
 def test_missing_entity_denied(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("INSERT INTO oa_finance_ai_settings(entity_id,base_url,model_name,api_key_encrypted,updated_by) VALUES('unowned','https://one.example/v1','model','v1.cipher','admin1')")
if __name__=="__main__":unittest.main(verbosity=2)
