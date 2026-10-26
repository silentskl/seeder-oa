import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname,join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const root=join(dirname(fileURLToPath(import.meta.url)),"..");
const db=new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys=ON");
db.exec("\nCREATE TABLE user(id TEXT PRIMARY KEY,role TEXT NOT NULL,name TEXT,email TEXT);\nCREATE TABLE oa_settings(id INTEGER PRIMARY KEY,company_name TEXT,base_currency TEXT,fx_provider TEXT,default_annual_leave_days INTEGER,leave_approval_flow TEXT,expense_approval_flow TEXT,email_enabled INTEGER,email_provider TEXT,email_from_name TEXT,email_from_address TEXT,email_reply_to TEXT,email_api_key_encrypted TEXT);\nCREATE TABLE oa_employee(user_id TEXT PRIMARY KEY,employee_no TEXT,department TEXT,job_title TEXT,manager_user_id TEXT,join_date TEXT,annual_leave_days INTEGER,medical_insurance_limit_minor INTEGER,payroll_currency TEXT,reimbursement_currency TEXT,active INTEGER,legal_name TEXT,personal_email TEXT,phone TEXT,address TEXT,nationality TEXT,date_of_birth TEXT,employment_type TEXT,work_location TEXT,base_salary_minor INTEGER,salary_period TEXT,salary_effective_date TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);\nCREATE TABLE oa_expense_claim(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,category TEXT,expense_date TEXT NOT NULL DEFAULT '2026-01-01',medical_insurance_amount_minor INTEGER,medical_insurance_currency TEXT);\nCREATE TABLE oa_leave_request(id TEXT PRIMARY KEY,user_id TEXT,status TEXT);\nCREATE TABLE oa_expense_item(id TEXT PRIMARY KEY,claim_id TEXT,category TEXT);\nCREATE TABLE oa_payslip(id TEXT PRIMARY KEY,user_id TEXT,status TEXT);\nCREATE TABLE oa_file(id TEXT PRIMARY KEY,owner_user_id TEXT);\nCREATE TABLE oa_approval_step(id TEXT PRIMARY KEY,entity_type TEXT,entity_id TEXT,status TEXT);\nCREATE TABLE oa_audit_log(id TEXT PRIMARY KEY,entity_type TEXT,entity_id TEXT);\nCREATE TABLE oa_expense_category(name TEXT PRIMARY KEY,active INTEGER,sort_order INTEGER,created_at TEXT);\nCREATE TABLE oa_holiday(id TEXT PRIMARY KEY,holiday_date TEXT UNIQUE,name TEXT,created_by TEXT);\nCREATE TABLE oa_email_log(id TEXT PRIMARY KEY,created_at TEXT,entity_type TEXT,entity_id TEXT);\nCREATE TABLE oa_leave_type(code TEXT PRIMARY KEY,name TEXT,active INTEGER,deducts_annual INTEGER,sort_order INTEGER);\nINSERT INTO user(id,role,name,email) VALUES('staff','user','Staff','staff@example.test'),('admin','owner','Admin','admin@example.test');\nINSERT INTO oa_settings VALUES(1,'Legacy Company','SGD','frankfurter',14,'manager_admin','manager_admin',1,'resend','OA',NULL,NULL,NULL);\nINSERT INTO oa_employee(user_id,annual_leave_days,medical_insurance_limit_minor,payroll_currency,reimbursement_currency,active,base_salary_minor,salary_period) VALUES('staff',14,10000,'SGD','SGD',1,100,'monthly');\nINSERT INTO oa_expense_claim(id,user_id,status,category) VALUES('claim-1','staff','submitted','Meals');\nINSERT INTO oa_leave_request(id,user_id,status) VALUES('leave-1','staff','submitted');\nINSERT INTO oa_expense_item(id,claim_id,category) VALUES('item-1','claim-1','Meals');\nINSERT INTO oa_approval_step VALUES('step-1','expense','claim-1','pending');\nINSERT INTO oa_audit_log VALUES('audit-1','expense','claim-1');\nINSERT INTO oa_expense_category VALUES('Meals',1,10,CURRENT_TIMESTAMP);\nINSERT INTO oa_holiday VALUES('holiday-1','2026-12-25','Christmas','admin');\nINSERT INTO oa_email_log VALUES('mail-1',CURRENT_TIMESTAMP,'expense','claim-1');\nINSERT INTO oa_leave_type VALUES('annual','Annual Leave',1,1,10);\n");
const migrations=["9010_multi_entity_registry.sql","9011_entity_ownership_foundation.sql","9012_entity_settings_categories.sql","9013_entity_employee_profiles.sql","9014_email_log_company.sql","9015_entity_leave_types.sql","9016_entity_medical_allowance.sql","9018_entity_invitations.sql"];
for(const name of migrations)db.exec(readFileSync(join(root,"overlay","migrations",name),"utf8"));
const get=(sql)=>db.prepare(sql).get();
assert.equal(get("SELECT role FROM oa_entity_member WHERE user_id='admin'").role,"admin");
assert.equal(get("SELECT role FROM oa_entity_member WHERE user_id='staff'").role,"employee");
assert.equal(get("SELECT entity_id FROM oa_expense_claim WHERE id='claim-1'").entity_id,"legacy-primary");
assert.equal(get("SELECT entity_id FROM oa_approval_step WHERE id='step-1'").entity_id,"claim-1");
assert.equal(get("SELECT company_entity_id FROM oa_approval_step WHERE id='step-1'").company_entity_id,"legacy-primary");
assert.equal(get("SELECT entity_id FROM oa_audit_log WHERE id='audit-1'").entity_id,"claim-1");
assert.equal(get("SELECT company_entity_id FROM oa_audit_log WHERE id='audit-1'").company_entity_id,"legacy-primary");
assert.equal(get("SELECT company_entity_id FROM oa_email_log WHERE id='mail-1'").company_entity_id,"legacy-primary");
assert.equal(get("SELECT base_salary_minor AS n FROM oa_entity_employee WHERE user_id='staff'").n,100);
assert.equal(get("SELECT name FROM oa_entity_holiday WHERE entity_id='legacy-primary'").name,"Christmas");
assert.equal(get("SELECT name FROM oa_entity_leave_type WHERE entity_id='legacy-primary'").name,"Annual Leave");
db.exec("INSERT INTO oa_entity(id,legal_name,display_name) VALUES('other-entity','Other Ltd','Other')");
db.exec("INSERT INTO oa_entity_member(entity_id,user_id,role) VALUES('other-entity','staff','employee')");
db.exec("INSERT INTO oa_entity_employee(entity_id,user_id,base_salary_minor) VALUES('other-entity','staff',999)");
db.exec("INSERT INTO oa_entity_settings(entity_id,company_name) VALUES('other-entity','Other Ltd')");
db.exec("UPDATE oa_employee SET base_salary_minor=250 WHERE user_id='staff'");
assert.equal(get("SELECT base_salary_minor AS n FROM oa_entity_employee WHERE entity_id='legacy-primary' AND user_id='staff'").n,250);
assert.equal(get("SELECT base_salary_minor AS n FROM oa_entity_employee WHERE entity_id='other-entity' AND user_id='staff'").n,999);
db.exec("UPDATE oa_settings SET company_name='Legacy Updated' WHERE id=1");
assert.equal(get("SELECT company_name FROM oa_entity_settings WHERE entity_id='legacy-primary'").company_name,"Legacy Updated");
assert.equal(get("SELECT company_name FROM oa_entity_settings WHERE entity_id='other-entity'").company_name,"Other Ltd");
console.log("PASS: migrations, business-ID preservation and separate company profiles/settings");

