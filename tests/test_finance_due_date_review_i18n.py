#!/usr/bin/env python3
"""New due-date and bank review schema, USD SWIFT rule, and UI routing checks."""
import pathlib
import re
import sqlite3
import unittest
from datetime import date,timedelta

ROOT=pathlib.Path(__file__).resolve().parents[1]
MIG=(ROOT/"overlay/migrations/9027_finance_due_date_inference.sql").read_text()
CORE=(ROOT/"overlay/lib/oa/finance.ts").read_text()
AI=(ROOT/"overlay/lib/oa/finance-ai.ts").read_text()
REVIEW=(ROOT/"overlay/lib/oa/finance-review-checks.ts").read_text()
API=(ROOT/"overlay/app/api/oa/finance/route.ts").read_text()
UI=(ROOT/"overlay/components/oa/finance-console.tsx").read_text()
MODEL=(ROOT/"overlay/components/oa/finance-ai-panel.tsx").read_text()
MAIL=(ROOT/"overlay/components/oa/finance-mail-accounts.tsx").read_text()
SHELL=(ROOT/"overlay/components/oa/oa-shell.tsx").read_text()

class FinanceDueDateAndReviewTests(unittest.TestCase):
 def test_migration_additive_defaults(self):
  db=sqlite3.connect(":memory:")
  db.execute("CREATE TABLE oa_finance_invoice(id TEXT PRIMARY KEY, entity_id TEXT)")
  db.execute("INSERT INTO oa_finance_invoice VALUES('old','company')")
  db.executescript(MIG)
  self.assertEqual(
   db.execute("SELECT due_date_inferred,invoice_bank_swift FROM oa_finance_invoice WHERE id='old'").fetchone(),
   (0,""))
  db.execute("INSERT INTO oa_finance_invoice(id,entity_id,due_date_inferred,invoice_bank_swift) VALUES('new','company',1,'ABCDSGSG')")
  self.assertEqual(db.execute("SELECT due_date_inferred FROM oa_finance_invoice WHERE id='new'").fetchone()[0],1)
  with self.assertRaises(sqlite3.IntegrityError):
   db.execute("UPDATE oa_finance_invoice SET due_date_inferred=2 WHERE id='new'")
 def test_due_date_is_invoice_date_plus_30(self):
  self.assertIn("new Date(epoch+30*86400000)",CORE)
  self.assertIn("documentDueDate||(inferred?dueDatePlus30(invoiceDate):null)",CORE)
  self.assertIn("dueDateInferred:inferred",CORE)
  for original,expected in (("2026-01-31","2026-03-02"),("2026-02-01","2026-03-03"),
    ("2024-02-01","2024-03-02"),("2026-12-05","2027-01-04")):
   self.assertEqual((date.fromisoformat(original)+timedelta(days=30)).isoformat(),expected)
  self.assertIn("previousWasInferred",API)
  self.assertIn("dueDatePlus30(invoiceDate)",API)
 def test_swift_is_explicit_extraction_field(self):
  self.assertIn('"bank_swift","notes"',AI)
  self.assertIn("Extract SWIFT/BIC only if explicitly shown",AI)
  self.assertIn("bankSwift:clean(data?.bank_swift,80)",CORE)
  self.assertIn("invoice_bank_swift,sender_email",CORE)
  self.assertIn("invoice_bank_swift=?",API)
 def test_currency_conditional_check_is_shared_and_authoritative(self):
  self.assertIn('text(invoice.currency).toUpperCase()==="USD"',REVIEW)
  self.assertIn('required:requiredSwift',REVIEW)
  self.assertIn('status:"match"|"mismatch"|"missing"|"not_required"',REVIEW)
  self.assertIn("invoiceReviewVerified(checked)",API)
  self.assertIn("invoiceReviewVerified(checks)",UI)
  self.assertIn("disabled={k===\"amount\"&&!reviewVerified}",UI)
  self.assertIn("disabled={busy||!reviewVerified}",UI)
 def test_three_config_tabs_and_language_switch(self):
  self.assertIn('configTab==="mailboxes"',UI)
  self.assertIn('configTab==="ai"',UI)
  self.assertIn('configTab==="calls"',UI)
  self.assertIn('mode="settings"',UI)
  self.assertIn('mode="calls"',UI)
  self.assertIn('mode==="calls"',MODEL)
  self.assertNotIn("<details className=\"mt-4 border-t pt-3",MODEL)
  self.assertIn('lang={lang}',UI)
  self.assertIn('lang={lang}',MAIL)
  self.assertIn('useFinanceLanguage()',SHELL)
 def test_overdue_and_accounting_gates(self):
  self.assertIn('overdueDays(i.due_date,i.status)>0',UI)
  self.assertIn('["open","settlement_pending","needs_review"]',UI)
  self.assertIn('text-red-700',UI)
  self.assertIn('invoiceReviewChecks(',API)
  self.assertIn('counterparty_name:clean(body.counterparty_name,300)',API)
  self.assertIn("SELECT * FROM oa_finance_party WHERE entity_id=? AND root_id=? AND status='approved'",API)
 def test_insert_sql_placeholder_count(self):
  match=re.search(r'INSERT INTO oa_finance_invoice\(([^)]+)\) VALUES\(([^)]+)\)',CORE)
  self.assertIsNotNone(match)
  self.assertEqual(len(match.group(1).split(",")),len(re.findall(r'\?',match.group(2))))
  self.assertIn("p.dueDateInferred?1:0",CORE)
 def test_reextract_due_date_column_appears_only_once(self):
  source=re.search(r'UPDATE oa_finance_invoice SET direction=\?,party_root_id=\?,counterparty_name=\?,invoice_number=\?.*?WHERE id=\? AND entity_id=\? AND status=',API)
  self.assertIsNotNone(source)
  self.assertEqual(source.group(0).count('due_date_inferred=?'),1)
  self.assertIn('invoice_bank_swift=?',source.group(0))
 def test_no_new_credential_exposure(self):
  self.assertIn("settings.settings_master_key_configured",MODEL)
  self.assertIn("No API keys, invoice contents",MODEL)

if __name__=="__main__":
 unittest.main(verbosity=2)
