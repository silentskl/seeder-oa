import {resolveFinanceEntityAccess} from "@/lib/oa/finance-entity";
import {NextRequest,NextResponse} from "next/server";
import {getViewer} from "@/lib/auth-server";
import {all,audit,one,run} from "@/lib/oa/db";
import {EntityAccessError} from "@/lib/oa/entity";
import {encryptEmailSecret} from "@/lib/oa/email";
import {getOaEnv} from "@/lib/oa/env";
import {clean,mailAddress} from "@/lib/oa/finance";
import {MailAccount,MailProvider,ALIBABA_BASES,syncMailAccount,testMailAccount} from "@/lib/oa/finance-mail-sync";
export const runtime="nodejs";
const ok=(data:unknown,status=200)=>NextResponse.json({ok:true,data},{status});
const fail=(error:string,status=400)=>NextResponse.json({ok:false,error},{status});
function publicAccount(a:MailAccount){const {client_secret_encrypted,...fields}=a;return {...fields,credential_configured:!!client_secret_encrypted};}
function validateMailSettings(b:any,previous?:MailAccount){
 const provider=String(previous?.provider||b.provider) as MailProvider;
 if(!["microsoft365","alibaba_mail"].includes(provider))throw new Error("Invalid mail provider");
 if(previous&&(b.provider&&b.provider!==previous.provider||b.address&&mailAddress(b.address)!==previous.address))throw new Error("Mailbox address/provider cannot be changed; disable and add a new account");
 const address=previous?.address||mailAddress(b.address);
 if(!address)throw new Error("Invalid email address");
 const clientId=clean(b.client_id===undefined?previous?.client_id:b.client_id,300);
 const tenantId=clean(b.tenant_id===undefined?previous?.tenant_id:b.tenant_id,100);
 if(!clientId)throw new Error("Missing application client ID");
 if(provider==="microsoft365"&&!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(tenantId))throw new Error("Invalid Microsoft 365 tenant ID");
 const base=provider==="alibaba_mail"?clean(b.api_base===undefined?previous?.api_base:b.api_base,150)||ALIBABA_BASES[0]:"";
 if(provider==="alibaba_mail"&&!ALIBABA_BASES.includes(base as typeof ALIBABA_BASES[number]))throw new Error("Invalid Alibaba Mail API region");
 const folder=clean(b.folder_id===undefined?previous?.folder_id:b.folder_id,100)||(provider==="alibaba_mail"?"2":"inbox");
 const interval=Number(b.sync_interval_minutes??previous?.sync_interval_minutes??5);
 const lookback=Number(b.initial_lookback_days??previous?.initial_lookback_days??7);
 if(!Number.isInteger(interval)||interval<5||interval>1440)throw new Error("Invalid sync interval (5 to 1440 minutes)");
 if(!Number.isInteger(lookback)||lookback<1||lookback>30)throw new Error("Invalid initial lookback (1 to 30 days)");
 return {address,provider,clientId,tenantId,base,folder,interval,lookback,label:clean(b.display_name??previous?.display_name,100),active:b.active===undefined?Number(previous?.active||0):b.active===true?1:0};
}
async function getAuthorized(req:NextRequest,entity:unknown):Promise<{error?:NextResponse;viewer?:NonNullable<Awaited<ReturnType<typeof getViewer>>>;entity?:string}>{
 const viewer=await getViewer();
 if(!viewer)return {error:fail("Unauthorized",401)};
 const access=await resolveFinanceEntityAccess(viewer.id,entity);
 if(access.role!=="admin")return {error:fail("Entity administrator required",403)};
 return {viewer,entity:access.entityId};
}
function handleError(e:unknown){
 if(e instanceof EntityAccessError)return fail(e.message,e.status);
 console.error("Finance mail account request failed",e instanceof Error?e.message:"unknown");
 const message=e instanceof Error?e.message:"Finance mail request failed";
 if(/^(Invalid|Missing|Mailbox|Mail provider|Microsoft 365|Alibaba Mail)/.test(message))return fail(message);
 if(/(already|conflict|unique|UNIQUE)/i.test(message))return fail("Mailbox address is already connected to a company",409);
 return fail("Finance mail operation failed",500);
}
export async function GET(request:NextRequest){
 try{
  const a=await getAuthorized(request,request.nextUrl.searchParams.get("entity_id"));
  if(a.error)return a.error;
  const entity=a.entity!;
  const accounts=await all<MailAccount>("SELECT * FROM oa_finance_mail_account WHERE entity_id=? ORDER BY created_at DESC,id DESC",[entity]);
  const logs=await all<any>("SELECT l.account_id,l.started_at,l.finished_at,l.status,l.scanned_count,l.imported_count,l.duplicate_count,l.error_text FROM oa_finance_mail_sync_log l WHERE l.entity_id=? ORDER BY l.started_at DESC,l.id DESC LIMIT 40",[entity]);
  return ok({accounts:accounts.map(publicAccount),logs,hasMasterKey:!!getOaEnv().settingsMasterKey});
 }catch(e){return handleError(e);}
}
export async function POST(request:NextRequest){
 try{
  const body=await request.json() as Record<string,any>;
  const a=await getAuthorized(request,body.entity_id);
  if(a.error)return a.error;
  const entity=a.entity!,viewer=a.viewer!;
  const action=clean(body.action,40),id=clean(body.id,100);
  if(action==="add"){
   const s=validateMailSettings(body);
   const existingLegacy=await one<{entity_id:string}>("SELECT entity_id FROM oa_finance_mailbox WHERE address=? OR receive_address=?",[s.address,s.address]);
   if(existingLegacy)throw new Error("Mailbox already configured through legacy Resend; remove old route before enabling direct API synchronization");
   const secret=clean(body.client_secret,4000);
   if(!secret)throw new Error("Missing app client secret");
   const encrypted=await encryptEmailSecret(secret);
   const accountId=crypto.randomUUID();
   await run("INSERT INTO oa_finance_mail_account(id,entity_id,address,display_name,provider,tenant_id,client_id,client_secret_encrypted,api_base,folder_id,sync_interval_minutes,initial_lookback_days,active,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [accountId,entity,s.address,s.label,s.provider,s.tenantId,s.clientId,encrypted,s.base,s.folder,s.interval,s.lookback,0,viewer.id,viewer.id]);
   await audit(viewer.id,"finance.mailaccount.add","finance_mail_account",accountId,{provider:s.provider,address:s.address},entity);
   return ok({id:accountId,active:false},201);
  }
  if(!id)return fail("Mail account ID required");
  const previous=await one<MailAccount>("SELECT * FROM oa_finance_mail_account WHERE id=? AND entity_id=?",[id,entity]);
  if(!previous)return fail("Mailbox account not found",404);
  if(action==="update"){
   const s=validateMailSettings(body,previous);
   const secret=clean(body.client_secret,4000);
   const encrypted=secret?await encryptEmailSecret(secret):previous.client_secret_encrypted;
   await run("UPDATE oa_finance_mail_account SET display_name=?,tenant_id=?,client_id=?,client_secret_encrypted=?,api_base=?,folder_id=?,sync_interval_minutes=?,initial_lookback_days=?,active=?,updated_by=?,updated_at=CURRENT_TIMESTAMP,last_error=NULL WHERE id=? AND entity_id=?",
    [s.label,s.tenantId,s.clientId,encrypted,s.base,s.folder,s.interval,s.lookback,s.active,viewer.id,id,entity]);
   await audit(viewer.id,"finance.mailaccount.update","finance_mail_account",id,{provider:s.provider,address:s.address,active:s.active,secretRotated:!!secret,interval:s.interval},entity);
   return ok({id,active:!!s.active});
  }
  if(action==="test"){
   const result=await testMailAccount(previous);
   await audit(viewer.id,"finance.mailaccount.test","finance_mail_account",id,{provider:previous.provider,connected:true},entity);
   return ok(result);
  }
  if(action==="sync"){
   if(!previous.active)return fail("Enable the mailbox before syncing",409);
   const result=await syncMailAccount(previous);
   return ok(result);
  }
  return fail("Unknown mailbox action",404);
 }catch(e){return handleError(e);}
}
