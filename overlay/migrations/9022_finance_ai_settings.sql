-- Entity-scoped invoice AI provider settings. Secrets always encrypted with OA_SETTINGS_MASTER_KEY.
CREATE TABLE IF NOT EXISTS oa_finance_ai_settings (
 entity_id TEXT PRIMARY KEY REFERENCES oa_entity(id) ON DELETE RESTRICT,
 base_url TEXT NOT NULL,
 model_name TEXT NOT NULL,
 protocol TEXT NOT NULL DEFAULT 'responses' CHECK(protocol IN ('responses','chat_completions')),
 api_key_encrypted TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 updated_by TEXT NOT NULL REFERENCES user(id),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Only existing/active company administrators can edit via the API; there is no public read of secrets.
