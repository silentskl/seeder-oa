#!/usr/bin/env python3
import pathlib,sqlite3,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
SQL=(ROOT/"overlay/migrations/9032_oa_billing_permissions.sql").read_text()
class BillingACL(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(":memory:")
  self.db.execute("PRAGMA foreign_keys=ON")
  self.db.executescript("""
  CREATE TABLE user(id TEXT PRIMARY KEY);
  CREATE TABLE oa_entity(id TEXT PRIMARY KEY,active INTEGER);
  CREATE TABLE oa_entity_member(entity_id TEXT,user_id TEXT,active INTEGER,role TEXT);
  CREATE TABLE oa_platform_administrator(user_id TEXT PRIMARY KEY);
  INSERT INTO user VALUES('super'),('admin'),('employee');
  INSERT INTO oa_entity VALUES('a',1),('b',1);
  INSERT INTO oa_platform_administrator VALUES('super');
  INSERT INTO oa_entity_member VALUES('a','admin',1,'admin'),('a','employee',1,'employee'),('b','employee',0,'employee');
  """)
  self.db.executescript(SQL)
 def tearDown(self):self.db.close()
 def grant(self,entity="a",user="employee",by="super",permission="finance.billing.manage"):
  self.db.execute("INSERT INTO oa_billing_permission(entity_id,user_id,permission,granted_by) VALUES(?,?,?,?)",(entity,user,permission,by))
 def test_admin_has_no_default_grant(self):
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM oa_billing_permission").fetchone()[0],0)
 def test_entity_and_revoke(self):
  self.grant()
  self.assertEqual(self.db.execute("SELECT entity_id,user_id FROM oa_billing_permission").fetchall(),[("a","employee")])
  self.db.execute("DELETE FROM oa_billing_permission WHERE entity_id='a' AND user_id='employee'")
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM oa_billing_permission").fetchone()[0],0)
 def test_non_super_and_inactive_membership_denied(self):
  with self.assertRaises(sqlite3.IntegrityError):self.grant(by="admin")
  with self.assertRaises(sqlite3.IntegrityError):self.grant(entity="b")
  with self.assertRaises(sqlite3.IntegrityError):self.grant(permission="contracts.view")
 def test_update_and_idempotent(self):
  self.grant()
  with self.assertRaises(sqlite3.IntegrityError):self.db.execute("UPDATE oa_billing_permission SET granted_by='admin'")
  with self.assertRaises(sqlite3.IntegrityError):self.db.execute("UPDATE oa_billing_permission SET entity_id='b'")
  self.db.executescript(SQL)
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM oa_billing_permission").fetchone()[0],1)
 def test_sensitive_routes_use_billing_gate(self):
  for route in ["route.ts","documents/route.ts","documents/[id]/route.ts","ai-settings/route.ts","mail-accounts/route.ts","mail-backfill/route.ts"]:
   self.assertIn("await canManageBilling(",(ROOT/"overlay/app/api/oa/finance"/route).read_text(),route)
if __name__=="__main__":unittest.main(verbosity=2)
