-- Independent super-administrator delegated permissions for confidential contracts.
-- Never reuse supplier/customer editing grants as contract file access.
CREATE TABLE IF NOT EXISTS oa_contract_permission (
 entity_id TEXT NOT NULL REFERENCES oa_entity(id) ON DELETE RESTRICT,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
 permission TEXT NOT NULL CHECK(permission IN ('contracts.view','contracts.upload')),
 granted_by TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(entity_id,user_id,permission)
);
CREATE INDEX IF NOT EXISTS oa_contract_permission_user
 ON oa_contract_permission(user_id,entity_id,permission);
