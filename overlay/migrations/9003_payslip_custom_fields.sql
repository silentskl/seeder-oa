-- Seeder OA v0.1.7: custom payroll items.
-- Stored as JSON. New records use {name,amount_minor,type} where type is
-- contribution or deduction; older {name,value} entries remain readable.

ALTER TABLE oa_payslip ADD COLUMN custom_fields_json TEXT NOT NULL DEFAULT '[]';
