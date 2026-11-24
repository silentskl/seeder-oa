import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
API=(ROOT/"overlay/app/api/oa/finance/route.ts").read_text()
UI=(ROOT/"overlay/components/oa/finance-console.tsx").read_text()
I18N=(ROOT/"overlay/lib/oa/finance-i18n.ts").read_text()

class SettlementFeedbackTests(unittest.TestCase):
 def test_independent_review_preserved(self):
  self.assertIn('row.submitted_by===viewer.id)return fail("Cannot approve or reject your own proof submission",403)',API)
  self.assertIn('s.submitted_by===access.userId?"own_submission"',API)
  self.assertIn('s.approver_user_id!==access.userId?"assigned_other"',API)
  self.assertIn('Bank account mismatch: settlement approval blocked',API)
 def test_eligibility_in_ui(self):
  self.assertIn('disabled={busy||!!s.decision_block_reason}',UI)
  self.assertIn('a.id!==excludedUser',UI)
  self.assertIn('settlementFeedback?.id===s.id',UI)
  self.assertIn('s.submitter_name||s.submitter_email||s.submitted_by',UI)
 def test_error_translation(self):
  for message in ('Cannot approve or reject your own proof submission','Assigned administrator only','Settlement approval conflict','Bank account mismatch: settlement approval blocked'):
   self.assertIn(message,I18N)

if __name__=="__main__":
 unittest.main()
