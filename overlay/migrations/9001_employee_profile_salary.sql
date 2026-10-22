-- Seeder OA v0.1.4: employee HR profile + base salary
-- Admin-only writable through /api/oa updateEmployee.

ALTER TABLE oa_employee ADD COLUMN legal_name TEXT;
ALTER TABLE oa_employee ADD COLUMN personal_email TEXT;
ALTER TABLE oa_employee ADD COLUMN phone TEXT;
ALTER TABLE oa_employee ADD COLUMN address TEXT;
ALTER TABLE oa_employee ADD COLUMN nationality TEXT;
ALTER TABLE oa_employee ADD COLUMN date_of_birth TEXT;
ALTER TABLE oa_employee ADD COLUMN employment_type TEXT;
ALTER TABLE oa_employee ADD COLUMN work_location TEXT;
ALTER TABLE oa_employee ADD COLUMN base_salary_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE oa_employee ADD COLUMN salary_period TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE oa_employee ADD COLUMN salary_effective_date TEXT;
