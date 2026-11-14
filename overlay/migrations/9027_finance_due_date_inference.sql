-- Keep inferred payment terms distinguishable from dates stated in the invoice.
-- Existing invoices are not modified; the default applies only to future AI extraction
-- and re-extraction or subsequent manual review.
ALTER TABLE oa_finance_invoice ADD COLUMN invoice_bank_swift TEXT NOT NULL DEFAULT '';
ALTER TABLE oa_finance_invoice ADD COLUMN due_date_inferred INTEGER NOT NULL DEFAULT 0
 CHECK(due_date_inferred IN (0,1));
CREATE INDEX IF NOT EXISTS oa_finance_invoice_inferred_due
 ON oa_finance_invoice(entity_id,due_date_inferred,status,due_date);
