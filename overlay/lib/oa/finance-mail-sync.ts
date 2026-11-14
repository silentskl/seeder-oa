import {all,audit,one,run} from "./db";
import {financeMultiEntityActive} from "./finance-entity";
import {decryptEmailSecret} from "./email";
import {clean,createInvoice,extractInvoice,FINANCE_MAX_FILE,FINANCE_TYPES,mailAddress,storeFinanceDocument} from "./finance";

export type MailProvider="microsoft365"|"alibaba_mail";
export type MailAccount={
 id:string;entity_id:string;address:string;display_name:string;provider:MailProvider;
 tenant_id:string;client_id:string;client_secret_encrypted:string;api_base:string;folder_id:string;
 active:number;sync_interval_minutes:number;initial_lookback_days:number;last_attempt_at:string|null;
 last_success_at:string|null;last_error:string|null;sync_lock_until:string|null;
};
export type MailMessage={id:string;subject:string;sender:string;body:string;receivedAt:string;hasAttachments:boolean};
type MailAttachment={id:string;name:string;contentType:string;size:number;inline:boolean};
export type MailClient={
 list:(cursor:string|null)=>Promise<{messages:MailMessage[];cursor:string|null}>;
 attachments:(message:MailMessage)=>Promise<MailAttachment[]>;
 download:(message:MailMessage,attachment:MailAttachment)=>Promise<Uint8Array>;
};
const GRAPH="https://graph.microsoft.com";
export const ALIBABA_BASES=["https://alimail-cn.aliyuncs.com","https://mail-open.xc.aliyun.com"] as const;
const fileMime=(name:string,declared:string)=>{
 const mime=clean(declared,100).split(";")[0].toLowerCase();
 if(FINANCE_TYPES.has(mime))return mime;
 const ext=name.toLowerCase().split(".").pop();
 return ({pdf:"application/pdf",jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp"} as Record<string,string>)[ext||""]||"";
};
const take=(value:unknown,max=1000)=>clean(value,max);
function readSender(value:any):string{
 return mailAddress(typeof value==="string"?value:value?.emailAddress?.address||value?.email||"");
}
function b64ToBytes(b64:string){
 const string=atob(b64.replace(/-/g,"+").replace(/_/g,"/"));
 const bytes=new Uint8Array(string.length);
 for(let i=0;i<string.length;i++)bytes[i]=string.charCodeAt(i);
 return bytes;
}
async function fetchOk(url:string,init:RequestInit){
 // Cloudflare Workers does not implement the unsupported error redirect mode. Use "manual" so
 // OAuth POST bodies and Bearer tokens are never forwarded to another host.
 const response=await fetch(url,{...init,redirect:"manual",cache:"no-store",signal:AbortSignal.timeout(20000)});
 if(response.status>=300&&response.status<400)throw new Error("Mail provider returned an unexpected redirect (HTTP "+response.status+")");
 if(!response.ok)throw new Error("Mail provider request failed HTTP "+response.status);
 return response;
}
async function json(url:string,token:string,headers:Record<string,string>={}):Promise<any>{
 return (await fetchOk(url,{headers:{"Authorization":"Bearer "+token,"Accept":"application/json",...headers}})).json();
}
function configuredBase(account:MailAccount){
 if(account.provider==="alibaba_mail"){
  const base=account.api_base||ALIBABA_BASES[0];
  if(!ALIBABA_BASES.includes(base as typeof ALIBABA_BASES[number]))throw new Error("Unsupported Alibaba API region");
  return base;
 }
 return GRAPH;
}
async function mailToken(account:MailAccount){
 const secret=await decryptEmailSecret(account.client_secret_encrypted);
 if(!secret)throw new Error("Mailbox credential not configured");
 let url:string,params:URLSearchParams;
 if(account.provider==="microsoft365"){
  if(!/^[a-f0-9-]{36}$/i.test(account.tenant_id))throw new Error("Microsoft 365 tenant ID must be a tenant GUID");
  url="https://login.microsoftonline.com/"+encodeURIComponent(account.tenant_id)+"/oauth2/v2.0/token";
  params=new URLSearchParams({client_id:account.client_id,client_secret:secret,scope:"https://graph.microsoft.com/.default",grant_type:"client_credentials"});
 }else{
  url=configuredBase(account)+"/oauth2/v2.0/token";
  params=new URLSearchParams({client_id:account.client_id,client_secret:secret,grant_type:"client_credentials"});
 }
 const response=await fetchOk(url,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:params.toString()});
 const data:any=await response.json();
 if(typeof data.access_token!=="string"||!data.access_token)throw new Error("Mail provider did not return an access token");
 return data.access_token as string;
}
function microsoftClient(account:MailAccount,token:string,history?:{from:string;toExclusive:string;pageSize:number}):MailClient{
 const base=GRAPH+"/v1.0/users/"+encodeURIComponent(account.address);
 const folder=encodeURIComponent(account.folder_id||"inbox");
 const listBase=base+"/mailFolders/"+folder+"/messages";
 const u=new URL(listBase);
 u.searchParams.set("$top",String(history?.pageSize||100));
 if(history)u.searchParams.set("$filter","receivedDateTime ge "+history.from+"T00:00:00Z and receivedDateTime lt "+history.toExclusive+"T00:00:00Z");
 u.searchParams.set("$select","id,subject,hasAttachments,receivedDateTime,from,bodyPreview");
 u.searchParams.set("$orderby","receivedDateTime desc");
 return {
  async list(cursor){
   const url=cursor||u.toString(),parsed=new URL(url);
   if(parsed.origin!==GRAPH||!parsed.pathname.startsWith(new URL(listBase).pathname))
     throw new Error("Unexpected Microsoft Graph pagination URL");
   const result=await json(url,token,{"Prefer":'IdType="ImmutableId"'});
   return {
    messages:(Array.isArray(result.value)?result.value:[]).map((m:any)=>({
     id:take(m.id,1000),subject:take(m.subject,300),sender:readSender(m.from),
     body:take(m.bodyPreview,1500),receivedAt:String(m.receivedDateTime||""),
     hasAttachments:!!m.hasAttachments,
    })).filter((m:MailMessage)=>!!m.id),
    cursor:typeof result["@odata.nextLink"]==="string"?result["@odata.nextLink"]:null,
   };
  },
  async attachments(message){
   let cursor:string|null=base+"/messages/"+encodeURIComponent(message.id)+"/attachments?$top=100";
   const found:MailAttachment[]=[];
   for(let page=0;cursor&&page<3;page++){
    const parsed=new URL(cursor);
    if(parsed.origin!==GRAPH||!parsed.pathname.includes("/attachments"))throw new Error("Invalid Microsoft Graph attachment cursor");
    const result=await json(cursor,token,{"Prefer":'IdType="ImmutableId"'});
    for(const a of Array.isArray(result.value)?result.value:[]){
     if(a["@odata.type"]!=="#microsoft.graph.fileAttachment"||a.isInline)continue;
     found.push({id:take(a.id,600),name:take(a.name,180),contentType:fileMime(String(a.name||""),String(a.contentType||"")),
      size:Number(a.size||0),inline:!!a.isInline});
    }
    cursor=result["@odata.nextLink"]||null;
   }
   if(cursor)throw new Error("More than 300 attachments in a single message");
   return found;
  },
  async download(message,attachment){
   const url=base+"/messages/"+encodeURIComponent(message.id)+"/attachments/"+encodeURIComponent(attachment.id)+"/$value";
   const response=await fetchOk(url,{headers:{"Authorization":"Bearer "+token,"Prefer":'IdType="ImmutableId"'}});
   const size=Number(response.headers.get("content-length")||0);
   if(size>FINANCE_MAX_FILE)throw new Error("Attachment larger than 12MB");
   const buffer=new Uint8Array(await response.arrayBuffer());
   if(buffer.length>FINANCE_MAX_FILE)throw new Error("Attachment larger than 12MB");
   return buffer;
  },
 };
}
function alibabaClient(account:MailAccount,token:string,history?:{from:string;toExclusive:string;pageSize:number}):MailClient{
 const base=configuredBase(account),mb=base+"/v2/users/"+encodeURIComponent(account.address);
 const folder=encodeURIComponent(account.folder_id||"2");
 return {
  async list(cursor){
   const url=new URL(mb+"/mailFolders/"+folder+"/messages");
   url.searchParams.set("size",String(history?.pageSize||100));url.searchParams.set("orderby","DES");
   if(cursor)url.searchParams.set("cursor",cursor);
   const result=await json(url.toString(),token);
   if(!Array.isArray(result.messages))throw new Error("Alibaba Mail message list response is not recognized");
   return {
    messages:result.messages.map((m:any)=>({
     id:take(m.id,1000),subject:take(m.subject,300),sender:readSender(m.from),
     body:take(m.summary,1500),receivedAt:String(m.receivedDateTime||m.sentDateTime||""),
     hasAttachments:!!m.hasAttachments,
    })).filter((m:MailMessage)=>!!m.id),
    cursor:result.hasMore&&typeof result.nextCursor==="string"&&result.nextCursor?result.nextCursor:null,
   };
  },
  async attachments(message){
   // Read server-side detail for sender/subject where list results omit them.
   const result=await json(mb+"/messages/"+encodeURIComponent(message.id)+"/attachments",token);
   if(!Array.isArray(result.attachments))throw new Error("Alibaba attachment list response not recognized");
   return result.attachments.map((a:any)=>({
     id:take(a.id,600),name:take(a.name,180),contentType:fileMime(String(a.name||""),String(a.contentType||"")),
     size:Number(a.size||0),inline:!!a.isInline,
   })).filter((a:MailAttachment)=>!!a.id&&!a.inline);
  },
  async download(message,attachment){
   const url=mb+"/messages/"+encodeURIComponent(message.id)+"/attachments/"+encodeURIComponent(attachment.id)+"/$value";
   // Some Alibaba environments return a signed file-stream URL rather than bytes.
   // Follow at most one HTTPS redirect to a known Alibaba-owned host, without
   // forwarding the OAuth Bearer credential to the download host.
   let response=await fetch(url,{headers:{"Authorization":"Bearer "+token},redirect:"manual",signal:AbortSignal.timeout(20000)});
   if([301,302,303,307,308].includes(response.status)){
    const location=response.headers.get("location");
    if(!location)throw new Error("Alibaba attachment redirect without location");
    const target=new URL(location,url);
    const hostname=target.hostname.toLowerCase();
    if(target.protocol!=="https:"||target.username||target.password||target.port||!(hostname==="aliyuncs.com"||hostname.endsWith(".aliyuncs.com")||hostname==="aliyun.com"||hostname.endsWith(".aliyun.com")))
     throw new Error("Untrusted Alibaba attachment download host");
    response=await fetchOk(target.toString(),{});
   }
   if(!response.ok)throw new Error("Alibaba attachment download HTTP "+response.status);
   const size=Number(response.headers.get("content-length")||0);
   if(size>FINANCE_MAX_FILE)throw new Error("Attachment larger than 12MB");
   const bytes=new Uint8Array(await response.arrayBuffer());
   if(bytes.length>FINANCE_MAX_FILE)throw new Error("Attachment larger than 12MB");
   return bytes;
  }
 };
}
// Shared importer. Immutable provider IDs and unique invoice keys make replay safe.
export async function importFinanceMailAttachments(account:MailAccount,client:MailClient,message:MailMessage){
 const counts={scanned:0,imported:0,duplicates:0,skipped:0};
 if(!message.hasAttachments)return counts;
 counts.scanned=1;
 const attachments=await client.attachments(message);
 if(attachments.length>30)throw new Error("More than 30 attachments in an email");
 for(const attachment of attachments){
  if(!FINANCE_TYPES.has(attachment.contentType)||attachment.size>FINANCE_MAX_FILE){
   counts.skipped++;continue;
  }
  const sourceEmailId=account.id+":"+message.id;
  const existing=await one("SELECT id FROM oa_finance_invoice WHERE entity_id=? AND source_email_id=? AND source_attachment_id=?",
   [account.entity_id,sourceEmailId,attachment.id]);
  if(existing){counts.duplicates++;continue;}
  const bytes=await client.download(message,attachment);
  const doc=await storeFinanceDocument({entityId:account.entity_id,purpose:"invoice",name:attachment.name,type:attachment.contentType,bytes});
  const parsed=await extractInvoice({entityId:account.entity_id,bytes,type:attachment.contentType,name:attachment.name,
   subject:message.subject,body:message.body,sender:message.sender});
  const id=await createInvoice({entityId:account.entity_id,documentId:doc,source:"email",
   sourceEmailId,sourceAttachmentId:attachment.id,sender:message.sender,parsed,sourceMailAccountId:account.id});
  await audit(null,"finance.invoice.provider_import","finance_invoice",id,
   {accountId:account.id,provider:account.provider,sourceEmailId,attachmentId:attachment.id,extraction:parsed.extractionStatus},account.entity_id);
  counts.imported++;
 }
 return counts;
}
export async function openFinanceMailClient(account:MailAccount,history?:{from:string;toExclusive:string;pageSize:number}){
 const token=await mailToken(account);
 return account.provider==="microsoft365"?microsoftClient(account,token,history):alibabaClient(account,token,history);
}
export async function testMailAccount(account:MailAccount){
 const token=await mailToken(account);
 const client=account.provider==="microsoft365"?microsoftClient(account,token):alibabaClient(account,token);
 const page=await client.list(null);
 return {connected:true,provider:account.provider,mailbox:account.address,sampleCount:page.messages.length};
}
export async function syncMailAccount(account:MailAccount){
 if(!account.active)throw new Error("Mailbox is disabled");
 // SQLite atomic lock: no concurrent invocation can process the same mailbox in parallel.
 const lock=await run("UPDATE oa_finance_mail_account SET sync_lock_until=datetime('now','+10 minutes'),last_attempt_at=CURRENT_TIMESTAMP WHERE id=? AND entity_id=? AND active=1 AND (sync_lock_until IS NULL OR datetime(sync_lock_until) <= CURRENT_TIMESTAMP)",
  [account.id,account.entity_id]);
 if(lock.meta?.changes!==1)throw new Error("Mailbox sync already in progress or disabled");
 const syncId=crypto.randomUUID(),start=new Date(),startedAt=start.toISOString();
 await run("INSERT INTO oa_finance_mail_sync_log(id,entity_id,account_id,status) VALUES(?,?,?,'running')",[syncId,account.entity_id,account.id]);
 let scanned=0,imported=0,duplicates=0;
 try{
  const token=await mailToken(account);
  const client=account.provider==="microsoft365"?microsoftClient(account,token):alibabaClient(account,token);
  // A replay window avoids missing late-arriving mail and works across restarted workers.
  const cutoff=account.last_success_at?Date.parse(account.last_success_at)-60*60*1000:start.getTime()-account.initial_lookback_days*86400*1000;
  let cursor:string|null=null,completed=false;
  for(let page=0;page<10;page++){
   const result=await client.list(cursor);
   let older=0;
   for(const message of result.messages){
    const timestamp=Date.parse(message.receivedAt);
    if(Number.isFinite(timestamp)&&timestamp<cutoff){older++;continue;}
    const done=await importFinanceMailAttachments(account,client,message);
    scanned+=done.scanned;imported+=done.imported;duplicates+=done.duplicates;
   }
   cursor=result.cursor;
   if(!cursor||older>0){completed=true;break;}
  }
  if(!completed)throw new Error("Mailbox needs additional pagination; sync checkpoint not advanced");
  await run("UPDATE oa_finance_mail_account SET last_success_at=?,last_error=NULL,sync_lock_until=NULL WHERE id=? AND entity_id=?",[startedAt,account.id,account.entity_id]);
  await run("UPDATE oa_finance_mail_sync_log SET status='success',scanned_count=?,imported_count=?,duplicate_count=?,finished_at=CURRENT_TIMESTAMP WHERE id=?",[scanned,imported,duplicates,syncId]);
  await audit(null,"finance.mail.sync","finance_mail_account",account.id,{scanned,imported,duplicates,provider:account.provider},account.entity_id);
  return {scanned,imported,duplicates};
 }catch(error){
  // Never log the OAuth response body (may contain secrets).
  const msg=String(error instanceof Error?error.message:error).slice(0,400);
  await run("UPDATE oa_finance_mail_account SET last_error=?,sync_lock_until=NULL WHERE id=? AND entity_id=?",[msg,account.id,account.entity_id]);
  await run("UPDATE oa_finance_mail_sync_log SET status='error',scanned_count=?,imported_count=?,duplicate_count=?,error_text=?,finished_at=CURRENT_TIMESTAMP WHERE id=?",[scanned,imported,duplicates,msg,syncId]);
  throw error;
 }
}
export async function dueMailAccounts(limit=12){
 return all<MailAccount>("SELECT * FROM oa_finance_mail_account WHERE active=1 AND (?=1 OR entity_id='legacy-primary') AND (last_attempt_at IS NULL OR datetime(last_attempt_at,'+'||sync_interval_minutes||' minutes') <= CURRENT_TIMESTAMP) AND (sync_lock_until IS NULL OR datetime(sync_lock_until) <= CURRENT_TIMESTAMP) ORDER BY last_attempt_at ASC LIMIT ?",[financeMultiEntityActive()?1:0,limit]);
}
