#!/usr/bin/env python3
"""Company-scoped DeepSeek reasoning-effort migration and request guards."""
import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
MIGRATION=(ROOT/"overlay/migrations/9024_finance_ai_reasoning_effort.sql").read_text()
CODE=(ROOT/"overlay/lib/oa/finance-ai.ts").read_text()

class FinanceAiReasoningMigrationTests(unittest.TestCase):
 def setUp(self):
  db=sqlite3.connect(":memory:")
  db.executescript("""
   CREATE TABLE oa_finance_ai_settings(
    entity_id TEXT PRIMARY KEY,
    base_url TEXT,model_name TEXT,protocol TEXT,
    api_key_encrypted TEXT,enabled INTEGER,updated_by TEXT);
   INSERT INTO oa_finance_ai_settings VALUES('company-a','https://modelbridge.example/v1','deepseek-v4-flash','responses','cipher',1,'admin');
   INSERT INTO oa_finance_ai_settings VALUES('company-b','https://modelbridge.example/v1','other-model','responses','cipher',1,'admin');
  """)
  db.executescript(MIGRATION)
  self.db=db
 def test_existing_records_default_to_auto(self):
  self.assertEqual(self.db.execute("SELECT reasoning_effort FROM oa_finance_ai_settings WHERE entity_id='company-a'").fetchone()[0],"auto")
  self.assertEqual(self.db.execute("SELECT reasoning_effort FROM oa_finance_ai_settings WHERE entity_id='company-b'").fetchone()[0],"auto")
 def test_company_override_is_independent(self):
  self.db.execute("UPDATE oa_finance_ai_settings SET reasoning_effort='none' WHERE entity_id='company-a'")
  self.assertEqual(self.db.execute("SELECT reasoning_effort FROM oa_finance_ai_settings WHERE entity_id='company-a'").fetchone()[0],"none")
  self.assertEqual(self.db.execute("SELECT reasoning_effort FROM oa_finance_ai_settings WHERE entity_id='company-b'").fetchone()[0],"auto")
 def test_invalid_effort_is_rejected(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("UPDATE oa_finance_ai_settings SET reasoning_effort='ultra' WHERE entity_id='company-a'")
 def test_no_more_token_increase_as_fix(self):
  self.assertIn('const budget=document?4096:128;',CODE)
  self.assertIn('reasoning:{effort}',CODE)
  self.assertIn('DEEPSEEK_INLINE_PDF_UNSUPPORTED',CODE)
 def test_proxy_does_not_auto_retry_billable_requests(self):
  self.assertNotIn('retryModel(',CODE)
  self.assertIn('redirect:"manual"',CODE)

if __name__=="__main__":
 unittest.main(verbosity=2)
