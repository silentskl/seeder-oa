-- Per-company generation controls for routine invoice extraction.
-- "auto" means omit the field for most gateways; DeepSeek defaults to
-- no reasoning, to avoid burning a full output budget before emitting JSON.
ALTER TABLE oa_finance_ai_settings
 ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT 'auto'
 CHECK(reasoning_effort IN ('auto','none','low','medium','high'));
