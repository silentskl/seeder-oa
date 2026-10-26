-- Phase 2B: composite identity for the same user employed by separate entities.
-- Legacy OA employee table is not dropped, renamed or rewritten.
CREATE TABLE IF NOT EXISTS oa_entity_employee (
 entity_id TEXT NOT NULL REFERENCES oa_entity(id) ON DELETE RESTRICT,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
 employee_no TEXT,
 department TEXT,
 job_title TEXT,
 manager_user_id TEXT,
 join_date TEXT,
 annual_leave_days INTEGER NOT NULL DEFAULT 14,
 medical_insurance_limit_minor INTEGER NOT NULL DEFAULT 0,
 payroll_currency TEXT NOT NULL DEFAULT 'SGD',
 reimbursement_currency TEXT NOT NULL DEFAULT 'SGD',
 active INTEGER NOT NULL DEFAULT 1,
 legal_name TEXT,
 personal_email TEXT,
 phone TEXT,
 address TEXT,
 nationality TEXT,
 date_of_birth TEXT,
 employment_type TEXT,
 work_location TEXT,
 base_salary_minor INTEGER NOT NULL DEFAULT 0,
 salary_period TEXT NOT NULL DEFAULT 'monthly',
 salary_effective_date TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(entity_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_oa_entity_employee_manager ON oa_entity_employee(entity_id,manager_user_id);
CREATE INDEX IF NOT EXISTS idx_oa_entity_employee_active ON oa_entity_employee(entity_id,active);

INSERT OR IGNORE INTO oa_entity_employee(entity_id,user_id,employee_no,department,job_title,manager_user_id,join_date,annual_leave_days,medical_insurance_limit_minor,payroll_currency,reimbursement_currency,active,legal_name,personal_email,phone,address,nationality,date_of_birth,employment_type,work_location,base_salary_minor,salary_period,salary_effective_date,updated_at)
SELECT 'legacy-primary',user_id,employee_no,department,job_title,manager_user_id,join_date,annual_leave_days,medical_insurance_limit_minor,payroll_currency,reimbursement_currency,active,legal_name,personal_email,phone,address,nationality,date_of_birth,employment_type,work_location,base_salary_minor,salary_period,salary_effective_date,updated_at FROM oa_employee
WHERE entity_id='legacy-primary';

-- Keep old production API writes mirrored into composite legacy profile until
-- all Employee APIs are cut over. Triggers run atomically with old writes.
CREATE TRIGGER IF NOT EXISTS oa_legacy_employee_profile_insert
AFTER INSERT ON oa_employee WHEN NEW.entity_id='legacy-primary'
BEGIN
 INSERT INTO oa_entity_employee(entity_id,user_id,employee_no,department,job_title,manager_user_id,join_date,annual_leave_days,medical_insurance_limit_minor,payroll_currency,reimbursement_currency,active,legal_name,personal_email,phone,address,nationality,date_of_birth,employment_type,work_location,base_salary_minor,salary_period,salary_effective_date,updated_at)
 VALUES(NEW.entity_id,NEW.user_id,NEW.employee_no,NEW.department,NEW.job_title,NEW.manager_user_id,NEW.join_date,NEW.annual_leave_days,NEW.medical_insurance_limit_minor,NEW.payroll_currency,NEW.reimbursement_currency,NEW.active,NEW.legal_name,NEW.personal_email,NEW.phone,NEW.address,NEW.nationality,NEW.date_of_birth,NEW.employment_type,NEW.work_location,NEW.base_salary_minor,NEW.salary_period,NEW.salary_effective_date,NEW.updated_at)
 ON CONFLICT(entity_id,user_id) DO UPDATE SET
 employee_no=excluded.employee_no,
 department=excluded.department,
 job_title=excluded.job_title,
 manager_user_id=excluded.manager_user_id,
 join_date=excluded.join_date,
 annual_leave_days=excluded.annual_leave_days,
 medical_insurance_limit_minor=excluded.medical_insurance_limit_minor,
 payroll_currency=excluded.payroll_currency,
 reimbursement_currency=excluded.reimbursement_currency,
 active=excluded.active,
 legal_name=excluded.legal_name,
 personal_email=excluded.personal_email,
 phone=excluded.phone,
 address=excluded.address,
 nationality=excluded.nationality,
 date_of_birth=excluded.date_of_birth,
 employment_type=excluded.employment_type,
 work_location=excluded.work_location,
 base_salary_minor=excluded.base_salary_minor,
 salary_period=excluded.salary_period,
 salary_effective_date=excluded.salary_effective_date,
 updated_at=excluded.updated_at;
END;
CREATE TRIGGER IF NOT EXISTS oa_legacy_employee_profile_update
AFTER UPDATE ON oa_employee WHEN NEW.entity_id='legacy-primary'
BEGIN
 INSERT INTO oa_entity_employee(entity_id,user_id,employee_no,department,job_title,manager_user_id,join_date,annual_leave_days,medical_insurance_limit_minor,payroll_currency,reimbursement_currency,active,legal_name,personal_email,phone,address,nationality,date_of_birth,employment_type,work_location,base_salary_minor,salary_period,salary_effective_date,updated_at)
 VALUES(NEW.entity_id,NEW.user_id,NEW.employee_no,NEW.department,NEW.job_title,NEW.manager_user_id,NEW.join_date,NEW.annual_leave_days,NEW.medical_insurance_limit_minor,NEW.payroll_currency,NEW.reimbursement_currency,NEW.active,NEW.legal_name,NEW.personal_email,NEW.phone,NEW.address,NEW.nationality,NEW.date_of_birth,NEW.employment_type,NEW.work_location,NEW.base_salary_minor,NEW.salary_period,NEW.salary_effective_date,NEW.updated_at)
 ON CONFLICT(entity_id,user_id) DO UPDATE SET
 employee_no=excluded.employee_no,
 department=excluded.department,
 job_title=excluded.job_title,
 manager_user_id=excluded.manager_user_id,
 join_date=excluded.join_date,
 annual_leave_days=excluded.annual_leave_days,
 medical_insurance_limit_minor=excluded.medical_insurance_limit_minor,
 payroll_currency=excluded.payroll_currency,
 reimbursement_currency=excluded.reimbursement_currency,
 active=excluded.active,
 legal_name=excluded.legal_name,
 personal_email=excluded.personal_email,
 phone=excluded.phone,
 address=excluded.address,
 nationality=excluded.nationality,
 date_of_birth=excluded.date_of_birth,
 employment_type=excluded.employment_type,
 work_location=excluded.work_location,
 base_salary_minor=excluded.base_salary_minor,
 salary_period=excluded.salary_period,
 salary_effective_date=excluded.salary_effective_date,
 updated_at=excluded.updated_at;
END;
