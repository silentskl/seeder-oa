#!/usr/bin/env python3
"""SQLite regression checks for the authoritative medical allowance triggers."""
import sqlite3
from pathlib import Path

sql = (Path(__file__).resolve().parents[1] / 'overlay/migrations/9008_medical_allowance_atomic.sql').read_text()
db = sqlite3.connect(':memory:')
db.executescript('''
CREATE TABLE oa_employee(user_id TEXT PRIMARY KEY,payroll_currency TEXT,medical_insurance_limit_minor INTEGER);
CREATE TABLE oa_expense_claim(id TEXT PRIMARY KEY,user_id TEXT,category TEXT,status TEXT,expense_date TEXT,medical_insurance_amount_minor INTEGER,medical_insurance_currency TEXT);
INSERT INTO oa_employee VALUES('alice','SGD',10000);
''')
db.executescript(sql)
db.executescript(sql)

def insert(id, amount, status='submitted', year='2026', category='Medical Insurance', currency='SGD'):
    db.execute('INSERT INTO oa_expense_claim VALUES(?,?,?,?,?,?,?)',(id,'alice',category,status,year+'-05-10',amount,currency))

def rejects(action):
    try:
        action()
    except sqlite3.IntegrityError as e:
        assert 'medical allowance:' in str(e), str(e)
        return
    raise AssertionError('Expected allowance trigger to reject operation')

insert('a',6000)
rejects(lambda: insert('b',5000))  # second competing claim cannot overspend
insert('c',4000)
rejects(lambda: db.execute("UPDATE oa_expense_claim SET medical_insurance_amount_minor=7000 WHERE id='a'"))
rejects(lambda: insert('wrong-currency',100,'submitted','2026','Medical Insurance','USD'))
insert('rejected',5000,'rejected')
rejects(lambda: db.execute("UPDATE oa_expense_claim SET status='submitted' WHERE id='rejected'"))
db.execute("UPDATE oa_expense_claim SET status='cancelled' WHERE id='a'")
db.execute("UPDATE oa_expense_claim SET status='submitted' WHERE id='rejected'")
insert('new-year',10000,'submitted','2027')
assert db.execute("SELECT SUM(medical_insurance_amount_minor) FROM oa_expense_claim WHERE status IN ('submitted','approved','paid') AND substr(expense_date,1,4)='2026'").fetchone()[0] == 9000
print('PASS: atomic allowance insert/update, currency, status transition, release, year separation, idempotent trigger install')
