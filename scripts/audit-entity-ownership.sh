#!/usr/bin/env bash
# Read-only production D1 ownership discovery. No UPDATE / migration / deletion.
set -euo pipefail
APP="${1:-./seeder-oa-app}"
cd "$APP"
for sql in \
 "SELECT id,display_name,legal_name FROM oa_entity ORDER BY id;" \
 "SELECT entity_id,COUNT(*) AS employees FROM oa_entity_employee GROUP BY entity_id ORDER BY entity_id;" \
 "SELECT entity_id,status,COUNT(*) AS claims FROM oa_expense_claim GROUP BY entity_id,status ORDER BY entity_id,status;" \
 "SELECT c.entity_id,lower(substr(u.email,instr(u.email,'@')+1)) AS email_domain,COUNT(*) AS claims,COUNT(DISTINCT c.user_id) AS employees FROM oa_expense_claim c JOIN user u ON u.id=c.user_id GROUP BY c.entity_id,email_domain ORDER BY c.entity_id,claims DESC;" \
 "SELECT p.entity_id,lower(substr(u.email,instr(u.email,'@')+1)) AS email_domain,COUNT(*) AS payslips FROM oa_payslip p JOIN user u ON u.id=p.user_id GROUP BY p.entity_id,email_domain ORDER BY p.entity_id,payslips DESC;" \
 "SELECT entity_id,role,COUNT(*) AS members FROM oa_entity_member WHERE active=1 GROUP BY entity_id,role ORDER BY entity_id,role;"
do
  echo "===== Read-only Entity audit ====="
  npx wrangler d1 execute PM_DB --remote --command="$sql"
done
echo "[AUDIT] No data changed. Email domains are clues, NOT authoritative Entity ownership."
