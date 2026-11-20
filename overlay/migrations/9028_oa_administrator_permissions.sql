-- Dedicated OA administration grants. Never elevate Better Auth user.role.
-- Founder is the first real original Seeder owner, excluding the migration sentinel.
CREATE TABLE IF NOT EXISTS oa_platform_administrator (
 user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE RESTRICT,
 level TEXT NOT NULL CHECK(level IN ('founder','super_admin')),
 granted_by TEXT REFERENCES user(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS oa_one_founder
 ON oa_platform_administrator(level) WHERE level='founder';
INSERT OR IGNORE INTO oa_platform_administrator(user_id,level)
 SELECT id,'founder' FROM user WHERE role='owner' AND id<>'vcs-bot'
 ORDER BY rowid LIMIT 1;
-- A founder is never editable via delegated administration, including direct SQL.
CREATE TRIGGER IF NOT EXISTS oa_founder_no_update
 BEFORE UPDATE ON oa_platform_administrator WHEN OLD.level='founder'
 BEGIN SELECT RAISE(ABORT,'original super administrator is immutable'); END;
CREATE TRIGGER IF NOT EXISTS oa_founder_no_delete
 BEFORE DELETE ON oa_platform_administrator WHEN OLD.level='founder'
 BEGIN SELECT RAISE(ABORT,'original super administrator is immutable'); END;
CREATE TABLE IF NOT EXISTS oa_entity_permission (
 entity_id TEXT NOT NULL REFERENCES oa_entity(id) ON DELETE RESTRICT,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
 permission TEXT NOT NULL CHECK(permission IN ('finance.parties.manage')),
 granted_by TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(entity_id,user_id,permission)
);
CREATE INDEX IF NOT EXISTS oa_entity_permission_user
 ON oa_entity_permission(user_id,permission,entity_id);

-- Guard the actual sign-in identity, not just the OA permission row.
-- The original owner cannot be renamed, have their email/role changed or be deleted.
CREATE TRIGGER IF NOT EXISTS oa_founder_user_immutable
 BEFORE UPDATE OF name,email,role ON user
 WHEN OLD.id=(SELECT user_id FROM oa_platform_administrator WHERE level='founder')
 BEGIN SELECT RAISE(ABORT,'original super administrator identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS oa_founder_user_no_delete
 BEFORE DELETE ON user
 WHEN OLD.id=(SELECT user_id FROM oa_platform_administrator WHERE level='founder')
 BEGIN SELECT RAISE(ABORT,'original super administrator identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS oa_founder_member_no_update
 BEFORE UPDATE ON oa_entity_member
 WHEN OLD.user_id=(SELECT user_id FROM oa_platform_administrator WHERE level='founder')
 BEGIN SELECT RAISE(ABORT,'original super administrator membership is immutable'); END;
CREATE TRIGGER IF NOT EXISTS oa_founder_member_no_delete
 BEFORE DELETE ON oa_entity_member
 WHEN OLD.user_id=(SELECT user_id FROM oa_platform_administrator WHERE level='founder')
 BEGIN SELECT RAISE(ABORT,'original super administrator membership is immutable'); END;
