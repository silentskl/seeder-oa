-- Company-scoped invitations to existing and not-yet-registered users.
-- Only SHA-256 token digests are persisted; never store or log the raw bearer token.
CREATE TABLE IF NOT EXISTS oa_entity_invitation (
 id TEXT PRIMARY KEY,
 entity_id TEXT NOT NULL REFERENCES oa_entity(id) ON DELETE RESTRICT,
 email TEXT NOT NULL COLLATE NOCASE,
 role TEXT NOT NULL CHECK(role IN ('admin','manager','employee')),
 token_hash TEXT NOT NULL UNIQUE,
 invited_by TEXT NOT NULL REFERENCES user(id),
 expires_at TEXT NOT NULL,
 accepted_by TEXT REFERENCES user(id),
 accepted_at TEXT,
 revoked_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ((accepted_at IS NULL AND accepted_by IS NULL) OR (accepted_at IS NOT NULL AND accepted_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_oa_invitation_entity ON oa_entity_invitation(entity_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oa_invitation_email ON oa_entity_invitation(email,expires_at);
