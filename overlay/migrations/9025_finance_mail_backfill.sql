-- Resumable, date-bounded financial mail history backfills.
-- Independent of oa_finance_mail_account.last_success_at: incremental sync checkpoints are never reset.
CREATE TABLE IF NOT EXISTS oa_finance_mail_backfill (
 id TEXT PRIMARY KEY,
 entity_id TEXT NOT NULL REFERENCES oa_entity(id) ON DELETE RESTRICT,
 account_id TEXT NOT NULL REFERENCES oa_finance_mail_account(id) ON DELETE RESTRICT,
 date_from TEXT NOT NULL CHECK(length(date_from)=10),
 date_to TEXT NOT NULL CHECK(length(date_to)=10),
 status TEXT NOT NULL DEFAULT 'queued'
  CHECK(status IN ('queued','running','paused','completed','failed','cancelled')),
 page_cursor TEXT,
 message_offset INTEGER NOT NULL DEFAULT 0 CHECK(message_offset>=0),
 pages_processed INTEGER NOT NULL DEFAULT 0 CHECK(pages_processed>=0),
 messages_scanned INTEGER NOT NULL DEFAULT 0 CHECK(messages_scanned>=0),
 invoices_imported INTEGER NOT NULL DEFAULT 0 CHECK(invoices_imported>=0),
 duplicates_skipped INTEGER NOT NULL DEFAULT 0 CHECK(duplicates_skipped>=0),
 other_skipped INTEGER NOT NULL DEFAULT 0 CHECK(other_skipped>=0),
 retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count>=0),
 next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 lease_until TEXT,
 last_error TEXT,
 created_by TEXT NOT NULL REFERENCES user(id),
 updated_by TEXT NOT NULL REFERENCES user(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 finished_at TEXT,
 CHECK(date_from<=date_to),
 CHECK(length(page_cursor)<=8000 OR page_cursor IS NULL)
);
CREATE INDEX IF NOT EXISTS oa_finance_mail_backfill_due
 ON oa_finance_mail_backfill(status,next_attempt_at,lease_until,created_at);
CREATE INDEX IF NOT EXISTS oa_finance_mail_backfill_company
 ON oa_finance_mail_backfill(entity_id,account_id,created_at DESC);
-- Avoid two overlapping history jobs against the same mailbox; paused jobs reserve their place.
CREATE UNIQUE INDEX IF NOT EXISTS oa_finance_mail_backfill_one_active
 ON oa_finance_mail_backfill(account_id)
 WHERE status IN ('queued','running','paused');
CREATE TRIGGER IF NOT EXISTS oa_finance_mail_backfill_company_insert BEFORE INSERT ON oa_finance_mail_backfill
 WHEN NOT EXISTS (SELECT 1 FROM oa_finance_mail_account a WHERE a.id=NEW.account_id AND a.entity_id=NEW.entity_id)
 BEGIN SELECT RAISE(ABORT,'finance mail backfill company mismatch'); END;
CREATE TRIGGER IF NOT EXISTS oa_finance_mail_backfill_company_update BEFORE UPDATE OF account_id,entity_id ON oa_finance_mail_backfill
 WHEN NOT EXISTS (SELECT 1 FROM oa_finance_mail_account a WHERE a.id=NEW.account_id AND a.entity_id=NEW.entity_id)
 BEGIN SELECT RAISE(ABORT,'finance mail backfill company mismatch'); END;
