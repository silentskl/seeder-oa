-- Seeder OA v0.1.14: employee medical-insurance annual claim allowance
-- and payroll-currency accounting snapshots for Medical Insurance claims.

ALTER TABLE oa_employee ADD COLUMN medical_insurance_limit_minor INTEGER NOT NULL DEFAULT 0;

ALTER TABLE oa_expense_claim ADD COLUMN medical_insurance_amount_minor INTEGER;
ALTER TABLE oa_expense_claim ADD COLUMN medical_insurance_currency TEXT;
ALTER TABLE oa_expense_claim ADD COLUMN category_updated_at TEXT;
ALTER TABLE oa_expense_claim ADD COLUMN category_updated_by TEXT;

CREATE INDEX IF NOT EXISTS oa_expense_category_user_date_idx
  ON oa_expense_claim(user_id, category, expense_date DESC);
