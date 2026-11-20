#!/usr/bin/env python3
"""SQLite authorization schema regression tests, run before deployment."""
import pathlib
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "overlay/migrations/9028_oa_administrator_permissions.sql"

def database():
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript("""
        CREATE TABLE user (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
          role TEXT NOT NULL
        );
        CREATE TABLE oa_entity (id TEXT PRIMARY KEY, active INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE oa_entity_member (
          entity_id TEXT NOT NULL REFERENCES oa_entity(id),
          user_id TEXT NOT NULL REFERENCES user(id),
          role TEXT NOT NULL CHECK(role IN ('admin','manager','employee')),
          active INTEGER NOT NULL DEFAULT 1,
          PRIMARY KEY(entity_id,user_id)
        );
        INSERT INTO user VALUES('vcs-bot','Git bot','git-integration@seeder.local','owner');
        INSERT INTO user VALUES('founder','First Owner','owner@example.test','owner');
        INSERT INTO user VALUES('delegate','Delegate','delegate@example.test','user');
        INSERT INTO oa_entity(id) VALUES('legacy-primary'),('company-b');
        INSERT INTO oa_entity_member(entity_id,user_id,role) VALUES
          ('legacy-primary','founder','admin'),
          ('legacy-primary','delegate','employee');
    """)
    db.executescript(MIGRATION.read_text(encoding="utf-8"))
    return db

class PermissionsMigrationTests(unittest.TestCase):
    def setUp(self):
        self.db = database()

    def tearDown(self):
        self.db.close()

    def test_original_owner_is_unique_and_not_sentinel(self):
        owners = self.db.execute(
            "SELECT user_id,level FROM oa_platform_administrator"
        ).fetchall()
        self.assertEqual(owners, [("founder","founder")])
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO oa_platform_administrator(user_id,level) VALUES('delegate','founder')"
            )

    def test_original_super_admin_cannot_be_demoted_deleted_or_renamed(self):
        attempts = [
            ("UPDATE oa_platform_administrator SET level='super_admin' WHERE user_id='founder'", ()),
            ("DELETE FROM oa_platform_administrator WHERE user_id='founder'", ()),
            ("UPDATE user SET name='Hijacked' WHERE id='founder'", ()),
            ("UPDATE user SET email='stolen@example.test' WHERE id='founder'", ()),
            ("UPDATE user SET role='user' WHERE id='founder'", ()),
            ("DELETE FROM user WHERE id='founder'", ()),
            ("UPDATE oa_entity_member SET role='employee' WHERE user_id='founder'", ()),
            ("DELETE FROM oa_entity_member WHERE user_id='founder'", ()),
        ]
        for sql,params in attempts:
            with self.subTest(sql=sql),self.assertRaises(sqlite3.DatabaseError):
                self.db.execute(sql,params)
        self.assertEqual(
            self.db.execute("SELECT name,email,role FROM user WHERE id='founder'").fetchone(),
            ("First Owner","owner@example.test","owner"),
        )

    def test_delegated_super_admin_can_be_promoted_then_revoked(self):
        self.db.execute(
            "INSERT INTO oa_platform_administrator(user_id,level,granted_by) VALUES('delegate','super_admin','founder')"
        )
        self.assertEqual(
            self.db.execute("SELECT level FROM oa_platform_administrator WHERE user_id='delegate'").fetchone()[0],
            "super_admin",
        )
        self.db.execute("DELETE FROM oa_platform_administrator WHERE user_id='delegate'")
        self.assertIsNone(
            self.db.execute("SELECT level FROM oa_platform_administrator WHERE user_id='delegate'").fetchone()
        )

    def test_entity_permission_has_no_cross_entity_or_full_finance_grant(self):
        self.db.execute(
            "INSERT INTO oa_entity_permission(entity_id,user_id,permission,granted_by) VALUES(?,?,?,?)",
            ("legacy-primary","delegate","finance.parties.manage","founder"),
        )
        self.assertEqual(
            self.db.execute("SELECT entity_id FROM oa_entity_permission WHERE user_id='delegate'").fetchall(),
            [("legacy-primary",)],
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO oa_entity_permission(entity_id,user_id,permission,granted_by) VALUES(?,?,?,?)",
                ("company-b","delegate","finance.invoices.approve","founder"),
            )

if __name__ == "__main__":
    unittest.main()
