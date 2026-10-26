import { NextRequest,NextResponse } from "next/server";
import { getViewer,isAdminTier } from "@/lib/auth-server";
import { all,audit,one,run } from "@/lib/oa/db";
import { requireEntityAccess,EntityAccessError } from "@/lib/oa/entity";
import { getOaEnv } from "@/lib/oa/env";
import { sendEntityInvitationEmail } from "@/lib/oa/email";

export const runtime="nodejs";
const ok=(data:unknown,status=200)=>NextResponse.json({ok:true,data},{status,headers:{"cache-control":"no-store"}});
const fail=(error:string,status=400)=>NextResponse.json({ok:false,error},{status,headers:{"cache-control":"no-store"}});
const clean=(v:unknown,max=300)=>String(v??"").trim().slice(0,max);
const validEmail=(s:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
type Invite={id:string;entity_id:string;email:string;role:"admin"|"manager"|"employee";expires_at:string;accepted_at:string|null;revoked_at:string|null};
async function tokenHash(token:string){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("");
}
function active(){return getOaEnv().multiEntityBusinessEnabled}
async function permission(user:{id:string;role:Parameters<typeof isAdminTier>[0]},entityId:string){
  if(isAdminTier(user.role))return;
  await requireEntityAccess(user.id,entityId,["admin"]);
}

export async function GET(request:NextRequest){
  const token=clean(request.nextUrl.searchParams.get("token"),256);
  if(token){
    if(!/^[0-9a-f]{64}$/.test(token))return fail("Invitation unavailable",404);
    const invitation=await one<{email:string;role:string;expires_at:string;display_name:string;accepted_at:string|null;revoked_at:string|null}>(`
      SELECT i.email,i.role,i.expires_at,e.display_name,i.accepted_at,i.revoked_at
      FROM oa_entity_invitation i JOIN oa_entity e ON e.id=i.entity_id
      WHERE i.token_hash=? AND e.active=1`,[await tokenHash(token)]);
    if(!invitation || invitation.revoked_at || invitation.accepted_at || invitation.expires_at<=new Date().toISOString())return fail("Invitation expired or unavailable",404);
    return ok({email:invitation.email,role:invitation.role,company:invitation.display_name,expiresAt:invitation.expires_at});
  }
  const viewer=await getViewer();if(!viewer)return fail("Unauthorized",401);
  const entityId=clean(request.nextUrl.searchParams.get("entity_id"),100);
  if(!entityId)return fail("Entity required");
  try{await permission(viewer,entityId)}catch(e){if(e instanceof EntityAccessError)return fail("Forbidden",403);throw e}
  const rows=await all(`SELECT id,email,role,expires_at,accepted_at,revoked_at,created_at FROM oa_entity_invitation WHERE entity_id=? ORDER BY created_at DESC LIMIT 50`,[entityId]);
  return ok(rows);
}

export async function POST(request:NextRequest){
  const viewer=await getViewer();if(!viewer)return fail("Unauthorized",401);
  if(!active())return fail("Multi-Entity management is disabled",403);
  let body:Record<string,unknown>;
  try{body=await request.json()}catch{return fail("Invalid JSON")}
  const action=clean(body.action,50);
  if(action==="accept"){
    const token=clean(body.token,256);
    if(!/^[0-9a-f]{64}$/.test(token))return fail("Invalid invitation",400);
    const hash=await tokenHash(token);
    const invite=await one<Invite>(`SELECT id,entity_id,email,role,expires_at,accepted_at,revoked_at FROM oa_entity_invitation WHERE token_hash=?`,[hash]);
    if(!invite||invite.revoked_at||invite.accepted_at||invite.expires_at<=new Date().toISOString())return fail("Invitation expired or already used",410);
    const signedIn=await one<{email:string}>(`SELECT email FROM user WHERE id=?`,[viewer.id]);
    if(signedIn?.email?.toLowerCase()!==invite.email.toLowerCase())return fail("Sign in using the invited email address",403);
    const stamp=new Date().toISOString();
    const {db}=getOaEnv();
    const results=await db.batch([
      db.prepare(`UPDATE oa_entity_invitation SET accepted_at=?,accepted_by=? WHERE id=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?`).bind(stamp,viewer.id,invite.id,stamp),
      db.prepare(`INSERT OR IGNORE INTO oa_entity_member(entity_id,user_id,role,active)
        SELECT entity_id,?,role,1 FROM oa_entity_invitation
        WHERE id=? AND accepted_at=? AND accepted_by=?`).bind(viewer.id,invite.id,stamp,viewer.id),
    ]);
    if(!results[0].meta?.changes)return fail("Invitation no longer available",410);
    await audit(viewer.id,"acceptEntityInvitation","entity_invitation",invite.id,{email:invite.email},invite.entity_id);
    return ok({entityId:invite.entity_id,accepted:true});
  }
  const entityId=clean(body.entityId,100);
  if(!entityId)return fail("Entity required");
  try{await permission(viewer,entityId)}catch(e){if(e instanceof EntityAccessError)return fail("Forbidden",403);throw e}
  if(action==="revoke"){
    const id=clean(body.id,100);
    const result=await run(`UPDATE oa_entity_invitation SET revoked_at=CURRENT_TIMESTAMP WHERE id=? AND entity_id=? AND accepted_at IS NULL AND revoked_at IS NULL`,[id,entityId]);
    if(!result.meta?.changes)return fail("Invitation not found",404);
    await audit(viewer.id,"revokeEntityInvitation","entity_invitation",id,null,entityId);
    return ok({revoked:true});
  }
  if(action!=="create")return fail("Unknown action",404);
  const email=clean(body.email,320).toLowerCase(),role=clean(body.role,25);
  if(!validEmail(email)||!["employee","manager","admin"].includes(role))return fail("Valid email and role required");
  if(!await one(`SELECT id FROM oa_entity WHERE id=? AND active=1`,[entityId]))return fail("Company not found",404);
  const existing=await one(`SELECT 1 FROM oa_entity_member m JOIN user u ON u.id=m.user_id WHERE m.entity_id=? AND lower(u.email)=? AND m.active=1`,[entityId,email]);
  if(existing)return fail("User already belongs to this company",409);
  // Never accept a host name from request headers: use the configured canonical URL.
  const origin=getOaEnv().appUrl.trim().replace(/\/$/,"");
  if(!origin || !/^https:\/\//.test(origin))return fail("BETTER_AUTH_URL must be configured to HTTPS before issuing invitations",503);
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  const token=Array.from(bytes,x=>x.toString(16).padStart(2,"0")).join("");
  const id=crypto.randomUUID();
  const expiresAt=new Date(Date.now()+7*24*60*60*1000).toISOString();
  await run(`INSERT INTO oa_entity_invitation(id,entity_id,email,role,token_hash,invited_by,expires_at) VALUES(?,?,?,?,?,?,?)`,[id,entityId,email,role,await tokenHash(token),viewer.id,expiresAt]);
  const url=origin+"/oa-invite?token="+token;
  let emailSent=false,emailError:string|null=null;
  if(body.sendEmail===true){
    try{await sendEntityInvitationEmail(entityId,email,url,role);emailSent=true}
    catch(e){emailError="Email delivery failed. Copy the invitation link to send it manually.";}
  }
  await audit(viewer.id,"createEntityInvitation","entity_invitation",id,{email,role,emailSent},entityId);
  return ok({id,email,role,expiresAt,url,emailSent,emailError},201);
}
