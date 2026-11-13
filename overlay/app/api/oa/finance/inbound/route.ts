import {NextRequest,NextResponse} from "next/server";
import {one,audit} from "@/lib/oa/db";
import {getOaEnv} from "@/lib/oa/env";
import {financeMultiEntityActive} from "@/lib/oa/finance-entity";
import {clean,createInvoice,extractInvoice,FINANCE_MAX_FILE,FINANCE_TYPES,mailAddress,storeFinanceDocument} from "@/lib/oa/finance";
export const runtime="nodejs";
const fail=(message:string,status=400)=>NextResponse.json({ok:false,error:message},{status});
function b64ToBytes(input:string){
 const raw=atob(input.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(input.length/4)*4,"="));
 return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
async function verifyWebhook(req:NextRequest,payload:string,secret:string){
 const id=req.headers.get("svix-id")||"",time=req.headers.get("svix-timestamp")||"",sig=req.headers.get("svix-signature")||"";
 const ts=Number(time);
 if(!id||!Number.isFinite(ts)||Math.abs(Date.now()/1000-ts)>300)return false;
 const key=b64ToBytes(secret.startsWith("whsec_")?secret.slice(6):secret);
 const cryptoKey=await crypto.subtle.importKey("raw",key,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const bytes=new Uint8Array(await crypto.subtle.sign("HMAC",cryptoKey,new TextEncoder().encode(id+"."+time+"."+payload)));
 const expected=btoa(String.fromCharCode(...bytes));
 // Svix signatures contain multiple versioned signatures during key rotations.
 return sig.split(" ").some(part=>{
  const [version,value]=part.split(",");
  if(version!=="v1"||!value||value.length!==expected.length)return false;
  let difference=0;for(let i=0;i<value.length;i++)difference|=value.charCodeAt(i)^expected.charCodeAt(i);
  return difference===0;
 });
}
async function resendGet(path:string,key:string){
 const response=await fetch("https://api.resend.com/"+path,{headers:{"Authorization":"Bearer "+key},cache:"no-store"});
 if(!response.ok)throw new Error("Resend API "+response.status);
 return response.json() as Promise<any>;
}
export async function POST(request:NextRequest){
 const env=getOaEnv();
 if(!env.financeResendWebhookSecret||!env.financeResendApiKey)return fail("Inbound finance email is not configured",503);
 const raw=await request.text();
 if(raw.length>150000)return fail("Webhook payload too large",413);
 try{
  if(!await verifyWebhook(request,raw,env.financeResendWebhookSecret))return fail("Invalid webhook signature",401);
  const event=JSON.parse(raw) as any;
  if(event.type!=="email.received")return NextResponse.json({ok:true,skipped:true});
  const emailId=clean(event.data?.email_id,100);
  if(!/^[a-f0-9-]{32,50}$/i.test(emailId))return fail("Invalid inbound email ID",400);
  const recipients: string[]=Array.isArray(event.data?.to)?(event.data.to as unknown[]).map(mailAddress).filter(Boolean):[];
  const matches=await Promise.all(recipients.map(address=>one<{entity_id:string}>("SELECT entity_id FROM oa_finance_mailbox WHERE receive_address=?",[address])));
  const entityIds=Array.from(new Set(matches.filter(Boolean).map(m=>m!.entity_id)));
  if(entityIds.length!==1)return fail("No unique configured finance mailbox for recipient",422);
  const entity=entityIds[0];
  if(entity!=="legacy-primary"&&!financeMultiEntityActive())return fail("Finance multi-company access not enabled",403);
  const email=await resendGet("emails/receiving/"+encodeURIComponent(emailId),env.financeResendApiKey);
  const list=await resendGet("emails/receiving/"+encodeURIComponent(emailId)+"/attachments?limit=100",env.financeResendApiKey);
  const files:Array<any>=Array.isArray(list.data)?list.data:[];
  if(files.length>20)return fail("Too many email attachments; manual review required",422);
  const sender=mailAddress(email.from||event.data?.from);
  let processed=0,duplicates=0;
  for(const attachment of files){
   const aid=clean(attachment.id,100),type=clean(attachment.content_type,100);
   const name=clean(attachment.filename,180)||"invoice.pdf";
   if(!aid||!FINANCE_TYPES.has(type))continue;
   const existing=await one("SELECT id FROM oa_finance_invoice WHERE entity_id=? AND source_email_id=? AND source_attachment_id=?",[entity,emailId,aid]);
   if(existing){duplicates++;continue;}
   const details=await resendGet("emails/receiving/"+encodeURIComponent(emailId)+"/attachments/"+encodeURIComponent(aid),env.financeResendApiKey);
   const url=String(details.download_url||attachment.download_url||"");
   const parsedUrl=new URL(url);
   if(parsedUrl.protocol!=="https:"||parsedUrl.username||parsedUrl.password||parsedUrl.port)throw new Error("Invalid signed download URL");
   if(Number(details.size||attachment.size)>FINANCE_MAX_FILE)throw new Error("Invoice attachment exceeds 12MB");
   // Cloudflare Workers supports manual redirects but not redirect:"error".
   // Never automatically follow a signed attachment URL to an untrusted host.
   const response=await fetch(url,{redirect:"manual"});
   if(response.status>=300&&response.status<400)throw new Error("Unexpected inbound attachment redirect");
   if(!response.ok)throw new Error("Invoice attachment download failed "+response.status);
   const length=Number(response.headers.get("content-length")||"0");
   if(length>FINANCE_MAX_FILE)throw new Error("Invoice attachment exceeds 12MB");
   const bytes=new Uint8Array(await response.arrayBuffer());
   if(bytes.length>FINANCE_MAX_FILE)throw new Error("Invoice attachment exceeds 12MB");
   const doc=await storeFinanceDocument({entityId:entity,purpose:"invoice",name,type,bytes});
   const parsed=await extractInvoice({entityId:entity,bytes,type,name,subject:clean(email.subject,200),body:clean(email.text,4000),sender});
   const id=await createInvoice({entityId:entity,documentId:doc,source:"email",sourceEmailId:emailId,sourceAttachmentId:aid,sender,parsed});
   await audit(null,"finance.invoice.email_import","finance_invoice",id,{mailbox:recipients,emailId,attachmentId:aid,extraction:parsed.extractionStatus},entity);
   processed++;
  }
  return NextResponse.json({ok:true,processed,duplicates});
 }catch(e){
  console.error("Inbound finance email import failed",e);
  // 5xx lets the provider retry. All invoice attachments have unique idempotency keys.
  return fail("Inbound processing failed; retry is safe",500);
 }
}