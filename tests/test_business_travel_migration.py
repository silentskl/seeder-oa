#!/usr/bin/env python3
"""Run migration 9019 in SQLite and verify entity-owned travel budgets."""
import pathlib
import sqlite3
import unittest

SQL = (pathlib.Path(__file__).resolve().parents[1] / "overlay/migrations/9019_business_travel.sql").read_text()

class TravelMigrationTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript("""
          CREATE TABLE user(id TEXT PRIMARY KEY);
          CREATE TABLE oa_entity(id TEXT PRIMARY KEY);
          INSERT INTO user VALUES('employee'),('approver');
          INSERT INTO oa_entity VALUES('one'),('two');
        """)
        self.db.executescript(SQL)
        self.db.execute("""INSERT INTO oa_travel_application
          (id,entity_id,user_id,destination,purpose,currency,total_amount_minor)
          VALUES ('trip','one','employee','Tokyo','Client visit','SGD',120000)""")

    def test_idempotence_and_budget_items(self):
        self.db.executescript(SQL)
        self.db.execute("""INSERT INTO oa_travel_budget_item
          (id,entity_id,application_id,sort_order,type,item_name,description,departure_at,arrival_at,amount_minor)
          VALUES ('flight','one','trip',0,'flight','SQ12','Outbound','2026-11-10T08:00','2026-11-10T16:00',60000)""")
        self.db.execute("""INSERT INTO oa_travel_budget_item
          (id,entity_id,application_id,sort_order,type,item_name,check_in_at,check_out_at,nights,amount_minor)
          VALUES ('hotel','one','trip',1,'hotel','Test hotel','2026-11-10T15:00','2026-11-13T11:00',3,60000)""")
        self.assertEqual(self.db.execute("SELECT SUM(amount_minor) FROM oa_travel_budget_item").fetchone()[0],120000)
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(),[])

    def test_cross_entity_budget_rejected(self):
        with self.assertRaisesRegex(sqlite3.IntegrityError, "entity: travel item mismatch"):
            self.db.execute("""INSERT INTO oa_travel_budget_item
              (id,entity_id,application_id,sort_order,type,item_name,amount_minor)
              VALUES ('cross','two','trip',0,'other','Taxi',500)""")

    def test_cross_entity_approval_rejected(self):
        with self.assertRaisesRegex(sqlite3.IntegrityError, "entity: travel step mismatch"):
            self.db.execute("""INSERT INTO oa_travel_approval_step
              (id,entity_id,application_id,step_no,approver_type,status)
              VALUES ('step','two','trip',1,'admin','pending')""")

    def test_budget_and_status_constraints(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO oa_travel_budget_item
              (id,entity_id,application_id,sort_order,type,item_name,amount_minor)
              VALUES ('zero','one','trip',0,'hotel','Hotel',0)""")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE oa_travel_application SET status='paid' WHERE id='trip'")

if __name__ == "__main__":
    unittest.main(verbosity=2)
