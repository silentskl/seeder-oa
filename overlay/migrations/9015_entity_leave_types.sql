-- Company-scoped leave type catalog. Preserve original legacy catalog.
CREATE TABLE IF NOT EXISTS oa_entity_leave_type (
 entity_id TEXT NOT NULL REFERENCES oa_entity(id) ON DELETE RESTRICT,
 code TEXT NOT NULL,
 name TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 deducts_annual INTEGER NOT NULL DEFAULT 1 CHECK(deducts_annual IN (0,1)),
 sort_order INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(entity_id,code)
);
INSERT OR IGNORE INTO oa_entity_leave_type(entity_id,code,name,active,deducts_annual,sort_order)
SELECT 'legacy-primary',code,name,active,deducts_annual,sort_order FROM oa_leave_type;
CREATE INDEX IF NOT EXISTS idx_oa_entity_leave_type_active ON oa_entity_leave_type(entity_id,active,sort_order);
