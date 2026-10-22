PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS oa_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  company_name TEXT NOT NULL DEFAULT 'Company',
  base_currency TEXT NOT NULL DEFAULT 'SGD',
  fx_provider TEXT NOT NULL DEFAULT 'frankfurter',
  default_annual_leave_days REAL NOT NULL DEFAULT 14,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO oa_settings (id, company_name, base_currency, fx_provider, default_annual_leave_days)
VALUES (1, 'Company', 'SGD', 'frankfurter', 14);

CREATE TABLE IF NOT EXISTS oa_employee (
  user_id TEXT PRIMARY KEY,
  employee_no TEXT UNIQUE,
  department TEXT,
  job_title TEXT,
  manager_user_id TEXT,
  join_date TEXT,
  annual_leave_days REAL NOT NULL DEFAULT 14,
  payroll_currency TEXT NOT NULL DEFAULT 'SGD',
  reimbursement_currency TEXT NOT NULL DEFAULT 'SGD',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (manager_user_id) REFERENCES user(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS oa_employee_manager_idx ON oa_employee(manager_user_id);
CREATE INDEX IF NOT EXISTS oa_employee_department_idx ON oa_employee(department);

CREATE TABLE IF NOT EXISTS oa_leave_type (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  deducts_annual INTEGER NOT NULL DEFAULT 0 CHECK (deducts_annual IN (0,1)),
  paid INTEGER NOT NULL DEFAULT 1 CHECK (paid IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 100
);
INSERT OR IGNORE INTO oa_leave_type(code,name,deducts_annual,paid,sort_order) VALUES
 ('annual','Annual Leave',1,1,10),
 ('sick','Sick Leave',0,1,20),
 ('unpaid','Unpaid Leave',0,0,30),
 ('compassionate','Compassionate Leave',0,1,40);

CREATE TABLE IF NOT EXISTS oa_holiday (
  id TEXT PRIMARY KEY,
  holiday_date TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES user(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS oa_file (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('receipt','leave_attachment','payslip','other')),
  r2_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS oa_file_owner_idx ON oa_file(owner_user_id);

CREATE TABLE IF NOT EXISTS oa_leave_request (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  leave_type_code TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  day_part TEXT NOT NULL DEFAULT 'full' CHECK (day_part IN ('full','am','pm')),
  business_days REAL NOT NULL,
  reason TEXT,
  attachment_file_id TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','rejected','cancelled')),
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TEXT,
  decided_by TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (leave_type_code) REFERENCES oa_leave_type(code),
  FOREIGN KEY (attachment_file_id) REFERENCES oa_file(id) ON DELETE SET NULL,
  FOREIGN KEY (decided_by) REFERENCES user(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS oa_leave_user_idx ON oa_leave_request(user_id, start_date DESC);
CREATE INDEX IF NOT EXISTS oa_leave_status_idx ON oa_leave_request(status, submitted_at DESC);

CREATE TABLE IF NOT EXISTS oa_fx_rate (
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  requested_date TEXT NOT NULL,
  rate REAL NOT NULL CHECK (rate > 0),
  provider_date TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (base_currency, quote_currency, requested_date)
);

CREATE TABLE IF NOT EXISTS oa_expense_claim (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expense_date TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  original_amount_minor INTEGER NOT NULL CHECK (original_amount_minor >= 0),
  original_currency TEXT NOT NULL,
  reimbursement_currency TEXT NOT NULL,
  fx_rate REAL NOT NULL CHECK (fx_rate > 0),
  fx_rate_date TEXT NOT NULL,
  fx_source TEXT NOT NULL,
  reimbursement_amount_minor INTEGER NOT NULL CHECK (reimbursement_amount_minor >= 0),
  receipt_file_id TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','rejected','paid','cancelled')),
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TEXT,
  decided_by TEXT,
  decision_note TEXT,
  paid_at TEXT,
  paid_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (receipt_file_id) REFERENCES oa_file(id) ON DELETE SET NULL,
  FOREIGN KEY (decided_by) REFERENCES user(id) ON DELETE SET NULL,
  FOREIGN KEY (paid_by) REFERENCES user(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS oa_expense_user_idx ON oa_expense_claim(user_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS oa_expense_status_idx ON oa_expense_claim(status, submitted_at DESC);

CREATE TABLE IF NOT EXISTS oa_payslip (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  pay_date TEXT NOT NULL,
  currency TEXT NOT NULL,
  base_salary_minor INTEGER NOT NULL DEFAULT 0,
  allowances_minor INTEGER NOT NULL DEFAULT 0,
  bonus_minor INTEGER NOT NULL DEFAULT 0,
  commission_minor INTEGER NOT NULL DEFAULT 0,
  employee_contribution_minor INTEGER NOT NULL DEFAULT 0,
  employer_contribution_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  other_deductions_minor INTEGER NOT NULL DEFAULT 0,
  gross_minor INTEGER NOT NULL DEFAULT 0,
  net_minor INTEGER NOT NULL DEFAULT 0,
  reporting_currency TEXT NOT NULL DEFAULT 'SGD',
  fx_rate_to_reporting REAL NOT NULL DEFAULT 1,
  fx_rate_date TEXT NOT NULL,
  fx_source TEXT NOT NULL DEFAULT 'identity',
  net_reporting_minor INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  attachment_file_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','void')),
  published_at TEXT,
  published_by TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (attachment_file_id) REFERENCES oa_file(id) ON DELETE SET NULL,
  FOREIGN KEY (published_by) REFERENCES user(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES user(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS oa_payslip_user_idx ON oa_payslip(user_id, pay_date DESC);
CREATE INDEX IF NOT EXISTS oa_payslip_status_idx ON oa_payslip(status, pay_date DESC);

CREATE TABLE IF NOT EXISTS oa_audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_user_id) REFERENCES user(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS oa_audit_created_idx ON oa_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS oa_audit_entity_idx ON oa_audit_log(entity_type, entity_id);
