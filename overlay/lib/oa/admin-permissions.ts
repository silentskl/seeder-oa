import {all,one,run} from "./db";
import {getOaEnv} from "./env";

export type PlatformRole="founder"|"super_admin";
export const PARTY_PERMISSION="finance.parties.manage" as const;
export const CONTRACT_VIEW_PERMISSION="contracts.view" as const;
export const CONTRACT_UPLOAD_PERMISSION="contracts.upload" as const;
export type ContractPermission=typeof CONTRACT_VIEW_PERMISSION|typeof CONTRACT_UPLOAD_PERMISSION;

/** Provision the first authentic owner for fresh databases migrated before sign-up.
 * Never select an arbitrary later administrator, and never change an existing founder.
 */
export async function founderId():Promise<string|null>{
 const current=await one<{user_id:string}>(
  "SELECT user_id FROM oa_platform_administrator WHERE level='founder'");
 if(current)return current.user_id;
 // The initial account might have registered after the migration ran.
 const first=await one<{id:string}>(
  "SELECT id FROM user WHERE role='owner' AND id<>'vcs-bot' ORDER BY rowid LIMIT 1");
 if(!first)return null;
 await run("INSERT OR IGNORE INTO oa_platform_administrator(user_id,level) VALUES(?,'founder')",[first.id]);
 const committed=await one<{user_id:string}>(
  "SELECT user_id FROM oa_platform_administrator WHERE level='founder'");
 return committed?.user_id||null;
}

export async function platformRole(userId:string):Promise<PlatformRole|null>{
 if(!userId)return null;
 await founderId();
 const existing=await one<{level:PlatformRole}>(
  "SELECT level FROM oa_platform_administrator WHERE user_id=?",[userId]);
 return existing?.level||null;
}
export async function isOaSuperAdmin(userId:string){
 return (await platformRole(userId))!==null;
}

export async function canManageParties(userId:string,entityId:string,entityAdmin=false){
 if(entityAdmin||await isOaSuperAdmin(userId))return true;
 const row=await one<{allowed:number}>(`
  SELECT 1 AS allowed FROM oa_entity_permission p
  JOIN oa_entity_member m ON m.entity_id=p.entity_id AND m.user_id=p.user_id AND m.active=1
  JOIN oa_entity e ON e.id=m.entity_id AND e.active=1
  WHERE p.entity_id=? AND p.user_id=? AND p.permission=?
 `,[entityId,userId,PARTY_PERMISSION]);
 return !!row;
}
export async function listPartyManagementEntities(userId:string){
 if(!userId)return [];
 const superAdmin=await isOaSuperAdmin(userId);
 const allowedOther=getOaEnv().multiEntityBusinessEnabled||getOaEnv().financeMultiEntityEnabled;
 if(superAdmin){
  return all<{id:string;display_name:string;role:"admin"}>(`
   SELECT id,display_name,'admin' AS role FROM oa_entity
   WHERE active=1 ${allowedOther?"":"AND id='legacy-primary'"} ORDER BY display_name`);
 }
 return all<{id:string;display_name:string;role:"admin"|"parties_admin"}>(`
  SELECT e.id,e.display_name,
   CASE WHEN m.role='admin' THEN 'admin' ELSE 'parties_admin' END AS role
  FROM oa_entity e JOIN oa_entity_member m ON m.entity_id=e.id
  WHERE m.user_id=? AND m.active=1 AND e.active=1
    ${allowedOther?"":"AND e.id='legacy-primary'"}
    AND (m.role='admin' OR EXISTS(
      SELECT 1 FROM oa_entity_permission p WHERE p.entity_id=e.id
       AND p.user_id=m.user_id AND p.permission='finance.parties.manage'))
  ORDER BY e.display_name
 `,[userId]);
}

// Contract permissions are distinct from Entity admin and party-management roles.
// Only an OA super administrator has implicit access; everyone else requires a
// superadmin-created grant scoped to an active membership in the selected Entity.
export async function canAccessContracts(userId:string,entityId:string,permission:ContractPermission){
 if(!userId||!entityId)return false;
 if(await isOaSuperAdmin(userId))return true;
 const row=await one<{allowed:number}>(`
  SELECT 1 AS allowed FROM oa_contract_permission p
  JOIN oa_entity_member m ON m.entity_id=p.entity_id
     AND m.user_id=p.user_id AND m.active=1
  JOIN oa_entity e ON e.id=m.entity_id AND e.active=1
  WHERE p.entity_id=? AND p.user_id=? AND p.permission=?
 `,[entityId,userId,permission]);
 return !!row;
}
export async function listContractAccessEntities(userId:string){
 if(!userId)return [];
 const otherEnabled=getOaEnv().multiEntityBusinessEnabled||getOaEnv().financeMultiEntityEnabled;
 if(await isOaSuperAdmin(userId))
  return all<{id:string;display_name:string;canView:number;canUpload:number}>(`
   SELECT id,display_name,1 AS canView,1 AS canUpload
   FROM oa_entity WHERE active=1 ${otherEnabled?"":"AND id='legacy-primary'"}
   ORDER BY display_name,id`);
 return all<{id:string;display_name:string;canView:number;canUpload:number}>(`
  SELECT e.id,e.display_name,
   MAX(CASE WHEN p.permission='contracts.view' THEN 1 ELSE 0 END) AS canView,
   MAX(CASE WHEN p.permission='contracts.upload' THEN 1 ELSE 0 END) AS canUpload
  FROM oa_contract_permission p
  JOIN oa_entity_member m ON m.entity_id=p.entity_id
    AND m.user_id=p.user_id AND m.active=1
  JOIN oa_entity e ON e.id=p.entity_id AND e.active=1
  WHERE p.user_id=? ${otherEnabled?"":"AND e.id='legacy-primary'"}
  GROUP BY e.id,e.display_name
  ORDER BY e.display_name,e.id`,[userId]);
}
