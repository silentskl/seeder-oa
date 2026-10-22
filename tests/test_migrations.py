#!/usr/bin/env python3
import sqlite3, pathlib, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
MIG=ROOT/'overlay/migrations'
class MigrationTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:'); self.db.execute('PRAGMA foreign_keys=ON');self.db.execute('CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT)');self.db.execute("INSERT INTO user(id,name,email) VALUES('u1','Test','test@example.com')")
  for p in sorted(MIG.glob('*.sql')):
   if p.name.startswith('9007'):break
   self.db.executescript(p.read_text())
 def test_backfill_and_idempotence(self):
  cols={r[1] for r in self.db.execute('PRAGMA table_info(oa_expense_claim)')}
  required=['id','user_id','expense_date','category','description','original_amount_minor','original_currency','reimbursement_currency','fx_rate','fx_rate_date','fx_source','reimbursement_amount_minor','receipt_file_id']
  self.assertTrue(set(required)<=cols)
  self.db.execute("INSERT INTO oa_file(id,owner_user_id,kind,r2_key,original_name,content_type,size_bytes) VALUES('f1','u1','receipt','key','receipt.pdf','application/pdf',1)")
  self.db.execute("INSERT INTO oa_expense_claim(id,user_id,expense_date,category,description,original_amount_minor,original_currency,reimbursement_currency,fx_rate,fx_rate_date,fx_source,reimbursement_amount_minor,receipt_file_id) VALUES('c1','u1','2026-10-01','Travel','Taxi',3500,'SGD','SGD',1,'2026-10-01','test',3500,'f1')")
  sql=(MIG/'9007_expense_items.sql').read_text();self.db.executescript(sql);self.db.executescript(sql)
  self.assertEqual(self.db.execute('SELECT count(*) FROM oa_expense_item').fetchone()[0],1)
  self.assertEqual(self.db.execute('SELECT item_id,file_id FROM oa_expense_item_document').fetchone(),('legacy-c1','f1'))
  self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
 def test_multi_item_multi_doc_constraints(self):
  self.db.executescript((MIG/'9007_expense_items.sql').read_text())
  self.db.execute("INSERT INTO oa_expense_claim(id,user_id,expense_date,category,description,original_amount_minor,original_currency,reimbursement_currency,fx_rate,fx_rate_date,fx_source,reimbursement_amount_minor) VALUES('c2','u1','2026-10-01','Other','2 items',1500,'SGD','SGD',1,'2026-10-01','test',1500)")
  for i in range(2):
   self.db.execute("INSERT INTO oa_expense_item(id,claim_id,sort_order,expense_date,category,description,original_amount_minor,original_currency,reimbursement_amount_minor,fx_rate,fx_rate_date,fx_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",(f'i{i}','c2',i,'2026-10-01','Travel','item',500+i*500,'SGD',500+i*500,1,'2026-10-01','test'))
  for i in range(3):
   self.db.execute('INSERT INTO oa_file(id,owner_user_id,kind,r2_key,original_name,content_type,size_bytes) VALUES(?,?,?,?,?,?,?)',(f'f{i}','u1','receipt',f'key{i}','a.pdf','application/pdf',1))
   self.db.execute('INSERT INTO oa_expense_item_document(item_id,file_id) VALUES(?,?)',('i0' if i<2 else 'i1',f'f{i}'))
  self.assertEqual(self.db.execute('SELECT SUM(reimbursement_amount_minor) FROM oa_expense_item WHERE claim_id="c2"').fetchone()[0],1500)
  self.assertEqual(self.db.execute('SELECT count(*) FROM oa_expense_item_document').fetchone()[0],3)
  with self.assertRaises(sqlite3.IntegrityError):self.db.execute("INSERT INTO oa_expense_item_document(item_id,file_id) VALUES('i0','f0')")
  self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
if __name__=='__main__':unittest.main(verbosity=2)
