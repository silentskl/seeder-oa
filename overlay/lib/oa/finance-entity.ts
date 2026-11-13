import {EntityAccessError,entitySqlLiteral,LEGACY_ENTITY_ID,requireEntityAccess,listMyEntities} from "./entity";
import {getOaEnv} from "./env";
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
 const entities=await listMyEntities(userId);
 return entities.filter(e=>e.role==="admin"&&(e.id===LEGACY_ENTITY_ID||financeMultiEntityActive()));
}
