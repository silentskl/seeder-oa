-- Per-company, sanitized AI request diagnostics. Never store API keys, prompts or invoice contents.
CREATE TABLE IF NOT EXISTS oa_finance_ai_call_log (
 id TEXT PRIMARY KEY,
 entity_id TEXT NOT NULL REFERENCES oa_entity(id),
 invoice_id TEXT REFERENCES oa_finance_invoice(id),
 model_name TEXT NOT NULL,
 protocol TEXT NOT NULL CHECK(protocol IN ('responses','chat_completions')),
 operation TEXT NOT NULL CHECK(operation IN ('test','invoice')),
 outcome TEXT NOT NULL CHECK(outcome IN ('success','failed','incomplete','invalid_json','empty_output')),
 http_status INTEGER,
 response_status TEXT NOT NULL DEFAULT '',
 finish_reason TEXT NOT NULL DEFAULT '',
 output_types TEXT NOT NULL DEFAULT '',
 duration_ms INTEGER,
 input_tokens INTEGER,
 output_tokens INTEGER,
 output_chars INTEGER,
 request_id TEXT NOT NULL DEFAULT '',
 error_code TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS oa_finance_ai_call_log_company ON oa_finance_ai_call_log(entity_id,created_at DESC);
CREATE INDEX IF NOT EXISTS oa_finance_ai_call_log_invoice ON oa_finance_ai_call_log(entity_id,invoice_id,created_at DESC);
CREATE TRIGGER IF NOT EXISTS oa_finance_ai_call_company_insert BEFORE INSERT ON oa_finance_ai_call_log
 WHEN NEW.invoice_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM oa_finance_invoice i WHERE i.id=NEW.invoice_id AND i.entity_id=NEW.entity_id)
 BEGIN SELECT RAISE(ABORT,'finance AI log company mismatch'); END;
CREATE TRIGGER IF NOT EXISTS oa_finance_ai_call_company_update BEFORE UPDATE OF invoice_id,entity_id ON oa_finance_ai_call_log
 WHEN NEW.invoice_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM oa_finance_invoice i WHERE i.id=NEW.invoice_id AND i.entity_id=NEW.entity_id)
 BEGIN SELECT RAISE(ABORT,'finance AI log company mismatch'); END;
