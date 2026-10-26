-- Phase 4: database-level guardrails for Entity isolation.
-- Non-destructive: existing records are preserved. Validate historic rows separately.
-- Membership removal is checked atomically when SQLite applies each mutation.
CREATE TRIGGER IF NOT EXISTS oa_entity_keep_last_admin_update
BEFORE UPDATE OF role,active ON oa_entity_member
WHEN OLD.role='admin' AND OLD.active=1 AND (NEW.role<>'admin' OR NEW.active<>1)
 AND (SELECT COUNT(*) FROM oa_entity_member WHERE entity_id=OLD.entity_id AND role='admin' AND active=1)<=1
BEGIN
 SELECT RAISE(ABORT,'entity: last active admin cannot be removed');
END;
CREATE TRIGGER IF NOT EXISTS oa_entity_keep_last_admin_delete
BEFORE DELETE ON oa_entity_member
WHEN OLD.role='admin' AND OLD.active=1
 AND (SELECT COUNT(*) FROM oa_entity_member WHERE entity_id=OLD.entity_id AND role='admin' AND active=1)<=1
BEGIN
 SELECT RAISE(ABORT,'entity: last active admin cannot be removed');
END;

CREATE TRIGGER IF NOT EXISTS oa_claim_item_company_insert
BEFORE INSERT ON oa_expense_item
WHEN NOT EXISTS (SELECT 1 FROM oa_expense_claim c WHERE c.id=NEW.claim_id AND c.entity_id=NEW.entity_id)
BEGIN
 SELECT RAISE(ABORT,'entity: expense item owner mismatch');
END;
CREATE TRIGGER IF NOT EXISTS oa_claim_item_company_update
BEFORE UPDATE OF claim_id,entity_id ON oa_expense_item
WHEN NOT EXISTS (SELECT 1 FROM oa_expense_claim c WHERE c.id=NEW.claim_id AND c.entity_id=NEW.entity_id)
BEGIN
 SELECT RAISE(ABORT,'entity: expense item owner mismatch');
END;
CREATE TRIGGER IF NOT EXISTS oa_expense_document_company_insert
BEFORE INSERT ON oa_expense_item_document
WHEN NOT EXISTS (SELECT 1 FROM oa_expense_item i JOIN oa_file f ON f.id=NEW.file_id
 WHERE i.id=NEW.item_id AND i.entity_id=f.entity_id)
BEGIN
 SELECT RAISE(ABORT,'entity: document owner mismatch');
END;
CREATE TRIGGER IF NOT EXISTS oa_expense_document_company_update
BEFORE UPDATE OF item_id,file_id ON oa_expense_item_document
WHEN NOT EXISTS (SELECT 1 FROM oa_expense_item i JOIN oa_file f ON f.id=NEW.file_id
 WHERE i.id=NEW.item_id AND i.entity_id=f.entity_id)
BEGIN
 SELECT RAISE(ABORT,'entity: document owner mismatch');
END;

CREATE TRIGGER IF NOT EXISTS oa_leave_attachment_company_insert
BEFORE INSERT ON oa_leave_request
WHEN NEW.attachment_file_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM oa_file f WHERE f.id=NEW.attachment_file_id AND f.entity_id=NEW.entity_id)
BEGIN
 SELECT RAISE(ABORT,'entity: leave attachment mismatch');
END;
CREATE TRIGGER IF NOT EXISTS oa_leave_attachment_company_update
BEFORE UPDATE OF entity_id,attachment_file_id ON oa_leave_request
WHEN NEW.attachment_file_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM oa_file f WHERE f.id=NEW.attachment_file_id AND f.entity_id=NEW.entity_id)
BEGIN
 SELECT RAISE(ABORT,'entity: leave attachment mismatch');
END;

CREATE TRIGGER IF NOT EXISTS oa_claim_receipt_company_insert
BEFORE INSERT ON oa_expense_claim
WHEN NEW.receipt_file_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM oa_file f WHERE f.id=NEW.receipt_file_id AND f.entity_id=NEW.entity_id)
BEGIN
 SELECT RAISE(ABORT,'entity: claim receipt mismatch');
END;
CREATE TRIGGER IF NOT EXISTS oa_claim_receipt_company_update
BEFORE UPDATE OF entity_id,receipt_file_id ON oa_expense_claim
WHEN NEW.receipt_file_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM oa_file f WHERE f.id=NEW.receipt_file_id AND f.entity_id=NEW.entity_id)
BEGIN
 SELECT RAISE(ABORT,'entity: claim receipt mismatch');
END;

CREATE TRIGGER IF NOT EXISTS oa_payslip_attachment_company_insert
BEFORE INSERT ON oa_payslip
WHEN NEW.attachment_file_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM oa_file f WHERE f.id=NEW.attachment_file_id AND f.entity_id=NEW.entity_id)
BEGIN
 SELECT RAISE(ABORT,'entity: payslip attachment mismatch');
END;
CREATE TRIGGER IF NOT EXISTS oa_payslip_attachment_company_update
BEFORE UPDATE OF entity_id,attachment_file_id ON oa_payslip
WHEN NEW.attachment_file_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM oa_file f WHERE f.id=NEW.attachment_file_id AND f.entity_id=NEW.entity_id)
BEGIN
 SELECT RAISE(ABORT,'entity: payslip attachment mismatch');
END;

CREATE TRIGGER IF NOT EXISTS oa_approval_company_insert
BEFORE INSERT ON oa_approval_step
WHEN NOT (
 (NEW.entity_type='leave' AND EXISTS (SELECT 1 FROM oa_leave_request l
   WHERE l.id=NEW.entity_id AND l.entity_id=NEW.company_entity_id))
 OR (NEW.entity_type='expense' AND EXISTS (SELECT 1 FROM oa_expense_claim c
   WHERE c.id=NEW.entity_id AND c.entity_id=NEW.company_entity_id))
)
BEGIN
 SELECT RAISE(ABORT,'entity: approval owner mismatch');
END;
CREATE TRIGGER IF NOT EXISTS oa_approval_company_update
BEFORE UPDATE OF entity_type,entity_id,company_entity_id ON oa_approval_step
WHEN NOT (
 (NEW.entity_type='leave' AND EXISTS (SELECT 1 FROM oa_leave_request l
   WHERE l.id=NEW.entity_id AND l.entity_id=NEW.company_entity_id))
 OR (NEW.entity_type='expense' AND EXISTS (SELECT 1 FROM oa_expense_claim c
   WHERE c.id=NEW.entity_id AND c.entity_id=NEW.company_entity_id))
)
BEGIN
 SELECT RAISE(ABORT,'entity: approval owner mismatch');
END;
