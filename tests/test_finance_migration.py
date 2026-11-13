#!/usr/bin/env python3
"""Financial data constraints: versioned bank details, duplicate invoices and tenant guards."""
import pathlib
import sqlite3
import unittest
SQL=(pathlib.Path(__file__).resolve().parents[1]/"overlay/migrations/9020_finance.sql").read_text()
class FinanceMigrationTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(":memory:")
  self.db.execute("PRAGMA foreign_keys=ON")
  self.db.executescript("""
    CREATE TABLE user(id TEXT PRIMARY KEY);
    CREATE TABLE oa_entity(id TEXT PRIMARY KEY);
    INSERT INTO user VALUES('u1'),('u2');
    INSERT INTO oa_entity VALUES('one'),('two');
  """)
  self.db.executescript(SQL)
  self.db.execute("INSERT INTO oa_finance_party(id,entity_id,root_id,party_type,company_name,status,created_by,bank_account) VALUES('p1','one','root','supplier','Supplier A','approved','u1','123456')")
  self.db.execute("INSERT INTO oa_finance_document(id,entity_id,purpose,r2_key,original_name,content_type,size_bytes) VALUES('file1','one','invoice','f1','invoice.pdf','application/pdf',200)")
  self.db.execute("INSERT INTO oa_finance_document(id,entity_id,purpose,r2_key,original_name,content_type,size_bytes) VALUES('file2','one','settlement','f2','proof.pdf','application/pdf',100)")
  self.db.execute("INSERT INTO oa_finance_invoice(id,entity_id,direction,party_root_id,invoice_number,currency,amount_minor,source,document_id,status) VALUES('invoice1','one','ap','root','INV-1','SGD',10000,'manual','file1','open')")
 def test_idempotence(self):
  self.db.executescript(SQL)
  self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(),[])
 def test_party_versions(self):
  self.db.execute("INSERT INTO oa_finance_party(id,entity_id,root_id,party_type,company_name,status,created_by,bank_account) VALUES('p2','one','root','supplier','Supplier A','pending','u2','99999')")
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("INSERT INTO oa_finance_party(id,entity_id,root_id,party_type,company_name,status,created_by) VALUES('p3','one','root','supplier','Supplier A','pending','u2')")
  self.assertEqual(self.db.execute("SELECT bank_account FROM oa_finance_party WHERE status='approved'").fetchone()[0],"123456")
  self.db.execute("UPDATE oa_finance_party SET status='superseded' WHERE id='p1'")
  self.db.execute("UPDATE oa_finance_party SET status='approved' WHERE id='p2'")
  self.assertEqual(self.db.execute("SELECT bank_account FROM oa_finance_party WHERE status='approved'").fetchone()[0],"99999")
 def test_bad_cross_company_links(self):
  with self.assertRaisesRegex(sqlite3.IntegrityError,"company mismatch"):
   self.db.execute("INSERT INTO oa_finance_invoice(id,entity_id,direction,source,document_id) VALUES('bad','two','ap','manual','file1')")
  with self.assertRaisesRegex(sqlite3.IntegrityError,"company mismatch"):
   self.db.execute("INSERT INTO oa_finance_settlement(id,entity_id,invoice_id,document_id,submitted_by) VALUES('bad2','two','invoice1','file2','u1')")
  with self.assertRaisesRegex(sqlite3.IntegrityError,"company mismatch"):
   self.db.execute("INSERT INTO oa_finance_settlement(id,entity_id,invoice_id,document_id,submitted_by) VALUES('bad3','one','invoice1','file1','u1')")
 def test_duplicate_active_invoice_and_pending_proof(self):
  self.db.execute("INSERT INTO oa_finance_document(id,entity_id,purpose,r2_key,original_name,content_type,size_bytes) VALUES('file3','one','invoice','f3','second.pdf','application/pdf',80)")
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("INSERT INTO oa_finance_invoice(id,entity_id,direction,party_root_id,invoice_number,source,document_id,status) VALUES('duplicate','one','ap','root','INV-1','manual','file3','open')")
  self.db.execute("INSERT INTO oa_finance_settlement(id,entity_id,invoice_id,document_id,submitted_by) VALUES('settle1','one','invoice1','file2','u1')")
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("INSERT INTO oa_finance_settlement(id,entity_id,invoice_id,document_id,submitted_by) VALUES('settle2','one','invoice1','file2','u2')")
 def test_status_and_amount_guards(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("UPDATE oa_finance_invoice SET status='unpaid' WHERE id='invoice1'")
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("UPDATE oa_finance_invoice SET amount_minor=-1 WHERE id='invoice1'")
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("UPDATE oa_finance_document SET size_bytes=0 WHERE id='file1'")
if __name__=="__main__":unittest.main(verbosity=2)
