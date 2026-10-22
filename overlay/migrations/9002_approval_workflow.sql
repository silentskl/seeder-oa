-- Seeder OA v0.1.4: configurable leave and expense approval workflows.

ALTER TABLE oa_settings ADD COLUMN leave_approval_flow TEXT NOT NULL DEFAULT 'manager_admin';
ALTER TABLE oa_settings ADD COLUMN expense_approval_flow TEXT NOT NULL DEFAULT 'manager_admin';

CREATE TABLE IF NOT EXISTS oa_approval_step (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('leave','expense')),
  entity_id TEXT NOT NULL,
  step_no INTEGER NOT NULL CHECK (step_no > 0),
  approver_type TEXT NOT NULL CHECK (approver_type IN ('manager','admin')),
  assigned_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','pending','approved','rejected','skipped')),
  decided_at TEXT,
  decided_by TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(entity_type, entity_id, step_no),
  FOREIGN KEY (assigned_user_id) REFERENCES user(id) ON DELETE SET NULL,
  FOREIGN KEY (decided_by) REFERENCES user(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS oa_approval_pending_idx ON oa_approval_step(status, approver_type, assigned_user_id);
CREATE INDEX IF NOT EXISTS oa_approval_entity_idx ON oa_approval_step(entity_type, entity_id, step_no);
