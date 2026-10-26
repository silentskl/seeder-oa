-- Phase 1 ONLY: non-destructive entity/membership registry.
-- This does NOT enable multi-entity operations. Existing OA APIs remain single-entity
-- until all business tables, permissions, R2 attachments and workflows are scoped.
CREATE TABLE IF NOT EXISTS oa_entity (
  id TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  registration_no TEXT NOT NULL DEFAULT '',
  base_currency TEXT NOT NULL DEFAULT 'SGD',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS oa_entity_member (
  entity_id TEXT NOT NULL REFERENCES oa_entity(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','employee')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (entity_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_oa_entity_member_user ON oa_entity_member(user_id,active,entity_id);
CREATE INDEX IF NOT EXISTS idx_oa_entity_member_role ON oa_entity_member(entity_id,role,active);
-- Existing records stay in their original tables. This is a mapping anchor,
-- NOT a migration that changes ownership or bypasses current authorization.
INSERT OR IGNORE INTO oa_entity(id,legal_name,display_name,base_currency)
VALUES('legacy-primary','Existing OA Company','Existing OA Company','SGD');
UPDATE oa_entity SET
  legal_name=COALESCE((SELECT NULLIF(trim(company_name),'') FROM oa_settings WHERE id=1),legal_name),
  display_name=COALESCE((SELECT NULLIF(trim(company_name),'') FROM oa_settings WHERE id=1),display_name),
  base_currency=COALESCE((SELECT NULLIF(trim(base_currency),'') FROM oa_settings WHERE id=1),base_currency)
WHERE id='legacy-primary';
INSERT OR IGNORE INTO oa_entity_member(entity_id,user_id,role)
SELECT 'legacy-primary',e.user_id,'employee' FROM oa_employee e
JOIN user u ON u.id=e.user_id;
