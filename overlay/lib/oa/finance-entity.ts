import {EntityAccessError,entitySqlLiteral,LEGACY_ENTITY_ID,requireEntityAccess} from "./entity";
import {getOaEnv} from "./env";
import {isOaSuperAdmin} from "./admin-permissions";
import {all} from "./db";
/**
 * Company-scoped finance capability. Does not activate the unfinished
 * multi-entity HR / payroll code paths, or bypass actual membership checks.
 */
export function financeMultiEntityActive(){
 const env=getOaEnv();
 return env.multiEntityBusinessEnabled||env.financeMultiEntityEnabled;
}
export async function resolveFinanceEntityAccess(userId:string,selectedId?:unknown){
 const id=selectedId==null||String(selectedId)===""?LEGACY_ENTITY_ID:String(selectedId);
 entitySqlLiteral(id);
 if(id!==LEGACY_ENTITY_ID&&!financeMultiEntityActive())
  throw new EntityAccessError(403,"Finance multi-company access not enabled");
 return requireEntityAccess(userId,id);
}
export async function listFinanceAdminEntities(userId:string){
 if(await isOaSuperAdmin(userId))return all<{id:string;display_name:string;role:"admin"}>(
  "SELECT id,display_name,'admin' AS role FROM oa_entity WHERE active=1"+
  (financeMultiEntityActive()?"":" AND id='legacy-primary'")+" ORDER BY display_name,id");
 return all<{id:string;display_name:string;role:"admin"|"billing_admin"}>(`SELECT e.id,e.display_name,CASE WHEN m.role='admin' THEN 'admin' ELSE 'billing_admin' END AS role FROM oa_billing_permission p JOIN oa_entity_member m ON m.entity_id=p.entity_id AND m.user_id=p.user_id AND m.active=1 JOIN oa_entity e ON e.id=p.entity_id AND e.active=1 WHERE p.user_id=? AND p.permission='finance.billing.manage' ${financeMultiEntityActive()?"":"AND e.id='legacy-primary'"} ORDER BY e.display_name,e.id`,[userId]);
}
