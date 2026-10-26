-- Phase 2B staging: independent settings, expense category and holiday namespaces.
-- The existing single-company API remains on its legacy settings tables until
-- all business endpoints receive explicit company context.
CREATE TABLE IF NOT EXISTS oa_entity_settings (
 entity_id TEXT PRIMARY KEY REFERENCES oa_entity(id) ON DELETE RESTRICT,
 company_name TEXT NOT NULL,
 base_currency TEXT NOT NULL DEFAULT 'SGD',
 fx_provider TEXT NOT NULL DEFAULT 'frankfurter',
 default_annual_leave_days INTEGER NOT NULL DEFAULT 14,
 leave_approval_flow TEXT NOT NULL DEFAULT 'manager_admin',
 expense_approval_flow TEXT NOT NULL DEFAULT 'manager_admin',
 email_enabled INTEGER NOT NULL DEFAULT 0,
 email_provider TEXT NOT NULL DEFAULT 'resend',
 email_from_name TEXT NOT NULL DEFAULT 'OA Notifications',
 email_from_address TEXT,
 email_reply_to TEXT,
 email_api_key_encrypted TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO oa_entity_settings (
 entity_id,company_name,base_currency,fx_provider,default_annual_leave_days,
 leave_approval_flow,expense_approval_flow,email_enabled,email_provider,
 email_from_name,email_from_address,email_reply_to,email_api_key_encrypted
)
SELECT 'legacy-primary',company_name,base_currency,fx_provider,
 default_annual_leave_days,leave_approval_flow,expense_approval_flow,
 email_enabled,email_provider,email_from_name,email_from_address,email_reply_to,
 email_api_key_encrypted FROM oa_settings WHERE id=1;

CREATE TABLE IF NOT EXISTS oa_entity_expense_category (
 entity_id TEXT NOT NULL REFERENCES oa_entity(id) ON DELETE RESTRICT,
 name TEXT NOT NULL COLLATE NOCASE,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 sort_order INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(entity_id,name)
);
INSERT OR IGNORE INTO oa_entity_expense_category(entity_id,name,active,sort_order,created_at)
SELECT 'legacy-primary',name,active,sort_order,created_at FROM oa_expense_category;
CREATE INDEX IF NOT EXISTS idx_entity_category_active ON oa_entity_expense_category(entity_id,active,sort_order);

CREATE TABLE IF NOT EXISTS oa_entity_holiday (
 id TEXT NOT NULL PRIMARY KEY,
 entity_id TEXT NOT NULL REFERENCES oa_entity(id) ON DELETE RESTRICT,
 holiday_date TEXT NOT NULL,
 name TEXT NOT NULL,
 created_by TEXT,
 UNIQUE(entity_id,holiday_date)
);
INSERT OR IGNORE INTO oa_entity_holiday(id,entity_id,holiday_date,name,created_by)
SELECT id,'legacy-primary',holiday_date,name,created_by FROM oa_holiday;

-- This migration does not change legacy oa_settings or oa_holiday in place.
-- No new entity can become active until the application reads/writes these
-- company-scoped tables exclusively and the isolation suite passes.

-- Preserve legacy UI writes while reads transition to entity settings.
CREATE TRIGGER IF NOT EXISTS oa_legacy_settings_to_entity_update
AFTER UPDATE ON oa_settings WHEN NEW.id=1
BEGIN
 INSERT INTO oa_entity_settings(entity_id,company_name,base_currency,fx_provider,default_annual_leave_days,leave_approval_flow,expense_approval_flow,email_enabled,email_provider,email_from_name,email_from_address,email_reply_to,email_api_key_encrypted,updated_at)
 VALUES('legacy-primary',NEW.company_name,NEW.base_currency,NEW.fx_provider,NEW.default_annual_leave_days,NEW.leave_approval_flow,NEW.expense_approval_flow,NEW.email_enabled,NEW.email_provider,NEW.email_from_name,NEW.email_from_address,NEW.email_reply_to,NEW.email_api_key_encrypted,CURRENT_TIMESTAMP)
 ON CONFLICT(entity_id) DO UPDATE SET
 company_name=excluded.company_name,
 base_currency=excluded.base_currency,
 fx_provider=excluded.fx_provider,
 default_annual_leave_days=excluded.default_annual_leave_days,
 leave_approval_flow=excluded.leave_approval_flow,
 expense_approval_flow=excluded.expense_approval_flow,
 email_enabled=excluded.email_enabled,
 email_provider=excluded.email_provider,
 email_from_name=excluded.email_from_name,
 email_from_address=excluded.email_from_address,
 email_reply_to=excluded.email_reply_to,
 email_api_key_encrypted=excluded.email_api_key_encrypted,
 updated_at=CURRENT_TIMESTAMP;
END;
