#!/usr/bin/env node
// Contract ACL source gate. Live authenticated two-Entity tests are still required.
import {readFileSync} from "node:fs";
import {join,resolve} from "node:path";
const root=resolve(process.argv[2]||"overlay");
const read=p=>readFileSync(join(root,p),"utf8");
const upload=read("app/api/oa/contracts/route.ts");
const view=read("app/api/oa/contracts/[id]/route.ts");
const entities=read("app/api/oa/contracts/entities/route.ts");
const permissions=read("lib/oa/admin-permissions.ts");
const grants=read("app/api/oa/administrators/route.ts");
const sql=read("migrations/9029_oa_contract_management.sql");
const aclSql=read("migrations/9030_oa_contract_permissions.sql");
const nav=read("components/oa/oa-shell.tsx");
const layout=read("app/(oa)/layout.tsx");
const ui=read("components/oa/contracts-console.tsx");
const accessUi=read("components/oa/administrator-access.tsx");
const checks=[
 ["Contract permissions are separate from supplier/customer privileges",
  !upload.includes("canManageParties")&&!view.includes("canManageParties")
    &&permissions.includes('CONTRACT_VIEW_PERMISSION="contracts.view"')
    &&permissions.includes('CONTRACT_UPLOAD_PERMISSION="contracts.upload"')],
 ["Entity membership and contract grants are enforced server-side",
  permissions.includes("canAccessContracts(userId:string,entityId:string,permission:ContractPermission)")
    &&permissions.includes("SELECT 1 AS allowed FROM oa_contract_permission p")
    &&permissions.includes("m.active=1")&&permissions.includes("e.active=1")],
 ["Listing requires a contract grant and only reveals documents to viewers",
  upload.includes("if(!canView&&!canUpload)return fail(")
    &&upload.includes("canView?all(")&&upload.includes("canUpload?all(")
    &&upload.includes("canAccessContracts(viewer.id,entity,CONTRACT_VIEW_PERMISSION)")
    &&upload.includes("canAccessContracts(viewer.id,entity,CONTRACT_UPLOAD_PERMISSION)")],
 ["Uploads require the separate contract-upload permission",
  upload.includes('authorize(viewer.id,form.get("entity_id"),CONTRACT_UPLOAD_PERMISSION)')],
 ["Document preview and download both require contract-view permission",
  view.includes("canAccessContracts(viewer.id,access.entityId,CONTRACT_VIEW_PERMISSION)")
    &&view.includes("WHERE id=? AND entity_id=?")],
 ["Contract Entity selector returns only contract-authorized Entities",
  entities.includes("listContractAccessEntities(viewer.id)")
    &&ui.includes('"/api/oa/contracts/entities"')
    &&permissions.includes("FROM oa_contract_permission p")],
 ["Contract upload and library panels respect separate rights",
  ui.includes("canUpload&&<section")&&ui.includes("canView&&<section")],
 ["Contract menu not inherited from admin or party permission",
  !nav.includes('["/admin/oa/contracts", "Contracts"]')
    &&nav.includes("isContractAdmin&&<NavLink")
    &&layout.includes("listContractAccessEntities(viewer.id)")],
 ["Only super administrators can grant and revoke contract permissions",
  grants.includes("if(!await isOaSuperAdmin(viewer.id))")
    &&grants.includes('if(action==="setContractPermission")')
    &&grants.includes("INSERT INTO oa_contract_permission")
    &&grants.includes("DELETE FROM oa_contract_permission")
    &&grants.includes("if(!member||member.active!==1)return fail(")],
 ["Super admin UI has two separately revocable contract permissions",
  accessUi.includes('value="contracts.view"')&&accessUi.includes('value="contracts.upload"')
    &&accessUi.includes('snapshot.contractGrants')],
 ["Database only accepts superadmin-originated contract grants",
  aclSql.includes("oa_contract_grant_super_insert")
    &&aclSql.includes("oa_contract_grant_super_update")
    &&aclSql.includes("FROM oa_platform_administrator a WHERE a.user_id=NEW.granted_by")],
 ["Contract party association is guarded within the same Entity",
  sql.includes("oa_contract_party_insert")&&sql.includes("oa_contract_party_update")
    &&sql.includes("p.entity_id=NEW.entity_id")],
 ["File upload checks size, MIME/signature and object rollback",
  upload.includes("FINANCE_MAX_FILE")&&upload.includes("FINANCE_TYPES.has(type)")
    &&upload.includes("isFinanceDocumentType(type,bytes)")&&upload.includes("uploads.delete(key)")],
 ["Downloads have private cache, nosniff and Unicode filenames",
  view.includes('"cache-control":"private, no-store"')
    &&view.includes('"x-content-type-options":"nosniff"')&&view.includes("filename*=UTF-8")],
];
let failed=0;
for(const [label,ok] of checks){console.log((ok?"PASS ":"FAIL ")+label);if(!ok)failed++;}
if(failed){console.error(failed+" contract security checks failed");process.exit(1);}
console.log("Contract security static checks passed; authenticated two-Entity E2E tests remain required.");
