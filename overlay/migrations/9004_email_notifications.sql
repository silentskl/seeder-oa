-- Seeder OA v0.1.8: configurable approval email notifications.

ALTER TABLE oa_settings ADD COLUMN email_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE oa_settings ADD COLUMN email_provider TEXT NOT NULL DEFAULT 'resend';
ALTER TABLE oa_settings ADD COLUMN email_from_name TEXT NOT NULL DEFAULT 'OA Notifications';
ALTER TABLE oa_settings ADD COLUMN email_from_address TEXT;
ALTER TABLE oa_settings ADD COLUMN email_reply_to TEXT;
ALTER TABLE oa_settings ADD COLUMN email_api_key_encrypted TEXT;

CREATE TABLE IF NOT EXISTS oa_email_log (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  recipient_email TEXT NOT NULL,
  recipient_user_id TEXT,
  subject TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'resend',
  provider_message_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent','failed','skipped')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (recipient_user_id) REFERENCES user(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS oa_email_log_created_idx ON oa_email_log(created_at DESC);
CREATE INDEX IF NOT EXISTS oa_email_log_entity_idx ON oa_email_log(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS oa_email_log_event_idx ON oa_email_log(event_key, recipient_email);