db.exec("UPDATE oa_entity_employee SET medical_insurance_limit_minor=1000 WHERE entity_id='other-entity' AND user_id='staff'");
db.exec("INSERT INTO oa_expense_claim(id,user_id,status,category,expense_date,medical_insurance_amount_minor,medical_insurance_currency,entity_id) VALUES('other-medical','staff','submitted','Medical Insurance','2026-01-01',900,'SGD','other-entity')");
assert.throws(()=>db.exec("INSERT INTO oa_expense_claim(id,user_id,status,category,expense_date,medical_insurance_amount_minor,medical_insurance_currency,entity_id) VALUES('other-overlimit','staff','submitted','Medical Insurance','2026-01-02',200,'SGD','other-entity')"),/medical allowance/);
db.exec("INSERT INTO oa_expense_claim(id,user_id,status,category,expense_date,medical_insurance_amount_minor,medical_insurance_currency,entity_id) VALUES('legacy-medical','staff','submitted','Medical Insurance','2026-01-02',900,'SGD','legacy-primary')");
console.log("PASS: medical allowance is separately enforced per Entity");

const invitationDigest="b".repeat(64);
db.prepare("INSERT INTO oa_entity_invitation(id,entity_id,email,role,token_hash,invited_by,expires_at) VALUES(?,?,?,?,?,?,?)")
  .run("invite-1","legacy-primary","New.Employee@Example.com","employee",invitationDigest,"admin","2026-11-02T00:00:00.000Z");
assert.equal(get("SELECT email FROM oa_entity_invitation WHERE token_hash='"+invitationDigest+"'").email,"New.Employee@Example.com");
assert.throws(()=>db.prepare("INSERT INTO oa_entity_invitation(id,entity_id,email,role,token_hash,invited_by,expires_at) VALUES(?,?,?,?,?,?,?)")
  .run("invite-2","other-entity","test@example.com","employee",invitationDigest,"admin","2026-11-02T00:00:00.000Z"),/UNIQUE/);
console.log("PASS: invitation migration, unique one-time digests, and Entity ownership");
