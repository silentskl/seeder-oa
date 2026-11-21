#!/usr/bin/env python3
"""Contract permissions must be explicitly granted by a super administrator."""
import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
SQL=(ROOT/"overlay/migrations/9030_oa_contract_permissions.sql").read_text(encoding="utf-8")

def make_db():
 db=sqlite3.connect(":memory:")
 db.execute("PRAGMA foreign_keys=ON")
 db.executescript("""
 CREATE TABLE user(id TEXT PRIMARY KEY);
 CREATE TABLE oa_entity(id TEXT PRIMARY KEY);
 CREATE TABLE oa_platform_administrator(
  user_id TEXT PRIMARY KEY REFERENCES user(id),
  level TEXT NOT NULL CHECK(level IN ('founder','super_admin')));
 INSERT INTO user VALUES('founder'),('super'),('admin'),('employee');
 INSERT INTO oa_entity VALUES('company-a'),('company-b');
 INSERT INTO oa_platform_administrator VALUES('founder','founder'),('super','super_admin');
 """)
 db.executescript(SQL)
 return db

class ContractGrants(unittest.TestCase):
 def setUp(self):self.db=make_db()
 def tearDown(self):self.db.close()
 def grant(self, entity="company-a",user="employee",perm="contracts.view",grantor="founder"):
  self.db.execute(
   "INSERT INTO oa_contract_permission(entity_id,user_id,permission,granted_by) VALUES(?,?,?,?)",
   (entity,user,perm,grantor))
 def test_explicit_view_only_and_upload_only(self):
  self.grant()
  self.assertEqual(self.db.execute(
   "SELECT permission FROM oa_contract_permission WHERE user_id='employee'").fetchall(),
   [("contracts.view",)])
  self.grant(perm="contracts.upload")
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM oa_contract_permission").fetchone()[0],2)
 def test_grants_are_scoped_per_entity_and_revocable(self):
  self.grant()
  self.assertEqual(self.db.execute(
   "SELECT COUNT(*) FROM oa_contract_permission WHERE entity_id='company-b'").fetchone()[0],0)
  self.db.execute(
   "DELETE FROM oa_contract_permission WHERE entity_id=? AND user_id=? AND permission=?",
   ("company-a","employee","contracts.view"))
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM oa_contract_permission").fetchone()[0],0)
 def test_only_superadmin_may_grant(self):
  with self.assertRaisesRegex(sqlite3.IntegrityError,"super administrator"):
   self.grant(grantor="admin")
  self.grant()
  with self.assertRaisesRegex(sqlite3.IntegrityError,"super administrator"):
   self.db.execute(
    "UPDATE oa_contract_permission SET granted_by='employee' WHERE user_id='employee'")
  self.assertEqual(self.db.execute(
   "SELECT granted_by FROM oa_contract_permission").fetchone()[0],"founder")
  self.grant(entity="company-b",user="admin",perm="contracts.upload",grantor="super")
 def test_other_grants_do_not_imply_contract_access(self):
  # A company admin and ordinary party editor are not contract grantees by default.
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM oa_contract_permission").fetchone()[0],0)
 def test_invalid_privilege_and_duplicate_rejected(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.grant(perm="finance.parties.manage")
  self.grant()
  with self.assertRaises(sqlite3.IntegrityError):
   self.grant()
 def test_idempotent_migration(self):
  self.db.executescript(SQL)
  self.assertEqual(self.db.execute(
   "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'oa_contract_grant_super_%'").fetchone()[0],2)

if __name__=="__main__":unittest.main(verbosity=2)
