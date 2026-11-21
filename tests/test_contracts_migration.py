#!/usr/bin/env python3
"""Contract attachment migration: company scoping, approved-party type and foreign keys."""
import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
FINANCE=(ROOT/"overlay/migrations/9020_finance.sql").read_text(encoding="utf-8")
CONTRACTS=(ROOT/"overlay/migrations/9029_oa_contract_management.sql").read_text(encoding="utf-8")

class ContractMigrationTests(unittest.TestCase):
 def setUp(self):
  db=self.db=sqlite3.connect(":memory:")
  db.execute("PRAGMA foreign_keys=ON")
  db.executescript("""
   CREATE TABLE user(id TEXT PRIMARY KEY);
   CREATE TABLE oa_entity(id TEXT PRIMARY KEY);
   INSERT INTO user VALUES('admin');
   INSERT INTO oa_entity VALUES('a'),('b');
  """)
  db.executescript(FINANCE)
  db.executescript(CONTRACTS)
  db.execute("""INSERT INTO oa_finance_party(id,entity_id,root_id,party_type,company_name,status,created_by)
   VALUES('sp','a','supplier','supplier','Supplier','approved','admin')""")
  db.execute("""INSERT INTO oa_finance_party(id,entity_id,root_id,party_type,company_name,status,created_by)
   VALUES('cp','a','customer','customer','Customer','approved','admin')""")
  db.execute("""INSERT INTO oa_finance_party(id,entity_id,root_id,party_type,company_name,status,created_by)
   VALUES('bp','a','both','both','Both','approved','admin')""")
  db.execute("""INSERT INTO oa_finance_party(id,entity_id,root_id,party_type,company_name,status,created_by)
   VALUES('pending','a','pending','supplier','Pending','pending','admin')""")
  db.execute("""INSERT INTO oa_finance_party(id,entity_id,root_id,party_type,company_name,status,created_by)
   VALUES('other','b','foreign','supplier','Foreign','approved','admin')""")

 def tearDown(self):self.db.close()

 def insert(self,id="c1",entity="a",root="supplier",role="supplier",name="agreement.pdf",size=1024,start=None,end=None):
  return self.db.execute("""INSERT INTO oa_contract(
   id,entity_id,party_root_id,party_role,party_name_at_upload,title,
   effective_date,expiry_date,r2_key,original_name,content_type,size_bytes,uploaded_by
   ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
   (id,entity,root,role,"Supplier","Supply agreement",start,end,id+"/"+name,name,"application/pdf",size,"admin"))

 def test_approved_supplier_customer_and_both(self):
  self.insert()
  self.insert(id="c2",root="customer",role="customer")
  self.insert(id="c3",root="both",role="customer")
  self.insert(id="c4",root="both",role="supplier")
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM oa_contract").fetchone()[0],4)

 def test_reject_cross_entity_unapproved_wrong_type_or_missing_party(self):
  for case in [
   dict(id="cross",entity="b",root="supplier"),
   dict(id="foreign",root="foreign"),
   dict(id="pending",root="pending"),
   dict(id="wrong",root="customer",role="supplier"),
   dict(id="notfound",root="missing"),
  ]:
   with self.subTest(case=case),self.assertRaisesRegex(sqlite3.IntegrityError,"approved in the same Entity"):
    self.insert(**case)

 def test_update_guard_prevents_relink(self):
  self.insert()
  for sql in [
   "UPDATE oa_contract SET entity_id='b' WHERE id='c1'",
   "UPDATE oa_contract SET party_root_id='pending' WHERE id='c1'",
   "UPDATE oa_contract SET party_role='customer' WHERE id='c1'",
  ]:
   with self.subTest(sql=sql),self.assertRaises(sqlite3.IntegrityError):
    self.db.execute(sql)
  self.assertEqual(self.db.execute("SELECT entity_id,party_root_id,party_role FROM oa_contract").fetchone(),("a","supplier","supplier"))

 def test_file_constraints(self):
  for case in [dict(id="badzero",size=0),dict(id="big",size=12582913)]:
   with self.subTest(case=case),self.assertRaises(sqlite3.IntegrityError):
    self.insert(**case)
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("""INSERT INTO oa_contract(id,entity_id,party_root_id,party_role,party_name_at_upload,title,
    r2_key,original_name,content_type,size_bytes,uploaded_by)
    VALUES('x','a','supplier','supplier','Supplier','Agreement','bad','a.html','text/html',100,'admin')""")
  with self.assertRaises(sqlite3.IntegrityError):
   self.insert(id="dates",start="2026-12-02",end="2026-12-01")

 def test_party_name_snapshot_survives_version_change(self):
  self.insert()
  self.db.execute("UPDATE oa_finance_party SET status='superseded' WHERE id='sp'")
  self.db.execute("""INSERT INTO oa_finance_party(id,entity_id,root_id,party_type,company_name,status,created_by)
   VALUES('sp2','a','supplier','supplier','Supplier New Name','approved','admin')""")
  self.assertEqual(self.db.execute("SELECT party_name_at_upload FROM oa_contract WHERE id='c1'").fetchone()[0],"Supplier")
  self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(),[])

 def test_idempotent_migration(self):
  self.db.executescript(CONTRACTS)
  n=self.db.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'oa_contract_party_%'").fetchone()[0]
  self.assertEqual(n,2)

if __name__=="__main__":unittest.main(verbosity=2)
