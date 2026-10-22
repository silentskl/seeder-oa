-- Seeder OA v0.1.10: snapshot HR identity fields into each payslip.
-- Base salary was already snapshotted in oa_payslip.base_salary_minor.

ALTER TABLE oa_payslip ADD COLUMN employee_name_snapshot TEXT;
ALTER TABLE oa_payslip ADD COLUMN employee_no_snapshot TEXT;
ALTER TABLE oa_payslip ADD COLUMN join_date_snapshot TEXT;
ALTER TABLE oa_payslip ADD COLUMN job_title_snapshot TEXT;
ALTER TABLE oa_payslip ADD COLUMN department_snapshot TEXT;
ALTER TABLE oa_payslip ADD COLUMN salary_period_snapshot TEXT;
