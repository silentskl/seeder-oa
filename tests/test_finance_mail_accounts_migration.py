#!/usr/bin/env python3
"""Finance mailbox migration: isolation, multiple providers and source validation."""
import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
SQL20=(ROOT/"overlay/migrations/9020_finance.sql").read_text()
SQL21=(ROOT/"overlay/migrations/9021_finance_mail_accounts.sql").read_text()

class MailboxMigrationTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(":memory:")
  self.db.execute("PRAGMA foreign_keys=ON")
  self.db.executescript("""
   CREATE TABLE user(id TEXT PRIMARY KEY);
   CREATE TABLE oa_entity(id TEXT PRIMARY KEY);
   INSERT INTO user VALUES('admin1'),('admin2');
   INSERT INTO oa_entity VALUES('company1'),('company2');
  """)
  self.db.executescript(SQL20)
  self.db.executescript(SQL21)
 def add(self,id,company,address,provider):
  self.db.execute("""INSERT INTO oa_finance_mail_account
   (id,entity_id,address,provider,tenant_id,client_id,client_secret_encrypted,created_by,updated_by)
   VALUES(?,?,?,?,?,'test_client','v1.encrypted','admin1','admin1')""",
   (id,company,address,provider,"00000000-0000-0000-0000-000000000001" if provider=="microsoft365" else ""))
 def test_both_companies_and_providers(self):
  self.add("m1","company1","payable@one.example","microsoft365")
  self.add("a1","company2","payable@two.example","alibaba_mail")
  self.add("a2","company1","invoices@one.example","alibaba_mail")
  self.assertEqual(self.db.execute("SELECT count(*) FROM oa_finance_mail_account").fetchone()[0],3)
  self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(),[])
 def test_mailbox_address_cannot_cross_company(self):
  self.add("m1","company1","payable@one.example","microsoft365")
  with self.assertRaises(sqlite3.IntegrityError):
   self.add("m2","company2","payable@one.example","alibaba_mail")
 def test_cross_company_mail_sync_log_rejected(self):
  self.add("m1","company1","payable@one.example","microsoft365")
  with self.assertRaisesRegex(sqlite3.IntegrityError,"company mismatch"):
   self.db.execute("INSERT INTO oa_finance_mail_sync_log(id,entity_id,account_id,status) VALUES('log','company2','m1','running')")
 def test_invoice_mailbox_company_guards(self):
  self.add("m1","company1","payable@one.example","microsoft365")
  self.db.execute("INSERT INTO oa_finance_document(id,entity_id,purpose,r2_key,original_name,content_type,size_bytes) VALUES('d2','company2','invoice','r2','a.pdf','application/pdf',100)")
  with self.assertRaisesRegex(sqlite3.IntegrityError,"company mismatch"):
   self.db.execute("""INSERT INTO oa_finance_invoice(id,entity_id,source,document_id,source_mail_account_id)
    VALUES('inv','company2','email','d2','m1')""")
 def test_mailbox_validations(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.add("bad","company1","bad@example.com","other")
  self.add("m1","company1","payable@one.example","microsoft365")
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("UPDATE oa_finance_mail_account SET sync_interval_minutes=0 WHERE id='m1'")
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("UPDATE oa_finance_mail_account SET initial_lookback_days=90 WHERE id='m1'")
if __name__=="__main__":unittest.main(verbosity=2)
