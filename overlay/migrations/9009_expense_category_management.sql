-- Editable expense categories. Keep existing claim categories as historical data.
CREATE TABLE IF NOT EXISTS oa_expense_category (
 name TEXT PRIMARY KEY COLLATE NOCASE,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 sort_order INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO oa_expense_category(name,sort_order) VALUES
 ('Travel',10),('Meals',20),('Transport',30),('Accommodation',40),
 ('Office',50),('Telecom',60),('Client entertainment',70),
 ('Medical Insurance',80),('Other',90);
INSERT OR IGNORE INTO oa_expense_category(name,sort_order)
SELECT DISTINCT category,1000 FROM oa_expense_claim WHERE category IS NOT NULL AND trim(category)<>'';
INSERT OR IGNORE INTO oa_expense_category(name,sort_order)
SELECT DISTINCT category,1000 FROM oa_expense_item WHERE category IS NOT NULL AND trim(category)<>'';
