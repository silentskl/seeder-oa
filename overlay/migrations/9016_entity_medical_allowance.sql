-- Phase 2B: scope medical allowance enforcement to (entity_id,user_id).
DROP TRIGGER IF EXISTS oa_medical_allowance_insert;
DROP TRIGGER IF EXISTS oa_medical_allowance_update;
-- Enforce annual medical allowance inside SQLite's serialized write transaction.
-- Application-side available-balance checks are advisory only; this trigger is authoritative.
CREATE TRIGGER IF NOT EXISTS oa_medical_allowance_insert
BEFORE INSERT ON oa_expense_claim
WHEN NEW.category = 'Medical Insurance' AND NEW.status IN ('submitted','approved','paid')
BEGIN
  SELECT RAISE(ABORT, 'medical allowance: invalid snapshot')
  WHERE NOT EXISTS (SELECT 1 FROM oa_entity_employee WHERE entity_id=NEW.entity_id AND user_id=NEW.user_id)
     OR NEW.medical_insurance_amount_minor IS NULL
     OR NEW.medical_insurance_amount_minor < 0
     OR NEW.medical_insurance_currency IS NULL
     OR NEW.medical_insurance_currency <> (SELECT payroll_currency FROM oa_entity_employee WHERE entity_id=NEW.entity_id AND user_id=NEW.user_id)
     OR length(NEW.expense_date) <> 10;
  SELECT RAISE(ABORT, 'medical allowance: annual limit exceeded')
  WHERE COALESCE((SELECT SUM(medical_insurance_amount_minor)
                  FROM oa_expense_claim
                  WHERE entity_id=NEW.entity_id AND user_id=NEW.user_id AND category='Medical Insurance'
                    AND status IN ('submitted','approved','paid')
                    AND substr(expense_date,1,4)=substr(NEW.expense_date,1,4)),0)
        + NEW.medical_insurance_amount_minor
        > COALESCE((SELECT medical_insurance_limit_minor FROM oa_entity_employee WHERE entity_id=NEW.entity_id AND user_id=NEW.user_id),0);
END;

CREATE TRIGGER IF NOT EXISTS oa_medical_allowance_update
BEFORE UPDATE OF category,status,expense_date,medical_insurance_amount_minor,medical_insurance_currency,user_id,entity_id
ON oa_expense_claim
WHEN NEW.category = 'Medical Insurance' AND NEW.status IN ('submitted','approved','paid')
BEGIN
  SELECT RAISE(ABORT, 'medical allowance: invalid snapshot')
  WHERE NOT EXISTS (SELECT 1 FROM oa_entity_employee WHERE entity_id=NEW.entity_id AND user_id=NEW.user_id)
     OR NEW.medical_insurance_amount_minor IS NULL
     OR NEW.medical_insurance_amount_minor < 0
     OR NEW.medical_insurance_currency IS NULL
     OR NEW.medical_insurance_currency <> (SELECT payroll_currency FROM oa_entity_employee WHERE entity_id=NEW.entity_id AND user_id=NEW.user_id)
     OR length(NEW.expense_date) <> 10;
  SELECT RAISE(ABORT, 'medical allowance: annual limit exceeded')
  WHERE COALESCE((SELECT SUM(medical_insurance_amount_minor)
                  FROM oa_expense_claim
                  WHERE id<>OLD.id AND entity_id=NEW.entity_id AND user_id=NEW.user_id AND category='Medical Insurance'
                    AND status IN ('submitted','approved','paid')
                    AND substr(expense_date,1,4)=substr(NEW.expense_date,1,4)),0)
        + NEW.medical_insurance_amount_minor
        > COALESCE((SELECT medical_insurance_limit_minor FROM oa_entity_employee WHERE entity_id=NEW.entity_id AND user_id=NEW.user_id),0);
END;
