-- Multi-item claims and multi-document associations (v0.1.14 baseline).
CREATE TABLE IF NOT EXISTS oa_expense_item (
 id TEXT PRIMARY KEY,
 claim_id TEXT NOT NULL REFERENCES oa_expense_claim(id) ON DELETE CASCADE,
 sort_order INTEGER NOT NULL DEFAULT 0,
 expense_date TEXT NOT NULL,
 category TEXT NOT NULL,
 description TEXT NOT NULL,
 original_amount_minor INTEGER NOT NULL CHECK(original_amount_minor > 0),
 original_currency TEXT NOT NULL,
 reimbursement_amount_minor INTEGER NOT NULL CHECK(reimbursement_amount_minor >= 0),
 fx_rate REAL NOT NULL,
 fx_rate_date TEXT NOT NULL,
 fx_source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oa_expense_item_claim ON oa_expense_item(claim_id,sort_order);
CREATE TABLE IF NOT EXISTS oa_expense_item_document (
 item_id TEXT NOT NULL REFERENCES oa_expense_item(id) ON DELETE CASCADE,
 file_id TEXT NOT NULL REFERENCES oa_file(id),
 PRIMARY KEY(item_id,file_id)
);
CREATE INDEX IF NOT EXISTS idx_oa_expense_document_file ON oa_expense_item_document(file_id);
INSERT INTO oa_expense_item(id,claim_id,sort_order,expense_date,category,description,original_amount_minor,original_currency,reimbursement_amount_minor,fx_rate,fx_rate_date,fx_source)
SELECT 'legacy-'||id,id,0,expense_date,category,description,original_amount_minor,original_currency,reimbursement_amount_minor,fx_rate,fx_rate_date,fx_source
FROM oa_expense_claim WHERE NOT EXISTS(SELECT 1 FROM oa_expense_item WHERE claim_id=oa_expense_claim.id);
INSERT OR IGNORE INTO oa_expense_item_document(item_id,file_id)
SELECT 'legacy-'||id,receipt_file_id FROM oa_expense_claim WHERE receipt_file_id IS NOT NULL;
