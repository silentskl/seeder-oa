-- Phase 2A: label existing single-company data before API cutover.
-- NON-DESTRUCTIVE. Do not enable creation of second entities.
-- D1 migration ledger ensures each ALTER executes once.
-- IMPORTANT: approval and audit already use entity_id as business record ID.
-- Their company ownership uses company_entity_id, never overwrite entity_id.
-- Current single-company rows and new rows remain mapped to the legacy entity
-- while the application-level multi-entity isolation is being implemented.

ALTER TABLE oa_employee ADD COLUMN entity_id TEXT NOT NULL DEFAULT 'legacy-primary';
CREATE INDEX IF NOT EXISTS idx_oa_employee_entity ON oa_employee(entity_id);
ALTER TABLE oa_leave_request ADD COLUMN entity_id TEXT NOT NULL DEFAULT 'legacy-primary';
CREATE INDEX IF NOT EXISTS idx_oa_leave_request_entity ON oa_leave_request(entity_id);
ALTER TABLE oa_expense_claim ADD COLUMN entity_id TEXT NOT NULL DEFAULT 'legacy-primary';
CREATE INDEX IF NOT EXISTS idx_oa_expense_claim_entity ON oa_expense_claim(entity_id);
ALTER TABLE oa_payslip ADD COLUMN entity_id TEXT NOT NULL DEFAULT 'legacy-primary';
CREATE INDEX IF NOT EXISTS idx_oa_payslip_entity ON oa_payslip(entity_id);
ALTER TABLE oa_file ADD COLUMN entity_id TEXT NOT NULL DEFAULT 'legacy-primary';
CREATE INDEX IF NOT EXISTS idx_oa_file_entity ON oa_file(entity_id);
ALTER TABLE oa_approval_step ADD COLUMN company_entity_id TEXT NOT NULL DEFAULT 'legacy-primary';
CREATE INDEX IF NOT EXISTS idx_oa_approval_step_entity ON oa_approval_step(company_entity_id);
ALTER TABLE oa_audit_log ADD COLUMN company_entity_id TEXT NOT NULL DEFAULT 'legacy-primary';
CREATE INDEX IF NOT EXISTS idx_oa_audit_log_entity ON oa_audit_log(company_entity_id);
ALTER TABLE oa_expense_item ADD COLUMN entity_id TEXT NOT NULL DEFAULT 'legacy-primary';
CREATE INDEX IF NOT EXISTS idx_oa_expense_item_entity ON oa_expense_item(entity_id);
-- If any existing table is absent, migration must fail instead of silently skipping it.
-- Application guard and authorization of all business routes are still mandatory.

-- SQLite cannot ADD a REFERENCES column with non-NULL default on nonempty tables
-- while foreign_keys=ON. The entity FK is enforced in the future table rebuild.
