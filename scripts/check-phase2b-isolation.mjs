#!/usr/bin/env node
// Static deployment guard for high-risk OA tenant isolation paths.
// This supplements, not replaces, two-Entity integration and R2 security tests.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const dir=process.argv[2] || 'overlay';
function read(path){return readFileSync(resolve(dir,path),'utf8')}
const api=read('app/api/oa/route.ts');
const files=read('app/api/oa/files/[id]/route.ts');
const approval=read('lib/oa/approval.ts');
const db=read('lib/oa/db.ts');
const entity=read('lib/oa/entity.ts');
const email=read('lib/oa/email.ts');
const leave=read('lib/oa/leave.ts');
const checks=[
 ['OA GET/POST resolve server membership', (api.match(/resolveBusinessEntityAccess\(viewer\.id/g)||[]).length===2],
 ['Company admin derived from membership, not global Seeder role',/const admin = access\.role==="admin"/.test(api) && !/isAdminTier/.test(api)],
 ['Employee profile keyed to entity + user',/oa_entity_employee WHERE user_id=\? AND entity_id=\?/.test(api)],
 ['Manager status computed from entity employee profiles',/COUNT\(\*\) AS n FROM oa_entity_employee WHERE manager_user_id=\? AND entity_id=\?/.test(api)],
 ['Approvals scoped to both record and workflow company',/s\.company_entity_id=\$\{companySql\}/.test(api) && /l\.entity_id=\$\{companySql\}/.test(api)],
 ['Expense + receipt ownership verified within entity',/SELECT owner_user_id,kind FROM oa_file WHERE id=\? AND entity_id=\?/.test(api)],
 ['Payslip update scoped',/UPDATE oa_payslip SET status='published'.*WHERE id=\? AND entity_id=\?/.test(api)],
 ['Company settings table used',/FROM oa_entity_settings WHERE entity_id=\?/.test(db)],
 ['Company leave catalog used',/oa_entity_leave_type/.test(api)],
 ['Company category catalog used',/oa_entity_expense_category/.test(api)],
 ['Company holiday catalog used',/oa_entity_holiday WHERE entity_id=\?/.test(leave)],
 ['Expense approval workflow company scoped',/company_entity_id/.test(approval)&&/sourceTable/.test(approval)],
 ['Email notification accepts company context',/notifySubmitted\(entityType: ApprovalEntity, entityId: string, companyId/.test(email)],
 ['Attachment upload membership scoped',/oa_entity_member WHERE entity_id=\? AND user_id=\? AND active=1/.test(files)],
 ['Attachment download ownership scoped',/SELECT \* FROM oa_file WHERE id=\? AND entity_id=\?/.test(files)],
 ['R2 keys segregated by company',/oa\/\$\{companyId\}\/\$\{ownerUserId\}/.test(files)],
 ['Tenant disabled unless feature flag explicitly enabled',/id!==LEGACY_ENTITY_ID && !getOaEnv\(\)\.multiEntityBusinessEnabled/.test(entity)],
];
let fail=0;
for(const [label,pass] of checks){console.log((pass?'PASS ':'FAIL ')+label);if(!pass)fail++}
if(fail){console.error('OA Phase 2B static isolation guard failed: '+fail);process.exit(1)}
console.log('Static Phase 2B guard passed. Live two-Entity integration testing is still required.');
