#!/usr/bin/env python3
"""Company isolation and safe ModelBridge diagnostics schema checks."""
import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
SQL=(ROOT/"overlay/migrations/9023_finance_ai_diagnostics.sql").read_text()

class FinanceAiDiagnosticsMigrationTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(":memory:")
  self.db.execute("PRAGMA foreign_keys=ON")
  self.db.executescript("""
  CREATE TABLE oa_entity(id TEXT PRIMARY KEY);
  CREATE TABLE oa_finance_invoice(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES oa_entity(id));
  INSERT INTO oa_entity VALUES('a'),('b');
  INSERT INTO oa_finance_invoice VALUES('inv-a','a'),('inv-b','b');
  """)
  self.db.executescript(SQL)
 def put(self,entity,invoice,id="log-1",operation="invoice",outcome="empty_output"):
  self.db.execute(
   "INSERT INTO oa_finance_ai_call_log(id,entity_id,invoice_id,model_name,protocol,operation,outcome,http_status,output_types,input_tokens,output_tokens) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
   (id,entity,invoice,"test-model","responses",operation,outcome,200,"reasoning",1144,800))
 def test_valid_diagnostics_and_no_secret_columns(self):
  self.put("a","inv-a")
  r=self.db.execute("SELECT output_tokens,output_types FROM oa_finance_ai_call_log WHERE id='log-1'").fetchone()
  self.assertEqual(r,(800,"reasoning"))
  names={row[1] for row in self.db.execute("PRAGMA table_info(oa_finance_ai_call_log)")}
  self.assertFalse(names.intersection({"api_key","api_key_encrypted","prompt","response_body","invoice_text"}))
 def test_cross_company_log_insert_rejected(self):
  with self.assertRaisesRegex(sqlite3.IntegrityError,"company mismatch"):
   self.put("b","inv-a")
 def test_cross_company_log_update_rejected(self):
  self.put("a","inv-a")
  with self.assertRaisesRegex(sqlite3.IntegrityError,"company mismatch"):
   self.db.execute("UPDATE oa_finance_ai_call_log SET entity_id='b' WHERE id='log-1'")
 def test_allowed_outcomes(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.put("a","inv-a",outcome="unknown")
 def test_test_connection_no_invoice(self):
  self.put("b",None,id="t",operation="test",outcome="success")
  self.assertEqual(self.db.execute("SELECT count(*) FROM oa_finance_ai_call_log").fetchone()[0],1)

if __name__=="__main__":
 unittest.main(verbosity=2)
