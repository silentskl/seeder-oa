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

-- Reject unauthorized direct inserts or changes to a delegated contract grant.
-- Demoting a grantor later does not invalidate a previously reviewed grant.
CREATE TRIGGER IF NOT EXISTS oa_contract_grant_super_insert
 BEFORE INSERT ON oa_contract_permission
 WHEN NOT EXISTS(SELECT 1 FROM oa_platform_administrator a WHERE a.user_id=NEW.granted_by)
 BEGIN SELECT RAISE(ABORT,'contract privileges require super administrator authorization'); END;
CREATE TRIGGER IF NOT EXISTS oa_contract_grant_super_update
 BEFORE UPDATE ON oa_contract_permission
 WHEN NOT EXISTS(SELECT 1 FROM oa_platform_administrator a WHERE a.user_id=NEW.granted_by)
 BEGIN SELECT RAISE(ABORT,'contract privileges require super administrator authorization'); END;
