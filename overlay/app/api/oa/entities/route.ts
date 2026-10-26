import { NextRequest, NextResponse } from "next/server";
import { getViewer, isAdminTier } from "@/lib/auth-server";
import { all, one, run } from "@/lib/oa/db";
import { EntityAccessError, listMyEntities, requireEntityAccess } from "@/lib/oa/entity";
import { getOaEnv } from "@/lib/oa/env";

export const runtime="nodejs";
const ok=(data:unknown,status=200)=>NextResponse.json({ok:true,data},{status});
const fail=(error:string,status=400)=>NextResponse.json({ok:false,error},{status});
const clean=(x:unknown,max=200)=>String(x??"").trim().slice(0,max);
type Role="admin"|"manager"|"employee";
const roles=new Set<Role>(["admin","manager","employee"]);

async function managePermission(userId:string,role:string,entityId:string){
  if(isAdminTier(role))return;
  await requireEntityAccess(userId,entityId,["admin"]);
}
function enabled(){return getOaEnv().multiEntityBusinessEnabled}

export async function GET(request:NextRequest){
  const viewer=await getViewer();if(!viewer)return fail("Unauthorized",401);
  const memberships=await listMyEntities(viewer.id);
  if(request.nextUrl.searchParams.get("scope")!=="manage")
    return ok({entities:memberships,multiEntityEnabled:enabled()});
  const platformAdmin=isAdminTier(viewer.role);
  const ids=platformAdmin
    ? await all<{id:string;display_name:string;legal_name:string;active:number}>(`SELECT id,display_name,legal_name,active FROM oa_entity ORDER BY display_name`)
    : await all<{id:string;display_name:string;legal_name:string;active:number}>(`SELECT e.id,e.display_name,e.legal_name,e.active FROM oa_entity e JOIN oa_entity_member m ON m.entity_id=e.id WHERE m.user_id=? AND m.role='admin' AND m.active=1 ORDER BY e.display_name`,[viewer.id]);
  return ok({entities:memberships,manageable:ids,platformAdmin,multiEntityEnabled:enabled()});
}

export async function POST(request:NextRequest){
  const viewer=await getViewer();if(!viewer)return fail("Unauthorized",401);
  if(!enabled())return fail("Multi-Entity management is disabled until isolation acceptance",403);
  let data:Record<string,unknown>;
  try{data=await request.json()}catch{return fail("Invalid JSON")}
  const action=clean(data.action,40),entityId=clean(data.entityId,100);
  const platformAdmin=isAdminTier(viewer.role);
  try{
    if(action==="createEntity"){
      if(!platformAdmin)return fail("Forbidden",403);
      const legalName=clean(data.legalName),displayName=clean(data.displayName)||legalName;
      const currency=clean(data.baseCurrency,3).toUpperCase()||"SGD";
      if(!legalName||!displayName||!/^[A-Z]{3}$/.test(currency))return fail("Invalid company data");
      const id=crypto.randomUUID();
      // One D1 batch is transactional. No partial entity without its settings/role.
      const {db}=getOaEnv();
      await db.batch([
        db.prepare(`INSERT INTO oa_entity(id,legal_name,display_name,registration_no,base_currency) VALUES(?,?,?,?,?)`).bind(id,legalName,displayName,clean(data.registrationNo,100),currency),
        db.prepare(`INSERT INTO oa_entity_settings(entity_id,company_name,base_currency) VALUES(?,?,?)`).bind(id,displayName,currency),
        db.prepare(`INSERT INTO oa_entity_member(entity_id,user_id,role) VALUES(?,?,'admin')`).bind(id,viewer.id),
        db.prepare(`INSERT INTO oa_entity_expense_category(entity_id,name,sort_order) SELECT ?,name,sort_order FROM oa_entity_expense_category WHERE entity_id='legacy-primary' AND active=1`).bind(id),
        db.prepare(`INSERT INTO oa_entity_leave_type(entity_id,code,name,active,deducts_annual,sort_order) SELECT ?,code,name,active,deducts_annual,sort_order FROM oa_entity_leave_type WHERE entity_id='legacy-primary'`).bind(id),
      ]);
      return ok({id},201);
    }
    if(action==="updateEntity"){
      if(!entityId)return fail("entityId is required");
      await managePermission(viewer.id,viewer.role,entityId);
      const name=clean(data.displayName);
      if(!name)return fail("displayName is required");
      const result=await run(`UPDATE oa_entity SET display_name=? WHERE id=?`,[name,entityId]);
      if(!result.meta?.changes)return fail("Entity not found",404);
      await run(`UPDATE oa_entity_settings SET company_name=? WHERE entity_id=?`,[name,entityId]);
      return ok({updated:true});
    }
    if(action==="setMember"){
      if(!entityId)return fail("entityId is required");
      await managePermission(viewer.id,viewer.role,entityId);
      const userId=clean(data.userId,200),role=clean(data.role,20) as Role;
      if(!userId||!roles.has(role))return fail("Valid user and role required");
      if(!await one(`SELECT id FROM user WHERE id=?`,[userId]))return fail("User not found",404);
      const isActive=data.active!==false;
      const existing=await one<{role:string;active:number}>(`SELECT role,active FROM oa_entity_member WHERE entity_id=? AND user_id=?`,[entityId,userId]);
      if(existing?.role==="admin" && (role!=="admin"||!isActive)){
        const admins=await one<{n:number}>(`SELECT COUNT(*) AS n FROM oa_entity_member WHERE entity_id=? AND role='admin' AND active=1`,[entityId]);
        if(Number(admins?.n??0)<=1)return fail("Cannot remove the final Entity admin",409);
      }
      await run(`INSERT INTO oa_entity_member(entity_id,user_id,role,active) VALUES(?,?,?,?) ON CONFLICT(entity_id,user_id) DO UPDATE SET role=excluded.role,active=excluded.active`,[entityId,userId,role,isActive?1:0]);
      return ok({updated:true});
    }
    if(action==="listMembers"){
      if(!entityId)return fail("entityId is required");
      await managePermission(viewer.id,viewer.role,entityId);
      const members=await all(`SELECT m.user_id,u.name,u.email,m.role,m.active FROM oa_entity_member m JOIN user u ON u.id=m.user_id WHERE m.entity_id=? ORDER BY u.name,u.email`,[entityId]);
      return ok({members});
    }
    return fail("Unsupported action",404);
  }catch(e){
    if(e instanceof EntityAccessError)return fail("Forbidden",e.status);
    console.error("Entity management error",e);
    return fail("Entity management request failed",500);
  }
}
