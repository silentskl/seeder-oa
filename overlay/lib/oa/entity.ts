import { all, one } from "./db";

export const LEGACY_ENTITY_ID = "legacy-primary";
export type EntityRole = "admin" | "manager" | "employee";
export type EntityAccess = { entityId:string; userId:string; role:EntityRole };

export class EntityAccessError extends Error {
  constructor(public readonly status:403|404, message = "Entity access denied") {
    super(message);
    this.name="EntityAccessError";
  }
}

/** Server-side authorization only. Never derive membership from a client-selected label. */
export async function requireEntityAccess(
  userId:string,
  entityId:string,
  allowedRoles:readonly EntityRole[]=["admin","manager","employee"],
):Promise<EntityAccess> {
  if (!userId || !entityId || !allowedRoles.length) throw new EntityAccessError(403);
  const row=await one<{entity_id:string;role:EntityRole}>(`
    SELECT m.entity_id,m.role FROM oa_entity_member m
    JOIN oa_entity e ON e.id=m.entity_id
    WHERE m.user_id=? AND m.entity_id=? AND m.active=1 AND e.active=1
  `,[userId,entityId]);
  if (!row || !allowedRoles.includes(row.role)) throw new EntityAccessError(403);
  return {entityId:row.entity_id,userId,role:row.role};
}

/** Lists only active memberships; does not authorize access to any OA record. */
export async function listMyEntities(userId:string) {
  if(!userId) return [];
  return all<{id:string;display_name:string;role:EntityRole}>(`
    SELECT e.id,e.display_name,m.role FROM oa_entity_member m
    JOIN oa_entity e ON e.id=m.entity_id
    WHERE m.user_id=? AND m.active=1 AND e.active=1
    ORDER BY e.display_name,e.id
  `,[userId]);
}

/**
 * Phase 2A deployment guard: existing OA continues on the primary Entity.
 * Reject any attempt to request a different entity before every OA query is
 * reworked with entity-scoped ownership. This is NOT a multi-entity release.
 */
export async function requireLegacyOaAccess(userId:string, requestedEntityId?:unknown):Promise<EntityAccess> {
  if(requestedEntityId !== undefined && requestedEntityId !== null &&
      String(requestedEntityId) !== "" && String(requestedEntityId) !== LEGACY_ENTITY_ID) {
    throw new EntityAccessError(403, "Entity access denied");
  }
  return requireEntityAccess(userId, LEGACY_ENTITY_ID);
}

/**
 * Strictly validate an Entity key before using it as a quoted SQL literal.
 * Prefer bound parameters in new queries. This helper is limited to the
 * existing templated OA SQL while converting to company-aware query methods.
 */
export function entitySqlLiteral(entityId:string):string {
  if(entityId!==LEGACY_ENTITY_ID &&
     !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entityId)) {
    throw new EntityAccessError(403,"Invalid Entity");
  }
  return "'" + entityId + "'";
}

/**
 * Until the tenant isolation acceptance suite passes, only the original
 * company can be used for business operations. Stage other Entity records
 * in the database but never expose their data through incomplete handlers.
 */
export async function resolveBusinessEntityAccess(userId:string,selectedId?:unknown):Promise<EntityAccess>{
  const id=selectedId==null||String(selectedId)===""?LEGACY_ENTITY_ID:String(selectedId);
  entitySqlLiteral(id); // validated format even for a requested non-legacy ID
  if(id!==LEGACY_ENTITY_ID)throw new EntityAccessError(403,"Multi-Entity business access is not enabled");
  return requireEntityAccess(userId,id);
}
