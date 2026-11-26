import {NextRequest,NextResponse} from "next/server";
import {getViewer} from "@/lib/auth-server";
import {all,one,run,audit} from "@/lib/oa/db";
import {getOaEnv} from "@/lib/oa/env";
import {founderId,isOaSuperAdmin,PARTY_PERMISSION,CONTRACT_VIEW_PERMISSION,CONTRACT_UPLOAD_PERMISSION,BILLING_PERMISSION} from "@/lib/oa/admin-permissions";

export const runtime="nodejs";
const ok=(data:unknown)=>NextResponse.json({ok:true,data});
const fail=(error:string,status=400)=>NextResponse.json({ok:false,error},{status});
const email=(x:unknown)=>String(x??"").trim().toLowerCase().slice(0,320);
async function authorized(){
 const viewer=await getViewer();
 if(!viewer)return {error:fail("Unauthorized",401)};
 if(!await isOaSuperAdmin(viewer.id))return {error:fail("Super administrator required",403)};
 return {userId:viewer.id};
}
export async function GET(){
 try{
  const a=await authorized();if(a.error)return a.error;
  const [supers,grants,contractGrants,billingGrants,entities,originalId]=await Promise.all([
   all("SELECT p.user_id,u.name,u.email,p.level,p.created_at FROM oa_platform_administrator p JOIN user u ON u.id=p.user_id ORDER BY CASE WHEN p.level='founder' THEN 0 ELSE 1 END,u.email"),
   all("SELECT p.entity_id,e.display_name,p.user_id,u.name,u.email,p.permission,p.created_at FROM oa_entity_permission p JOIN oa_entity e ON e.id=p.entity_id JOIN user u ON u.id=p.user_id ORDER BY e.display_name,u.email"),
   all("SELECT p.entity_id,e.display_name,p.user_id,u.name,u.email,p.permission,p.created_at FROM oa_contract_permission p JOIN oa_entity e ON e.id=p.entity_id JOIN user u ON u.id=p.user_id ORDER BY e.display_name,u.email,p.permission"),
   all("SELECT p.entity_id,e.display_name,p.user_id,u.name,u.email,p.permission,p.created_at FROM oa_billing_permission p JOIN oa_entity e ON e.id=p.entity_id JOIN user u ON u.id=p.user_id ORDER BY e.display_name,u.email"),
   all("SELECT id,display_name FROM oa_entity WHERE active=1 ORDER BY display_name"),
   founderId(),
  ]);
  return ok({supers,grants,contractGrants,billingGrants,entities,founderId:originalId,currentUserId:a.userId});
 }catch(e){console.error("Administrator listing failed",e);return fail("Administrator listing failed",500);}
}
export async function POST(request:NextRequest){
 try{
  const a=await authorized();if(a.error)return a.error;
  let body:Record<string,unknown>;
  try{body=await request.json()}catch{return fail("Invalid JSON")}
  const action=String(body.action||"");
  if(action!=="setSuperAdmin"&&action!=="setPartyAdmin"&&action!=="setContractPermission"&&action!=="setBillingPermission")return fail("Unsupported action",404);
  const targetEmail=email(body.email);
  if(!targetEmail||!targetEmail.includes("@"))return fail("Exact account email required");
  const user=await one<{id:string;email:string}>("SELECT id,email FROM user WHERE lower(email)=?",[targetEmail]);
  if(!user)return fail("Existing account not found",404);
  if(user.id===await founderId())return fail("Original super administrator is protected",403);
  const enabled=body.enabled===true;
  if(action==="setSuperAdmin"){
   if(user.id===a.userId && !enabled)return fail("You cannot demote your own session",409);
   if(enabled){
    await run("INSERT INTO oa_platform_administrator(user_id,level,granted_by) VALUES(?,'super_admin',?) ON CONFLICT(user_id) DO UPDATE SET level='super_admin',granted_by=excluded.granted_by",[user.id,a.userId]);
   }else{
    await run("DELETE FROM oa_platform_administrator WHERE user_id=? AND level='super_admin'",[user.id]);
   }
   await audit(a.userId,enabled?"oa.superadmin.promote":"oa.superadmin.demote","user",user.id,{targetEmail},'legacy-primary');
   return ok({updated:true});
  }
  if(action==="setBillingPermission"){
   const entityId=String(body.entityId??"").trim();
   if(body.permission!==BILLING_PERMISSION||typeof body.enabled!=="boolean")return fail("Invalid billing permission");
   if(enabled){
    const member=await one("SELECT 1 AS allowed FROM oa_entity_member m JOIN oa_entity e ON e.id=m.entity_id AND e.active=1 JOIN user u ON u.id=m.user_id AND u.disabled_at IS NULL WHERE m.entity_id=? AND m.user_id=? AND m.active=1",[entityId,user.id]);
    if(!member)return fail("Account must have an active Entity membership before billing authorization",409);
    await run("INSERT INTO oa_billing_permission(entity_id,user_id,permission,granted_by) VALUES(?,?,?,?) ON CONFLICT(entity_id,user_id,permission) DO UPDATE SET granted_by=excluded.granted_by,created_at=CURRENT_TIMESTAMP",[entityId,user.id,BILLING_PERMISSION,a.userId]);
   }else{
    await run("DELETE FROM oa_billing_permission WHERE entity_id=? AND user_id=? AND permission=?",[entityId,user.id,BILLING_PERMISSION]);
   }
   await audit(a.userId,enabled?"oa.billing.permission.grant":"oa.billing.permission.revoke","user",user.id,{targetEmail,permission:BILLING_PERMISSION,enabled},entityId);
   return ok({updated:true});
  }
  if(action==="setContractPermission"){
   const entityId=String(body.entityId??"").trim();
   const permission=String(body.permission??"");
   if(permission!==CONTRACT_VIEW_PERMISSION&&permission!==CONTRACT_UPLOAD_PERMISSION)
    return fail("Invalid contract permission");
   const entity=await one<{id:string}>("SELECT id FROM oa_entity WHERE id=? AND active=1",[entityId]);
   if(!entity)return fail("Entity not found",404);
   const member=await one<{active:number}>(
    "SELECT active FROM oa_entity_member WHERE entity_id=? AND user_id=?",[entityId,user.id]);
   if(!member||member.active!==1)return fail("Account must have an active Entity membership before contract authorization",409);
   if(enabled){
    // A contract grant never silently enrolls a user into unrelated OA/HR access.
    await run("INSERT INTO oa_contract_permission(entity_id,user_id,permission,granted_by) VALUES(?,?,?,?) ON CONFLICT(entity_id,user_id,permission) DO UPDATE SET granted_by=excluded.granted_by,created_at=CURRENT_TIMESTAMP",[entityId,user.id,permission,a.userId]);
   }else{
    await run("DELETE FROM oa_contract_permission WHERE entity_id=? AND user_id=? AND permission=?",[entityId,user.id,permission]);
   }
   await audit(a.userId,enabled?"oa.contract.permission.grant":"oa.contract.permission.revoke",
    "user",user.id,{targetEmail,permission,enabled},entityId);
   return ok({updated:true});
  }
  const entityId=String(body.entityId??"").trim();
  const entity=await one<{id:string}>("SELECT id FROM oa_entity WHERE id=? AND active=1",[entityId]);
  if(!entity)return fail("Entity not found",404);
  const member=await one<{active:number}>(
   "SELECT active FROM oa_entity_member WHERE entity_id=? AND user_id=?",[entityId,user.id]);
  if(member?.active===0)return fail("Inactive Entity membership must be reactivated separately",409);
  if(enabled){
   // Enroll an existing account into exactly this Entity, without making it a full Entity administrator.
   const db=getOaEnv().db;
   const batch=[];
   if(!member)batch.push(db.prepare("INSERT INTO oa_entity_member(entity_id,user_id,role,active) VALUES(?,?,'employee',1)").bind(entityId,user.id));
   batch.push(db.prepare("INSERT INTO oa_entity_permission(entity_id,user_id,permission,granted_by) VALUES(?,?,?,?) ON CONFLICT(entity_id,user_id,permission) DO UPDATE SET granted_by=excluded.granted_by,created_at=CURRENT_TIMESTAMP").bind(entityId,user.id,PARTY_PERMISSION,a.userId));
   await db.batch(batch);
  }else{
   await run("DELETE FROM oa_entity_permission WHERE entity_id=? AND user_id=? AND permission=?",[entityId,user.id,PARTY_PERMISSION]);
  }
  await audit(a.userId,enabled?"oa.partyadmin.grant":"oa.partyadmin.revoke","user",user.id,{targetEmail,permission:PARTY_PERMISSION,enabled},entityId);
  return ok({updated:true});
 }catch(e){
  console.error("Administrator permission change failed",e);
  return fail("Administrator permission update failed",500);
 }
}
