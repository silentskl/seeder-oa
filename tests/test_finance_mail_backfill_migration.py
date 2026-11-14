#!/usr/bin/env python3
"""Additive D1 mailbox history backfill schema and access isolation regressions."""
import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
SQL=(ROOT/"overlay/migrations/9025_finance_mail_backfill.sql").read_text()
HISTORY=(ROOT/"overlay/lib/oa/finance-mail-backfill.ts").read_text()
SYNC=(ROOT/"overlay/lib/oa/finance-mail-sync.ts").read_text()
FINANCE=(ROOT/"overlay/app/api/oa/finance/route.ts").read_text()
UI=(ROOT/"overlay/components/oa/finance-console.tsx").read_text()

class FinanceMailBackfillMigrationTests(unittest.TestCase):
 def setUp(self):
  db=sqlite3.connect(":memory:")
  db.execute("PRAGMA foreign_keys=ON")
  db.executescript("""
   CREATE TABLE oa_entity(id TEXT PRIMARY KEY);
   CREATE TABLE user(id TEXT PRIMARY KEY);
   CREATE TABLE oa_finance_mail_account(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES oa_entity(id));
   INSERT INTO oa_entity VALUES('company-a'),('company-b');
   INSERT INTO user VALUES('admin');
   INSERT INTO oa_finance_mail_account VALUES('mail-a','company-a'),('mail-b','company-b');
  """)
  db.executescript(SQL)
  self.db=db
 def insert(self, id, entity="company-a", account="mail-a", status="queued", begin="2026-01-01", end="2026-11-14"):
  self.db.execute(
   "INSERT INTO oa_finance_mail_backfill (id,entity_id,account_id,date_from,date_to,status,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?)",
   (id,entity,account,begin,end,status,"admin","admin"))
 def test_company_scope_on_insert_and_update(self):
  with self.assertRaisesRegex(sqlite3.IntegrityError,"company mismatch"):
   self.insert("wrong","company-a","mail-b")
  self.insert("good")
  with self.assertRaisesRegex(sqlite3.IntegrityError,"company mismatch"):
   self.db.execute("UPDATE oa_finance_mail_backfill SET account_id='mail-b' WHERE id='good'")
 def test_only_one_nonterminal_job_per_mailbox(self):
  self.insert("a")
  with self.assertRaises(sqlite3.IntegrityError):
   self.insert("b")
  self.db.execute("UPDATE oa_finance_mail_backfill SET status='completed' WHERE id='a'")
  self.insert("b")
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM oa_finance_mail_backfill").fetchone()[0],2)
 def test_invalid_calendar_span_rejected(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.insert("reversed",begin="2026-11-14",end="2026-01-01")
 def test_invalid_status_rejected(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.insert("bad",status="processing")
 def test_job_counters_and_continuation(self):
  self.insert("ok")
  self.db.execute(
   "UPDATE oa_finance_mail_backfill SET page_cursor=?,message_offset=12,messages_scanned=13,invoices_imported=2,duplicates_skipped=5 WHERE id='ok'",
   ("https://graph.microsoft.com/v1.0/users/...",))
  self.assertEqual(self.db.execute(
   "SELECT message_offset,messages_scanned,invoices_imported,duplicates_skipped FROM oa_finance_mail_backfill WHERE id='ok'").fetchone(),
   (12,13,2,5))
 def test_source_keeps_incremental_checkpoint(self):
  self.assertNotIn("SET last_success_at=",HISTORY)
  self.assertIn("importFinanceMailAttachments",HISTORY)
  self.assertIn("importFinanceMailAttachments",SYNC)
  self.assertIn('receivedDateTime ge ',SYNC)
  self.assertIn('page_cursor',HISTORY)
  self.assertIn('sync_lock_until',HISTORY)
 def test_finance_balance_is_reviewed_only_and_ui_is_split(self):
  self.assertIn("view===\"balances\"",FINANCE)
  self.assertIn("status IN ('open','settlement_pending','settled')",FINANCE)
  self.assertIn('activeTab==="config"',UI)
  self.assertIn('activeTab==="data"',UI)
  self.assertIn("FinanceBalances",UI)
  self.assertIn("AR / Receivables",UI)
  self.assertIn("AP / Payables",UI)
 def test_totals_accounting_excludes_unapproved_invoices(self):
  db=sqlite3.connect(":memory:")
  db.execute("CREATE TABLE invoices(direction TEXT,currency TEXT,status TEXT,amount_minor INT)")
  db.executemany("INSERT INTO invoices VALUES(?,?,?,?)",[
   ("ar","SGD","needs_review",100000),("ar","SGD","open",20000),
   ("ar","SGD","settlement_pending",30000),("ar","SGD","settled",40000),
   ("ap","USD","open",3500),("ap","USD","settled",5000)])
  result=db.execute("""
   SELECT direction,currency,status,SUM(amount_minor)
   FROM invoices WHERE status IN ('open','settlement_pending','settled')
   GROUP BY direction,currency,status
  """).fetchall()
  self.assertEqual(sum(v for d,c,s,v in result if d=="ar" and s!="settled"),50000)
  self.assertEqual(sum(v for d,c,s,v in result if d=="ar" and s=="settled"),40000)
  self.assertEqual(sum(v for d,c,s,v in result if d=="ap" and s!="settled"),3500)

if __name__=="__main__":
 unittest.main(verbosity=2)
