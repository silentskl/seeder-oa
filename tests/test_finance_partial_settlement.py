import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
BASE=(ROOT/"overlay/migrations/9020_finance.sql").read_text()
MIG=(ROOT/"overlay/migrations/9031_finance_partial_settlement.sql").read_text()

class PartialSettlementTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(":memory:")
  self.db.execute("PRAGMA foreign_keys=ON")
  self.db.executescript("CREATE TABLE user(id TEXT PRIMARY KEY); CREATE TABLE oa_entity(id TEXT PRIMARY KEY); INSERT INTO user VALUES('u'); INSERT INTO oa_entity VALUES('e');")
  self.db.executescript(BASE)
  self.db.execute("INSERT INTO oa_finance_document(id,entity_id,purpose,r2_key,original_name,content_type,size_bytes) VALUES('i','e','invoice','i','i.pdf','application/pdf',5)")
  for n in range(8):
   self.db.execute("INSERT INTO oa_finance_document(id,entity_id,purpose,r2_key,original_name,content_type,size_bytes) VALUES(?,'e','settlement',?,'p.pdf','application/pdf',5)",(str(n),str(n)))
  self.db.execute("INSERT INTO oa_finance_invoice(id,entity_id,direction,source,document_id,status,currency,amount_minor) VALUES('inv','e','ap','manual','i','open','SGD',100000)")
 def migrate(self):
  self.db.executescript(MIG)
 def submit(self,n,amount):
  self.db.execute("INSERT INTO oa_finance_settlement(id,entity_id,invoice_id,document_id,submitted_by,amount_minor) VALUES(?,'e','inv',?,'u',?)",(str(n),str(n),amount))
 def decide(self,n,status):
  self.db.execute("UPDATE oa_finance_settlement SET status=? WHERE id=?",(status,str(n)))
 def check(self,status,paid,pending):
  self.assertEqual(self.db.execute("SELECT i.status,t.paid_minor,t.pending_minor FROM oa_finance_invoice i JOIN oa_finance_settlement_totals t ON t.invoice_id=i.id AND t.entity_id=i.entity_id").fetchone(),(status,paid,pending))
 def test_partial_reject_and_final(self):
  self.migrate()
  self.submit(0,30000); self.check('settlement_pending',0,30000)
  self.decide(0,'approved'); self.check('open',30000,0)
  self.submit(1,20000); self.check('settlement_pending',30000,20000)
  self.decide(1,'rejected'); self.check('open',30000,0)
  self.submit(2,70000); self.decide(2,'approved'); self.check('settled',100000,0)
  with self.assertRaises(sqlite3.IntegrityError): self.submit(3,1)
 def test_guards(self):
  self.migrate()
  for amount in (None,0,-1,100001,1.5):
   with self.assertRaises(sqlite3.IntegrityError): self.submit(0,amount)
  self.submit(0,30000)
  with self.assertRaises(sqlite3.IntegrityError): self.submit(1,1)
  with self.assertRaises(sqlite3.IntegrityError): self.db.execute("UPDATE oa_finance_settlement SET amount_minor=1 WHERE id='0'")
  self.decide(0,'approved')
  with self.assertRaises(sqlite3.IntegrityError): self.decide(0,'rejected')
  with self.assertRaises(sqlite3.IntegrityError): self.submit(1,70001)
  self.check('open',30000,0)
 def test_legacy_full_payment(self):
  self.db.execute("INSERT INTO oa_finance_settlement(id,entity_id,invoice_id,document_id,submitted_by,status) VALUES('0','e','inv','0','u','approved')")
  self.db.execute("UPDATE oa_finance_invoice SET status='settled' WHERE id='inv'")
  self.migrate(); self.check('settled',100000,0)
  self.assertEqual(self.db.execute("SELECT amount_minor FROM oa_finance_settlement").fetchone()[0],100000)
 def test_legacy_pending(self):
  self.db.execute("INSERT INTO oa_finance_settlement(id,entity_id,invoice_id,document_id,submitted_by) VALUES('0','e','inv','0','u')")
  self.db.execute("UPDATE oa_finance_invoice SET status='settlement_pending' WHERE id='inv'")
  self.migrate(); self.check('settlement_pending',0,100000)
  self.decide(0,'approved'); self.check('settled',100000,0)

if __name__=="__main__": unittest.main()
