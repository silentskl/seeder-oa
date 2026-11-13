-- Finance is separate from employee expense reimbursement. Every row is entity-scoped.
-- Party changes are versioned: proposed bank details never replace approved details until approval.
CREATE TABLE IF NOT EXISTS oa_finance_party (
 id TEXT PRIMARY KEY,
 entity_id TEXT NOT NULL REFERENCES oa_entity(id),
 root_id TEXT NOT NULL,
 party_type TEXT NOT NULL CHECK(party_type IN ('supplier','customer','both')),
 company_name TEXT NOT NULL,
 address TEXT NOT NULL DEFAULT '',
 contact_name TEXT NOT NULL DEFAULT '',
 email TEXT NOT NULL DEFAULT '',
 phone TEXT NOT NULL DEFAULT '',
 bank_name TEXT NOT NULL DEFAULT '',
 bank_account TEXT NOT NULL DEFAULT '',
 bank_swift TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','superseded')),
 created_by TEXT NOT NULL REFERENCES user(id),
 assigned_approver_user_id TEXT REFERENCES user(id),
 approved_by TEXT REFERENCES user(id),
 approved_at TEXT,
 decision_note TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS oa_finance_party_root ON oa_finance_party(entity_id,root_id,created_at DESC);
CREATE INDEX IF NOT EXISTS oa_finance_party_pending ON oa_finance_party(entity_id,status,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS oa_finance_party_one_active ON oa_finance_party(entity_id,root_id) WHERE status='approved';
CREATE UNIQUE INDEX IF NOT EXISTS oa_finance_party_one_pending ON oa_finance_party(entity_id,root_id) WHERE status='pending';

CREATE TABLE IF NOT EXISTS oa_finance_mailbox (
 entity_id TEXT PRIMARY KEY REFERENCES oa_entity(id),
 address TEXT NOT NULL UNIQUE,
 receive_address TEXT NOT NULL UNIQUE,
 updated_by TEXT NOT NULL REFERENCES user(id),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS oa_finance_document (
 id TEXT PRIMARY KEY,
 entity_id TEXT NOT NULL REFERENCES oa_entity(id),
 purpose TEXT NOT NULL CHECK(purpose IN ('invoice','settlement')),
 r2_key TEXT NOT NULL UNIQUE,
 original_name TEXT NOT NULL,
 content_type TEXT NOT NULL,
 size_bytes INTEGER NOT NULL CHECK(size_bytes>0 AND size_bytes<=12582912),
 uploaded_by TEXT REFERENCES user(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS oa_finance_document_company ON oa_finance_document(entity_id,purpose);

CREATE TABLE IF NOT EXISTS oa_finance_invoice (
 id TEXT PRIMARY KEY,
 entity_id TEXT NOT NULL REFERENCES oa_entity(id),
 direction TEXT NOT NULL CHECK(direction IN ('ar','ap','unknown')),
 party_root_id TEXT,
 counterparty_name TEXT NOT NULL DEFAULT '',
 invoice_number TEXT NOT NULL DEFAULT '',
 invoice_date TEXT,
 due_date TEXT,
 currency TEXT,
 amount_minor INTEGER CHECK(amount_minor>0),
 invoice_bank_account TEXT NOT NULL DEFAULT '',
 invoice_bank_name TEXT NOT NULL DEFAULT '',
 sender_email TEXT NOT NULL DEFAULT '',
 source TEXT NOT NULL CHECK(source IN ('email','manual')),
 source_email_id TEXT,
 source_attachment_id TEXT,
 document_id TEXT NOT NULL REFERENCES oa_finance_document(id),
 bank_check TEXT NOT NULL DEFAULT 'unverified' CHECK(bank_check IN ('match','mismatch','missing','unverified')),
 status TEXT NOT NULL DEFAULT 'needs_review' CHECK(status IN ('needs_review','open','settlement_pending','settled','rejected')),
 extraction_status TEXT NOT NULL DEFAULT 'pending' CHECK(extraction_status IN ('extracted','needs_manual_review','pending')),
 extraction_note TEXT NOT NULL DEFAULT '',
 reviewed_by TEXT REFERENCES user(id),
 reviewed_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(entity_id,source_email_id,source_attachment_id)
);
CREATE INDEX IF NOT EXISTS oa_finance_invoice_queue ON oa_finance_invoice(entity_id,status,due_date,created_at);
CREATE INDEX IF NOT EXISTS oa_finance_invoice_party ON oa_finance_invoice(entity_id,party_root_id);
CREATE UNIQUE INDEX IF NOT EXISTS oa_finance_invoice_no_duplicate ON oa_finance_invoice(entity_id,party_root_id,direction,invoice_number) WHERE status IN ('open','settlement_pending','settled') AND invoice_number<>'';
CREATE TABLE IF NOT EXISTS oa_finance_settlement (
 id TEXT PRIMARY KEY,
 entity_id TEXT NOT NULL REFERENCES oa_entity(id),
 invoice_id TEXT NOT NULL REFERENCES oa_finance_invoice(id),
 document_id TEXT NOT NULL REFERENCES oa_finance_document(id),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 submitted_by TEXT NOT NULL REFERENCES user(id),
 submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 approver_user_id TEXT REFERENCES user(id),
 decided_by TEXT REFERENCES user(id),
 decided_at TEXT,
 note TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS oa_finance_one_pending_settlement ON oa_finance_settlement(entity_id,invoice_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS oa_finance_settlement_queue ON oa_finance_settlement(entity_id,status,submitted_at DESC);

-- Do not permit references to cross-company invoice or file records.
CREATE TRIGGER IF NOT EXISTS oa_finance_invoice_document_insert BEFORE INSERT ON oa_finance_invoice
 WHEN NOT EXISTS(SELECT 1 FROM oa_finance_document d WHERE d.id=NEW.document_id AND d.entity_id=NEW.entity_id AND d.purpose='invoice')
 BEGIN SELECT RAISE(ABORT,'finance invoice document company mismatch'); END;
CREATE TRIGGER IF NOT EXISTS oa_finance_invoice_document_update BEFORE UPDATE OF entity_id,document_id ON oa_finance_invoice
 WHEN NOT EXISTS(SELECT 1 FROM oa_finance_document d WHERE d.id=NEW.document_id AND d.entity_id=NEW.entity_id AND d.purpose='invoice')
 BEGIN SELECT RAISE(ABORT,'finance invoice document company mismatch'); END;
CREATE TRIGGER IF NOT EXISTS oa_finance_settlement_reference_insert BEFORE INSERT ON oa_finance_settlement
 WHEN NOT EXISTS(SELECT 1 FROM oa_finance_invoice i WHERE i.id=NEW.invoice_id AND i.entity_id=NEW.entity_id)
 OR NOT EXISTS(SELECT 1 FROM oa_finance_document d WHERE d.id=NEW.document_id AND d.entity_id=NEW.entity_id AND d.purpose='settlement')
 BEGIN SELECT RAISE(ABORT,'finance settlement company mismatch'); END;
CREATE TRIGGER IF NOT EXISTS oa_finance_settlement_reference_update BEFORE UPDATE OF entity_id,invoice_id,document_id ON oa_finance_settlement
 WHEN NOT EXISTS(SELECT 1 FROM oa_finance_invoice i WHERE i.id=NEW.invoice_id AND i.entity_id=NEW.entity_id)
 OR NOT EXISTS(SELECT 1 FROM oa_finance_document d WHERE d.id=NEW.document_id AND d.entity_id=NEW.entity_id AND d.purpose='settlement')
 BEGIN SELECT RAISE(ABORT,'finance settlement company mismatch'); END;