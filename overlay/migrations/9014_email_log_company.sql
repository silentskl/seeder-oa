-- Store tenant ownership of notification delivery audit independently from
-- oa_email_log.entity_id, which refers to an expense/leave/request record.
ALTER TABLE oa_email_log ADD COLUMN company_entity_id TEXT NOT NULL DEFAULT 'legacy-primary';
CREATE INDEX IF NOT EXISTS idx_oa_email_log_company ON oa_email_log(company_entity_id,created_at);
