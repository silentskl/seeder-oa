-- Distinct, least-privilege email connections per company and mailbox.
-- Historical Resend oa_finance_mailbox remains intact for backward compatibility.
CREATE TABLE IF NOT EXISTS oa_finance_mail_account (
 id TEXT PRIMARY KEY,
 entity_id TEXT NOT NULL REFERENCES oa_entity(id) ON DELETE RESTRICT,
 address TEXT NOT NULL COLLATE NOCASE UNIQUE,
 display_name TEXT NOT NULL DEFAULT '',
 provider TEXT NOT NULL CHECK(provider IN ('microsoft365','alibaba_mail')),
 tenant_id TEXT NOT NULL DEFAULT '',
 client_id TEXT NOT NULL,
 client_secret_encrypted TEXT NOT NULL,
 api_base TEXT NOT NULL DEFAULT '',
 folder_id TEXT NOT NULL DEFAULT '',
 sync_interval_minutes INTEGER NOT NULL DEFAULT 5 CHECK(sync_interval_minutes BETWEEN 5 AND 1440),
 initial_lookback_days INTEGER NOT NULL DEFAULT 7 CHECK(initial_lookback_days BETWEEN 1 AND 30),
 active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
 last_attempt_at TEXT,
 last_success_at TEXT,
 last_error TEXT,
 sync_lock_until TEXT,
 created_by TEXT NOT NULL REFERENCES user(id),
 updated_by TEXT NOT NULL REFERENCES user(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS oa_finance_mail_account_due ON oa_finance_mail_account(active,last_attempt_at);
CREATE INDEX IF NOT EXISTS oa_finance_mail_account_company ON oa_finance_mail_account(entity_id,provider);
CREATE TABLE IF NOT EXISTS oa_finance_mail_sync_log(
 id TEXT PRIMARY KEY,
 entity_id TEXT NOT NULL REFERENCES oa_entity(id),
 account_id TEXT NOT NULL REFERENCES oa_finance_mail_account(id),
 started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 finished_at TEXT,
 status TEXT NOT NULL CHECK(status IN ('running','success','error')),
 scanned_count INTEGER NOT NULL DEFAULT 0,
 imported_count INTEGER NOT NULL DEFAULT 0,
 duplicate_count INTEGER NOT NULL DEFAULT 0,
 error_text TEXT
);
CREATE INDEX IF NOT EXISTS oa_finance_mail_sync_log_latest ON oa_finance_mail_sync_log(entity_id,account_id,started_at DESC);
CREATE TRIGGER IF NOT EXISTS oa_finance_mail_sync_log_company_insert BEFORE INSERT ON oa_finance_mail_sync_log
 WHEN NOT EXISTS(SELECT 1 FROM oa_finance_mail_account a WHERE a.id=NEW.account_id AND a.entity_id=NEW.entity_id)
 BEGIN SELECT RAISE(ABORT,'finance email sync company mismatch'); END;
ALTER TABLE oa_finance_invoice ADD COLUMN source_mail_account_id TEXT REFERENCES oa_finance_mail_account(id);
CREATE INDEX IF NOT EXISTS oa_finance_invoice_mail_account ON oa_finance_invoice(entity_id,source_mail_account_id);
CREATE TRIGGER IF NOT EXISTS oa_finance_invoice_mail_company_insert BEFORE INSERT ON oa_finance_invoice
 WHEN NEW.source_mail_account_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM oa_finance_mail_account a WHERE a.id=NEW.source_mail_account_id AND a.entity_id=NEW.entity_id)
 BEGIN SELECT RAISE(ABORT,'finance invoice mail account company mismatch'); END;
CREATE TRIGGER IF NOT EXISTS oa_finance_invoice_mail_company_update BEFORE UPDATE OF source_mail_account_id,entity_id ON oa_finance_invoice
 WHEN NEW.source_mail_account_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM oa_finance_mail_account a WHERE a.id=NEW.source_mail_account_id AND a.entity_id=NEW.entity_id)
 BEGIN SELECT RAISE(ABORT,'finance invoice mail account company mismatch'); END;

-- Mailbox ownership never changes after registration. Disable the old connection
-- and add a new one rather than silently changing the company of stored invoices.
CREATE TRIGGER IF NOT EXISTS oa_finance_mail_account_ownership_update BEFORE UPDATE OF entity_id,address,provider ON oa_finance_mail_account
 WHEN NEW.entity_id<>OLD.entity_id OR NEW.address<>OLD.address OR NEW.provider<>OLD.provider
 BEGIN SELECT RAISE(ABORT,'finance email account ownership immutable'); END;
CREATE TRIGGER IF NOT EXISTS oa_finance_mail_sync_log_company_update BEFORE UPDATE OF entity_id,account_id ON oa_finance_mail_sync_log
 WHEN NOT EXISTS(SELECT 1 FROM oa_finance_mail_account a WHERE a.id=NEW.account_id AND a.entity_id=NEW.entity_id)
 BEGIN SELECT RAISE(ABORT,'finance email sync company mismatch'); END;
