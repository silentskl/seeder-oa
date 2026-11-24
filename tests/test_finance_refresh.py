import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
API=(ROOT/"overlay/app/api/oa/finance/route.ts").read_text()
UI=(ROOT/"overlay/components/oa/finance-console.tsx").read_text()

class FinanceRefreshTests(unittest.TestCase):
 def test_fresh_reads(self):
  self.assertIn('export const dynamic="force-dynamic"',API)
  self.assertIn('"Cache-Control":"private, no-store',API)
  self.assertIn('encodeURIComponent(view)+freshRead()',UI)
  self.assertIn('encodeURIComponent(String(offset))+freshRead()',UI)
 def test_independent_refresh_and_retry(self):
  self.assertIn('for(let attempt=0;attempt<2;attempt++)',UI)
  self.assertIn('refresh(()=>fetchView(id,"settlements"),setSettlements)',UI)
  self.assertIn('refresh(()=>fetchView(id,"balances"),setBalances)',UI)
  self.assertIn('if(isCurrent())apply(value)',UI)
  self.assertIn('setRefreshWarning(results.some(success=>!success))',UI)
  self.assertIn('try{await load(company);}',UI)
 def test_confirmed_state_applied_before_reload(self):
  self.assertIn('RETURNING id,status,decided_at',API)
  self.assertIn('if(!changed)throw new Error("Settlement approval conflict")',API)
  self.assertIn('setSettlements(prev=>prev.map(row=>row.id===s.id?',UI)
  self.assertIn('setInvoices(prev=>prev.map(row=>row.id===s.invoice_id?',UI)

if __name__=="__main__": unittest.main()
