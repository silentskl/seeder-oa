#!/usr/bin/env python3
"""Additive business-key invoice deduplication, company isolation and accounting tests."""
import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
BASE=(ROOT/"overlay/migrations/9020_finance.sql").read_text()
MIGRATION=(ROOT/"overlay/migrations/9026_finance_invoice_business_dedup.sql").read_text()
IMPORT=(ROOT/"overlay/lib/oa/finance.ts").read_text()
DETECT=(ROOT/"overlay/lib/oa/finance-duplicates.ts").read_text()
API=(ROOT/"overlay/app/api/oa/finance/route.ts").read_text()
UI=(ROOT/"overlay/components/oa/finance-console.tsx").read_text()

class BusinessInvoiceDedupTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(":memory:")
  self.db.execute("PRAGMA foreign_keys=ON")
  self.db.executescript("""
   CREATE TABLE user(id TEXT PRIMARY KEY);
   CREATE TABLE oa_entity(id TEXT PRIMARY KEY);
   INSERT INTO user VALUES('admin');
   INSERT INTO oa_entity VALUES('a'),('b');
  """)
  self.db.executescript(BASE)
  for i,entity in enumerate(("a","b")):
   for n in range(8):
    self.db.execute(
     "INSERT INTO oa_finance_document(id,entity_id,purpose,r2_key,original_name,content_type,size_bytes) VALUES(?,?,?,?,?,?,?)",
     (f"doc-{entity}-{n}",entity,"invoice",f"r2-{entity}-{n}","invoice.pdf","application/pdf",500))
  self.db.execute(
   "INSERT INTO oa_finance_party(id,entity_id,root_id,party_type,company_name,status,created_by) VALUES('p1','a','vendor-a','supplier','ABC Pte Ltd','approved','admin')")
  self.db.execute(
   "INSERT INTO oa_finance_party(id,entity_id,root_id,party_type,company_name,status,created_by) VALUES('p2','a','vendor-b','supplier','XYZ Pte Ltd','approved','admin')")
  self.insert_legacy("a","first","doc-a-0","vendor-a","INV-001","open","ABC Pte Ltd","2026-11-01",20000)
  self.insert_legacy("a","again","doc-a-1","vendor-a","inv/001","needs_review","ABC Pte Ltd","2026-11-02",30000)
  self.insert_legacy("a","other-vendor","doc-a-2","vendor-b","INV 001","needs_review","XYZ Pte Ltd","2026-11-02",20000)
  self.insert_legacy("b","other-company","doc-b-0",None,"INV 001","needs_review","ABC Pte Ltd","2026-11-02",20000)
  self.db.commit()
  self.db.executescript(MIGRATION)
 def insert_legacy(self,entity,id,doc,root,no,status,name,date,amount):
  self.db.execute(
   "INSERT INTO oa_finance_invoice(id,entity_id,direction,party_root_id,counterparty_name,invoice_number,invoice_date,currency,amount_minor,source,document_id,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
   (id,entity,"ap",root,name,no,date,"SGD",amount,"manual",doc,status))
 def test_legacy_number_normalization_and_warning(self):
  rows=self.db.execute(
   "SELECT id,invoice_number_key,duplicate_status,duplicate_of_invoice_id FROM oa_finance_invoice ORDER BY id").fetchall()
  by_id={row[0]:row[1:] for row in rows}
  self.assertEqual(by_id["first"],("inv001","none",None))
  self.assertEqual(by_id["again"],("inv001","possible","first"))
  self.assertEqual(self.db.execute("SELECT duplicate_reason FROM oa_finance_invoice WHERE id='again'").fetchone()[0],"amount_and_date_conflict")
  self.assertEqual(by_id["other-vendor"],("inv001","none",None))
  self.assertEqual(by_id["other-company"],("inv001","none",None))
  self.assertEqual(self.db.execute("SELECT status FROM oa_finance_invoice WHERE id='again'").fetchone()[0],"needs_review")
 def test_cross_company_duplicate_pointer_fails(self):
  with self.assertRaisesRegex(sqlite3.IntegrityError,"company mismatch"):
   self.db.execute("UPDATE oa_finance_invoice SET duplicate_of_invoice_id='other-company' WHERE id='again'")
  with self.assertRaisesRegex(sqlite3.IntegrityError,"company mismatch"):
   self.db.execute("UPDATE oa_finance_invoice SET duplicate_of_invoice_id='again' WHERE id='again'")
 def test_same_party_normalized_number_cannot_be_booked_twice(self):
  # Even if a human clears the warning, the database prevents two OPEN
  # invoices in the same company / direction / approved counterparty.
  self.db.execute("UPDATE oa_finance_invoice SET duplicate_status='dismissed' WHERE id='again'")
  with self.assertRaisesRegex(sqlite3.IntegrityError,"duplicate normalized"):
   self.db.execute("UPDATE oa_finance_invoice SET status='open' WHERE id='again'")
  self.assertEqual(self.db.execute("SELECT status FROM oa_finance_invoice WHERE id='again'").fetchone()[0],"needs_review")
 def test_different_issuer_and_company_remain_allowed(self):
  self.db.execute("UPDATE oa_finance_invoice SET status='open' WHERE id='other-vendor'")
  self.assertEqual(self.db.execute("SELECT status FROM oa_finance_invoice WHERE id='other-vendor'").fetchone()[0],"open")
 def test_new_invoice_with_same_business_key_cannot_be_inserted_as_open(self):
  with self.assertRaisesRegex(sqlite3.IntegrityError,"duplicate normalized"):
   self.db.execute(
    "INSERT INTO oa_finance_invoice(id,entity_id,direction,party_root_id,invoice_number,invoice_number_key,source,document_id,status) VALUES('fresh','a','ap','vendor-a','INV.001','inv001','manual','doc-a-3','open')")
 def test_late_email_invoices_stay_unbooked(self):
  self.db.execute(
   "INSERT INTO oa_finance_invoice(id,entity_id,direction,party_root_id,counterparty_name,invoice_number,invoice_number_key,counterparty_key,duplicate_of_invoice_id,duplicate_status,source,document_id) VALUES('late','a','ap','vendor-a','ABC Pte Ltd','INV 001','inv001','abcpteltd','first','possible','email','doc-a-4')")
  self.assertEqual(self.db.execute("SELECT status FROM oa_finance_invoice WHERE id='late'").fetchone()[0],"needs_review")
  outstanding=self.db.execute(
   "SELECT COALESCE(SUM(amount_minor),0) FROM oa_finance_invoice WHERE entity_id='a' AND status IN ('open','settlement_pending')").fetchone()[0]
  self.assertEqual(outstanding,20000)
 def test_dedup_source_invariants(self):
  self.assertIn("findBusinessInvoiceDuplicate(probe)",IMPORT)
  self.assertIn("invoice_number_key",IMPORT)
  self.assertIn("invoice_duplicate_confirm",API)
  self.assertIn("invoice_duplicate_dismiss",API)
  self.assertIn("duplicate_review_blocked",API)
  # The duplicate banner is language-aware, but the warning remains visible.
  self.assertIn('t("Possible duplicate invoice","疑似重复发票")',UI)
  self.assertIn("Confirm duplicate",UI)
  self.assertIn("Clear warning",UI)
  self.assertIn("amount_and_date_conflict",DETECT)
  self.assertIn("status<>'rejected'",DETECT)
  self.assertNotIn("DELETE FROM oa_finance_document",DETECT)
 def test_triggers_and_constraints_exist(self):
  triggers={r[0] for r in self.db.execute(
   "SELECT name FROM sqlite_master WHERE type='trigger'")}
  for name in ("oa_finance_duplicate_company_insert","oa_finance_duplicate_company_update",
    "oa_finance_business_duplicate_open_insert","oa_finance_business_duplicate_open_update"):
   self.assertIn(name,triggers)
  cols={r[1] for r in self.db.execute("PRAGMA table_info(oa_finance_invoice)")}
  for col in ("invoice_number_key","counterparty_key","duplicate_of_invoice_id","duplicate_status","duplicate_reason",
   "duplicate_decision_note","duplicate_decided_by","duplicate_decided_at"):
   self.assertIn(col,cols)
  self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(),[])

if __name__=="__main__":
 unittest.main(verbosity=2)
