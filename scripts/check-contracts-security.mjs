#!/usr/bin/env node
// Source-level contract authorization invariants. Does not replace authenticated E2E tests.
import {readFileSync} from "node:fs";
import {join,resolve} from "node:path";
const root=resolve(process.argv[2]||"overlay");
const read=p=>readFileSync(join(root,p),"utf8");
const upload=read("app/api/oa/contracts/route.ts");
const view=read("app/api/oa/contracts/[id]/route.ts");
const sql=read("migrations/9029_oa_contract_management.sql");
const nav=read("components/oa/oa-shell.tsx");
const helper=read("lib/oa/admin-permissions.ts");
const checks=[
 ["Both contract API methods validate membership and party permission",upload.includes("resolveFinanceEntityAccess(userId,requested)")&&upload.includes('canManageParties(userId,access.entityId,access.role==="admin")')&&upload.includes("authorize(viewer.id,request.nextUrl.searchParams.get")&&upload.includes("authorize(viewer.id,form.get")],
 ["Document view uses same Entity and party-level authorization",view.includes("resolveFinanceEntityAccess(viewer.id")&&view.includes("canManageParties(viewer.id,access.entityId")&&view.includes("WHERE id=? AND entity_id=?")],
 ["Documents stay private and resist MIME sniffing",view.includes('"cache-control":"private, no-store"')&&view.includes('"x-content-type-options":"nosniff"')],
 ["UTF-8 document filenames use a safe ASCII fallback and RFC 5987",view.includes("filename*=UTF-8")&&view.includes("asciiName=name.replace")],
 ["Upload validates an approved same-Entity party and allowed category",upload.includes("WHERE entity_id=? AND root_id=? AND status='approved'")&&upload.includes("party_type=? OR party_type='both'")],
 ["Upload validates file size, MIME and magic bytes",upload.includes("FINANCE_MAX_FILE")&&upload.includes("FINANCE_TYPES.has(type)")&&upload.includes("isFinanceDocumentType(type,bytes)")],
 ["Failed database insert deletes the uploaded object",upload.includes("uploads.delete(key)")],
 ["Entity and party integrity is also protected by SQL triggers",sql.includes("oa_contract_party_insert")&&sql.includes("oa_contract_party_update")&&sql.includes("p.entity_id=NEW.entity_id")&&sql.includes("p.root_id=NEW.party_root_id")],
 ["Contract management is in admin and party-admin menus",nav.includes('["/admin/oa/contracts", "Contracts"]')&&nav.includes('!isAdmin&&isPartyAdmin&&<>')],
 ["Scoped party permission is checked against active membership",helper.includes("m.active=1")&&helper.includes("e.active=1")],
];
let failures=0;
for(const [label,pass] of checks){console.log((pass?"PASS ":"FAIL ")+label);if(!pass)failures++;}
if(failures){console.error(failures+" contract source guards failed");process.exit(1);}
console.log("Contract source guards passed. Real multi-Entity HTTP tests are still required.");
