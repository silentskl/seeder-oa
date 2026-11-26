#!/usr/bin/env python3
"""Static wiring regressions; full Workers runtime still requires preview."""
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]/"overlay"
class RuntimeIsolation(unittest.TestCase):
 def test_auth_remains_mandatory(self):
  for path in ["app/(oa)/layout.tsx","app/(oa)/admin/oa/finance/page.tsx"]:
   self.assertIn("await requireViewer()", (ROOT/path).read_text())
 def test_nav_checks_are_independent(self):
  s=(ROOT/"app/(oa)/layout.tsx").read_text()
  for stage in ["superadmin","manager","billing","parties","contracts"]:
   self.assertIn('navigationCheck("layout.'+stage+'"',s)
  self.assertIn("navigationWarning",s)
 def test_scope_and_explicit_failure(self):
  s=(ROOT/"app/api/oa/finance/entities/route.ts").read_text()
  self.assertIn("status:503",s)
  self.assertIn("status:403",s)
  self.assertIn("await getViewer()",s)
  self.assertIn('scope==="parties"?Promise.resolve([]):listFinanceAdminEntities',s)
  self.assertIn('scope==="ledger"?Promise.resolve([]):listPartyManagementEntities',s)
  ui=(ROOT/"components/oa/finance-console.tsx").read_text()
  self.assertIn("!res.ok||!json?.ok",ui)
 def test_oa_sidebar_disables_automatic_prefetch(self):
  import re
  s=(ROOT/"components/oa/oa-shell.tsx").read_text()
  links=re.findall(r"<Link\s+[^>]*>",s)
  self.assertGreaterEqual(len(links),3)
  for link in links:self.assertIn("prefetch={false}",link)
 def test_logging(self):
  s=(ROOT/"instrumentation.ts").read_text()
  self.assertIn("Instrumentation.onRequestError",s)
  self.assertIn("context.routePath",s)
  self.assertNotIn("request.headers.cookie",s)
  s=(ROOT/"lib/oa/db.ts").read_text()
  for op in ["one","all","run"]:
   self.assertIn('logOaFailure("db.'+op+'"',s)
if __name__=="__main__":unittest.main(verbosity=2)
