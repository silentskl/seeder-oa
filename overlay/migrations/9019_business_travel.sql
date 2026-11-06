-- Travel application budgets are independent of expense claims and existing approval tables.
CREATE TABLE IF NOT EXISTS oa_travel_application(
 id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES oa_entity(id),user_id TEXT NOT NULL REFERENCES user(id),
 destination TEXT NOT NULL,purpose TEXT NOT NULL,currency TEXT NOT NULL,
 total_amount_minor INTEGER NOT NULL CHECK(total_amount_minor>0),
 status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN('submitted','approved','rejected','cancelled')),
 submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 decided_at TEXT,decided_by TEXT REFERENCES user(id),decision_note TEXT
);
CREATE INDEX IF NOT EXISTS oa_travel_user_idx ON oa_travel_application(entity_id,user_id,submitted_at DESC);
CREATE INDEX IF NOT EXISTS oa_travel_status_idx ON oa_travel_application(entity_id,status,submitted_at DESC);
CREATE TABLE IF NOT EXISTS oa_travel_budget_item(
 id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES oa_entity(id),
 application_id TEXT NOT NULL REFERENCES oa_travel_application(id) ON DELETE CASCADE,
 sort_order INTEGER NOT NULL,type TEXT NOT NULL CHECK(type IN('flight','hotel','other')),
 item_name TEXT NOT NULL,description TEXT,departure_at TEXT,arrival_at TEXT,check_in_at TEXT,check_out_at TEXT,
 nights INTEGER CHECK(nights IS NULL OR nights>0),amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 UNIQUE(application_id,sort_order)
);
CREATE INDEX IF NOT EXISTS oa_travel_items_idx ON oa_travel_budget_item(entity_id,application_id,sort_order);
CREATE TABLE IF NOT EXISTS oa_travel_approval_step(
 id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES oa_entity(id),
 application_id TEXT NOT NULL REFERENCES oa_travel_application(id) ON DELETE CASCADE,
 step_no INTEGER NOT NULL CHECK(step_no>0),approver_type TEXT NOT NULL CHECK(approver_type IN('manager','admin')),
 assigned_user_id TEXT REFERENCES user(id),status TEXT NOT NULL CHECK(status IN('waiting','pending','approved','rejected','skipped')),
 decided_at TEXT,decided_by TEXT REFERENCES user(id),note TEXT,UNIQUE(application_id,step_no)
);
CREATE INDEX IF NOT EXISTS oa_travel_step_pending_idx ON oa_travel_approval_step(entity_id,status,assigned_user_id);
CREATE TRIGGER IF NOT EXISTS oa_travel_item_entity_insert BEFORE INSERT ON oa_travel_budget_item
WHEN NOT EXISTS(SELECT 1 FROM oa_travel_application a WHERE a.id=NEW.application_id AND a.entity_id=NEW.entity_id)
BEGIN SELECT RAISE(ABORT,'entity: travel item mismatch'); END;
CREATE TRIGGER IF NOT EXISTS oa_travel_item_entity_update BEFORE UPDATE OF entity_id,application_id ON oa_travel_budget_item
WHEN NOT EXISTS(SELECT 1 FROM oa_travel_application a WHERE a.id=NEW.application_id AND a.entity_id=NEW.entity_id)
BEGIN SELECT RAISE(ABORT,'entity: travel item mismatch'); END;
CREATE TRIGGER IF NOT EXISTS oa_travel_step_entity_insert BEFORE INSERT ON oa_travel_approval_step
WHEN NOT EXISTS(SELECT 1 FROM oa_travel_application a WHERE a.id=NEW.application_id AND a.entity_id=NEW.entity_id)
BEGIN SELECT RAISE(ABORT,'entity: travel step mismatch'); END;
CREATE TRIGGER IF NOT EXISTS oa_travel_step_entity_update BEFORE UPDATE OF entity_id,application_id ON oa_travel_approval_step
WHEN NOT EXISTS(SELECT 1 FROM oa_travel_application a WHERE a.id=NEW.application_id AND a.entity_id=NEW.entity_id)
BEGIN SELECT RAISE(ABORT,'entity: travel step mismatch'); END;
