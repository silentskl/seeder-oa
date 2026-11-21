-- Uploaded contracts belong to one approved supplier/customer root within an Entity.
-- Keep the original party name for an immutable historical display even if party versions change.
CREATE TABLE IF NOT EXISTS oa_contract (
 id TEXT PRIMARY KEY,
 entity_id TEXT NOT NULL REFERENCES oa_entity(id) ON DELETE RESTRICT,
 party_root_id TEXT NOT NULL,
 party_role TEXT NOT NULL CHECK(party_role IN ('supplier','customer')),
 party_name_at_upload TEXT NOT NULL,
 title TEXT NOT NULL CHECK(length(trim(title))>0),
 contract_number TEXT NOT NULL DEFAULT '',
 effective_date TEXT,
 expiry_date TEXT,
 notes TEXT NOT NULL DEFAULT '',
 r2_key TEXT NOT NULL UNIQUE,
 original_name TEXT NOT NULL,
 content_type TEXT NOT NULL CHECK(content_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
 size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 12582912),
 uploaded_by TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(effective_date IS NULL OR expiry_date IS NULL OR effective_date<=expiry_date)
);
CREATE INDEX IF NOT EXISTS oa_contract_entity_created ON oa_contract(entity_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS oa_contract_party ON oa_contract(entity_id,party_root_id,created_at DESC);

-- Enforce source-party ownership in the database, not only in API parameter checks.
CREATE TRIGGER IF NOT EXISTS oa_contract_party_insert
 BEFORE INSERT ON oa_contract
 WHEN NOT EXISTS(
  SELECT 1 FROM oa_finance_party p
  WHERE p.entity_id=NEW.entity_id AND p.root_id=NEW.party_root_id
    AND p.status='approved' AND (p.party_type=NEW.party_role OR p.party_type='both')
 )
 BEGIN SELECT RAISE(ABORT,'contract party must be approved in the same Entity and role'); END;
CREATE TRIGGER IF NOT EXISTS oa_contract_party_update
 BEFORE UPDATE OF entity_id,party_root_id,party_role ON oa_contract
 WHEN NOT EXISTS(
  SELECT 1 FROM oa_finance_party p
  WHERE p.entity_id=NEW.entity_id AND p.root_id=NEW.party_root_id
    AND p.status='approved' AND (p.party_type=NEW.party_role OR p.party_type='both')
 )
 BEGIN SELECT RAISE(ABORT,'contract party must be approved in the same Entity and role'); END;
