-- Explicit super-administrator AR/AP grants, no automatic backfill.
CREATE TABLE IF NOT EXISTS oa_billing_permission (
 entity_id TEXT NOT NULL REFERENCES oa_entity(id) ON DELETE RESTRICT,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
 permission TEXT NOT NULL CHECK(permission IN ('finance.billing.manage')),
 granted_by TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(entity_id,user_id,permission)
);
CREATE INDEX IF NOT EXISTS oa_billing_permission_user
 ON oa_billing_permission(user_id,entity_id,permission);

-- Reject unauthorized direct inserts or changes to a delegated billing grant.
-- Demoting a grantor later does not invalidate a previously reviewed grant.
CREATE TRIGGER IF NOT EXISTS oa_billing_grant_super_insert
 BEFORE INSERT ON oa_billing_permission
 WHEN NOT EXISTS(SELECT 1 FROM oa_platform_administrator a WHERE a.user_id=NEW.granted_by)
 BEGIN SELECT RAISE(ABORT,'billing privileges require super administrator authorization'); END;
CREATE TRIGGER IF NOT EXISTS oa_billing_grant_super_update
 BEFORE UPDATE ON oa_billing_permission
 WHEN NOT EXISTS(SELECT 1 FROM oa_platform_administrator a WHERE a.user_id=NEW.granted_by)
 BEGIN SELECT RAISE(ABORT,'billing privileges require super administrator authorization'); END;

CREATE TRIGGER IF NOT EXISTS oa_billing_grant_member_insert BEFORE INSERT ON oa_billing_permission WHEN NOT EXISTS(SELECT 1 FROM oa_entity_member m JOIN oa_entity e ON e.id=m.entity_id AND e.active=1 WHERE m.entity_id=NEW.entity_id AND m.user_id=NEW.user_id AND m.active=1) BEGIN SELECT RAISE(ABORT,'billing privileges require active Entity membership'); END;

CREATE TRIGGER IF NOT EXISTS oa_billing_grant_member_update BEFORE UPDATE ON oa_billing_permission WHEN NOT EXISTS(SELECT 1 FROM oa_entity_member m JOIN oa_entity e ON e.id=m.entity_id AND e.active=1 WHERE m.entity_id=NEW.entity_id AND m.user_id=NEW.user_id AND m.active=1) BEGIN SELECT RAISE(ABORT,'billing privileges require active Entity membership'); END;
