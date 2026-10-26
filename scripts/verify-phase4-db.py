#!/usr/bin/env python3
"""Offline, read-only source D1 SQL export verifier. Never changes production.
Usage: python3 scripts/verify-phase4-db.py recovery-backups/.../smarten-oa.sql
Requires a snapshot that already contains migrations 9010-9016.
"""
import argparse
import pathlib
import sqlite3
import sys

EXPECTED = {
    "oa_employee": "entity_id",
    "oa_leave_request": "entity_id",
    "oa_expense_claim": "entity_id",
    "oa_expense_item": "entity_id",
    "oa_approval_step": "company_entity_id",
    "oa_payslip": "entity_id",
    "oa_file": "entity_id",
    "oa_audit_log": "company_entity_id",
    "oa_email_log": "company_entity_id",
}
SCOPE_TABLES = (
    "oa_entity", "oa_entity_member", "oa_entity_employee", "oa_entity_settings",
    "oa_entity_expense_category", "oa_entity_holiday", "oa_entity_leave_type",
)

def validate(db):
    errors = []
    for table in SCOPE_TABLES:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
            errors.append(f"Missing company table: {table}")
    for table, column in EXPECTED.items():
        fields = [row[1] for row in db.execute(f"PRAGMA table_info({table})")]
        if column not in fields:
            errors.append(f"{table}.{column} missing")
    if errors:
        return errors
    legacy_count = db.execute("SELECT COUNT(*) FROM oa_entity WHERE id='legacy-primary'").fetchone()[0]
    if legacy_count != 1:
        errors.append("Exactly one legacy-primary entity required")
    for table,column in EXPECTED.items():
        missing = db.execute(f"SELECT COUNT(*) FROM {table} WHERE {column} IS NULL OR {column}=''").fetchone()[0]
        unknown = db.execute(f"""SELECT COUNT(*) FROM {table} t WHERE NOT EXISTS
            (SELECT 1 FROM oa_entity e WHERE e.id=t.{column})""").fetchone()[0]
        print(f"{table}: rows={db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0]}, missing_owner={missing}, unknown_owner={unknown}")
        if missing or unknown:
            errors.append(f"{table}: unowned/unknown company rows")
    employee_missing = db.execute("""
        SELECT COUNT(*) FROM oa_employee e
        LEFT JOIN oa_entity_employee p ON p.entity_id=e.entity_id AND p.user_id=e.user_id
        LEFT JOIN oa_entity_member m ON m.entity_id=e.entity_id AND m.user_id=e.user_id AND m.active=1
        WHERE e.entity_id='legacy-primary' AND (p.user_id IS NULL OR m.user_id IS NULL)
    """).fetchone()[0]
    print(f"Legacy employee missing profile/membership: {employee_missing}")
    if employee_missing: errors.append("Legacy profile/membership backfill incomplete")
    for table in ("oa_entity_employee","oa_entity_settings","oa_entity_leave_type","oa_entity_expense_category"):
        q=f"SELECT COUNT(*) FROM {table} x WHERE NOT EXISTS (SELECT 1 FROM oa_entity e WHERE e.id=x.entity_id)"
        n=db.execute(q).fetchone()[0]
        if n: errors.append(f"{table}: {n} unknown entity owners")
    extra_admins = db.execute("""
        SELECT COUNT(*) FROM oa_entity e WHERE e.active=1 AND NOT EXISTS
        (SELECT 1 FROM oa_entity_member m WHERE m.entity_id=e.id AND m.role='admin' AND m.active=1)
    """).fetchone()[0]
    if extra_admins: errors.append(f"{extra_admins} active entities without an active admin")
    mismatched_items=db.execute("""
        SELECT COUNT(*) FROM oa_expense_item i JOIN oa_expense_claim c ON c.id=i.claim_id
        WHERE i.entity_id<>c.entity_id
    """).fetchone()[0]
    if mismatched_items: errors.append(f"{mismatched_items} expense items owned by the wrong company")
    # Historic cross-company relationships must be checked even if an earlier
    # migration added the owner columns without composite foreign keys.
    relationships = {
      "expense document": """SELECT COUNT(*) FROM oa_expense_item_document d
        LEFT JOIN oa_expense_item i ON i.id=d.item_id
        LEFT JOIN oa_file f ON f.id=d.file_id
        WHERE i.id IS NULL OR f.id IS NULL OR i.entity_id<>f.entity_id""",
      "claim receipt": """SELECT COUNT(*) FROM oa_expense_claim c
        LEFT JOIN oa_file f ON f.id=c.receipt_file_id
        WHERE c.receipt_file_id IS NOT NULL AND
          (f.id IS NULL OR c.entity_id<>f.entity_id)""",
      "leave attachment": """SELECT COUNT(*) FROM oa_leave_request l
        LEFT JOIN oa_file f ON f.id=l.attachment_file_id
        WHERE l.attachment_file_id IS NOT NULL AND
          (f.id IS NULL OR l.entity_id<>f.entity_id)""",
      "payslip attachment": """SELECT COUNT(*) FROM oa_payslip p
        LEFT JOIN oa_file f ON f.id=p.attachment_file_id
        WHERE p.attachment_file_id IS NOT NULL AND
          (f.id IS NULL OR p.entity_id<>f.entity_id)""",
      "approval workflow": """SELECT COUNT(*) FROM oa_approval_step a
        LEFT JOIN oa_leave_request l ON l.id=a.entity_id AND a.entity_type='leave'
        LEFT JOIN oa_expense_claim c ON c.id=a.entity_id AND a.entity_type='expense'
        WHERE (a.entity_type='leave' AND (l.id IS NULL OR l.entity_id<>a.company_entity_id))
           OR (a.entity_type='expense' AND (c.id IS NULL OR c.entity_id<>a.company_entity_id))
           OR a.entity_type NOT IN ('leave','expense')""",
    }
    for label, query in relationships.items():
        n=db.execute(query).fetchone()[0]
        print(f"{label} cross-company/orphan associations: {n}")
        if n: errors.append(f"{label}: {n} invalid cross-company associations")
    guards = (
        "oa_entity_keep_last_admin_update","oa_entity_keep_last_admin_delete",
        "oa_claim_item_company_insert","oa_claim_item_company_update",
        "oa_expense_document_company_insert","oa_expense_document_company_update",
        "oa_leave_attachment_company_insert","oa_leave_attachment_company_update",
        "oa_claim_receipt_company_insert","oa_claim_receipt_company_update",
        "oa_payslip_attachment_company_insert","oa_payslip_attachment_company_update",
        "oa_approval_company_insert","oa_approval_company_update",
    )
    found=db.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ("+
        ",".join("?" for _ in guards)+")",guards).fetchone()[0]
    if found!=len(guards):errors.append(f"Entity DB guard triggers incomplete: {found}/{len(guards)}")
    # SQLite FK check works only for constraints already declared in migrations;
    # many legacy ownership columns were added without FK, so checks above matter.
    fk=list(db.execute("PRAGMA foreign_key_check"))
    if fk: errors.append(f"{len(fk)} foreign-key violations")
    for trigger in ("oa_medical_allowance_insert","oa_medical_allowance_update"):
        row=db.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?",(trigger,)).fetchone()
        if not row or "entity_id" not in row[0]:
            errors.append(f"{trigger} missing or not entity-aware")
    return errors

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("sql_export",type=pathlib.Path)
    args=p.parse_args()
    if not args.sql_export.is_file():p.error("SQL export not found")
    db=sqlite3.connect(":memory:")
    try:
        db.executescript(args.sql_export.read_text(encoding="utf-8"))
        errors=validate(db)
    except sqlite3.Error as exc:
        print(f"FAIL: SQLite export or validation error: {exc}",file=sys.stderr)
        return 1
    finally: db.close()
    for error in errors:print("FAIL:",error,file=sys.stderr)
    if errors:return 1
    print("PASS: Phase 4 offline D1 ownership/legacy integrity checks.")
    return 0
if __name__=="__main__":sys.exit(main())
