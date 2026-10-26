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
