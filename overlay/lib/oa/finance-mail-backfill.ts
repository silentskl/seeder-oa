import {all,audit,one,run} from "./db";
import {financeMultiEntityActive} from "./finance-entity";
import {MailAccount,openFinanceMailClient,importFinanceMailAttachments} from "./finance-mail-sync";

export type MailBackfillStatus="queued"|"running"|"paused"|"completed"|"failed"|"cancelled";
export type MailBackfill={
 id:string;entity_id:string;account_id:string;date_from:string;date_to:string;status:MailBackfillStatus;
 page_cursor:string|null;message_offset:number;pages_processed:number;messages_scanned:number;
 invoices_imported:number;duplicates_skipped:number;other_skipped:number;retry_count:number;
 lease_until:string|null;next_attempt_at:string;last_error:string|null;
 created_by:string;updated_by:string;created_at:string;updated_at:string;finished_at:string|null;
};
export function publicMailBackfill(job:MailBackfill){
 const {page_cursor,lease_until,created_by,updated_by,...safe}=job;
 return safe; // Never expose provider continuation URLs or internal lease metadata.
}
function dateTime(date:string):number{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Invalid backfill date; use YYYY-MM-DD");
 const n=Date.parse(date+"T00:00:00.000Z");
 if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==date)
  throw new Error("Invalid backfill calendar date");
 return n;
}
export function validateMailBackfillRange(from:unknown,to:unknown){
 const start=String(from??""),end=String(to??"");
 const a=dateTime(start),b=dateTime(end);
 if(b<a)throw new Error("Backfill end date must not precede start date");
 if(b-a>3660*86400000)throw new Error("Backfill range must be 10 years or less");
 if(b>Date.now()+86400000)throw new Error("Backfill end date cannot be in the future");
 const toExclusive=new Date(b+86400000).toISOString().slice(0,10);
 return {from:start,to:end,toExclusive};
}
export async function listMailBackfills(entityId:string){
 return (await all<MailBackfill>(
  "SELECT * FROM oa_finance_mail_backfill WHERE entity_id=? ORDER BY created_at DESC,id DESC LIMIT 50",[entityId]
 )).map(publicMailBackfill);
}
export async function startMailBackfill(entityId:string,accountId:string,userId:string,from:unknown,to:unknown){
 const range=validateMailBackfillRange(from,to);
 const account=await one<MailAccount>(
  "SELECT * FROM oa_finance_mail_account WHERE id=? AND entity_id=?",[accountId,entityId]);
 if(!account)throw new Error("Mailbox not found for selected company");
 if(!account.active)throw new Error("Mailbox must be enabled before historical sync");
 const id=crypto.randomUUID();
 try{
  await run("INSERT INTO oa_finance_mail_backfill(id,entity_id,account_id,date_from,date_to,created_by,updated_by) VALUES(?,?,?,?,?,?,?)",
   [id,entityId,account.id,range.from,range.to,userId,userId]);
 }catch(error){
  if(String(error).includes("UNIQUE")||String(error).includes("unique"))
   throw new Error("Mailbox already has a pending, running or paused backfill. Finish or cancel it first.");
  throw error;
 }
 await audit(userId,"finance.mail.backfill.create","finance_mail_backfill",id,
  {accountId,dateFrom:range.from,dateTo:range.to},entityId);
 return {id,status:"queued" as const};
}
export async function updateMailBackfillStatus(
 entityId:string,id:string,actor:string,action:"pause"|"resume"|"cancel"
){
 const job=await one<MailBackfill>(
  "SELECT * FROM oa_finance_mail_backfill WHERE id=? AND entity_id=?",[id,entityId]);
 if(!job)throw new Error("Historical sync task not found");
 let result;
 if(action==="pause"){
  result=await run("UPDATE oa_finance_mail_backfill SET status='paused',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND entity_id=? AND status IN ('queued','running')",
   [actor,id,entityId]);
 }else if(action==="resume"){
  result=await run("UPDATE oa_finance_mail_backfill SET status='queued',retry_count=0,next_attempt_at=CURRENT_TIMESTAMP,last_error=NULL,lease_until=NULL,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND entity_id=? AND status IN ('paused','failed') AND (lease_until IS NULL OR datetime(lease_until)<=CURRENT_TIMESTAMP)",
   [actor,id,entityId]);
 }else{
  result=await run("UPDATE oa_finance_mail_backfill SET status='cancelled',finished_at=CURRENT_TIMESTAMP,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND entity_id=? AND status IN ('queued','running','paused','failed')",
   [actor,id,entityId]);
 }
 if(result.meta?.changes!==1)throw new Error("Historical sync state changed; refresh and retry after the current batch completes");
 await audit(actor,"finance.mail.backfill."+action,"finance_mail_backfill",id,
  {accountId:job.account_id,from:job.status},entityId);
 return {id,status:action==="pause"?"paused":action==="cancel"?"cancelled":"queued"};
}
export async function dueMailBackfills(limit=1){
 return all<MailBackfill>(
  "SELECT b.* FROM oa_finance_mail_backfill b JOIN oa_finance_mail_account a ON a.id=b.account_id AND a.entity_id=b.entity_id WHERE a.active=1 AND (?=1 OR b.entity_id='legacy-primary') AND b.status IN ('queued','running') AND datetime(b.next_attempt_at)<=CURRENT_TIMESTAMP AND (b.lease_until IS NULL OR datetime(b.lease_until)<=CURRENT_TIMESTAMP) ORDER BY b.updated_at ASC,b.created_at ASC LIMIT ?",
  [financeMultiEntityActive()?1:0,limit]
 );
}
const PAGE_SIZE=50;
const BATCH_MAX_MESSAGES=5;
const BATCH_TIME_MS=40000;
const LEASE_MS=9*60000;
function errorText(error:unknown){
 const value=error instanceof Error?error.message:"Historical synchronization failed";
 return value.replace(/https?:\/\/\S+/gi,"[provider URL]").slice(0,300);
}
export async function processMailBackfill(id:string,entityId:string){
 const job=await one<MailBackfill>(
  "SELECT * FROM oa_finance_mail_backfill WHERE id=? AND entity_id=?",[id,entityId]);
 if(!job)throw new Error("Historical sync task not found");
 if(!["queued","running"].includes(job.status))return {id,status:job.status,processed:0};
 const lease=new Date(Date.now()+LEASE_MS).toISOString();
 const locked=await run(
  "UPDATE oa_finance_mail_backfill SET status='running',lease_until=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND entity_id=? AND status IN ('queued','running') AND datetime(next_attempt_at)<=CURRENT_TIMESTAMP AND (lease_until IS NULL OR datetime(lease_until)<=CURRENT_TIMESTAMP)",
  [lease,id,entityId]);
 if(locked.meta?.changes!==1)return {id,status:"busy",processed:0};
 // Share the mailbox lease with ordinary 5-minute sync; no concurrent
 // attachment import can race this job or duplicate R2 uploads.
 const accountLock=await run(
  "UPDATE oa_finance_mail_account SET sync_lock_until=? WHERE id=? AND entity_id=? AND active=1 AND (sync_lock_until IS NULL OR datetime(sync_lock_until)<=CURRENT_TIMESTAMP)",
  [lease,job.account_id,entityId]);
 if(accountLock.meta?.changes!==1){
  await run("UPDATE oa_finance_mail_backfill SET status='queued',lease_until=NULL,next_attempt_at=datetime('now','+1 minute') WHERE id=? AND entity_id=? AND lease_until=?",
   [id,entityId,lease]);
  return {id,status:"mailbox_busy",processed:0};
 }
 const began=Date.now();
 let processed=0;
 try{
  const account=await one<MailAccount>(
   "SELECT * FROM oa_finance_mail_account WHERE id=? AND entity_id=? AND active=1",[job.account_id,entityId]);
  if(!account)throw new Error("Mailbox disabled or unavailable");
  const range=validateMailBackfillRange(job.date_from,job.date_to);
  const startTime=dateTime(range.from),endTime=dateTime(range.toExclusive);
  const client=await openFinanceMailClient(account,{from:range.from,toExclusive:range.toExclusive,pageSize:PAGE_SIZE});
  // One provider page is re-fetched on resume, but already-processed
  // messages are skipped by the persisted offset (and invoice unique keys).
  const page=await client.list(job.page_cursor);
  let offset=job.message_offset,tooOld=false;
  if(offset>page.messages.length)throw new Error("Mail provider pagination changed during historical sync; restart the task from the beginning");
  for(;offset<page.messages.length;offset++){
   // Allow pause/cancel to take effect between emails, never in the middle of
   // downloading or saving an attachment.
   const current=await one<{status:string}>("SELECT status FROM oa_finance_mail_backfill WHERE id=? AND entity_id=?",[id,entityId]);
   if(current?.status!=="running")break;
   const message=page.messages[offset];
   const timestamp=Date.parse(message.receivedAt);
   if(Number.isFinite(timestamp)&&timestamp<startTime){
    // Both provider lists are requested newest-first; all later pages are older.
    tooOld=true;break;
   }
   const counts=Number.isFinite(timestamp)&&timestamp>=startTime&&timestamp<endTime
    ?await importFinanceMailAttachments(account,client,message)
    :{scanned:0,imported:0,duplicates:0,skipped:1};
   await run(
    "UPDATE oa_finance_mail_backfill SET message_offset=?,messages_scanned=messages_scanned+?,invoices_imported=invoices_imported+?,duplicates_skipped=duplicates_skipped+?,other_skipped=other_skipped+?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND entity_id=? AND status='running'",
    [offset+1,counts.scanned,counts.imported,counts.duplicates,counts.skipped,id,entityId]
   );
   processed++;
   if(processed>=BATCH_MAX_MESSAGES||Date.now()-began>=BATCH_TIME_MS){offset++;break;}
  }
  const finished=tooOld||offset>=page.messages.length&&!page.cursor;
  const nextPage=!tooOld&&offset>=page.messages.length;
  if(nextPage||tooOld){
   if(page.cursor&&page.cursor.length>8000)throw new Error("Mail provider continuation token exceeds safe length");
   await run(
    "UPDATE oa_finance_mail_backfill SET page_cursor=?,message_offset=0,pages_processed=pages_processed+1,status=CASE WHEN status='running' THEN ? ELSE status END,lease_until=NULL,last_error=NULL,finished_at=CASE WHEN status='running' AND ?=1 THEN CURRENT_TIMESTAMP ELSE finished_at END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND entity_id=? AND lease_until=?",
    [tooOld?null:page.cursor,finished?"completed":"queued",finished?1:0,id,entityId,lease]);
  }else{
   await run(
    "UPDATE oa_finance_mail_backfill SET status=CASE WHEN status='running' THEN 'queued' ELSE status END,lease_until=NULL,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND entity_id=? AND lease_until=?",
    [id,entityId,lease]
   );
  }
  return {id,status:finished?"completed":"queued",processed};
 }catch(error){
  const message=errorText(error);
  await run(
   "UPDATE oa_finance_mail_backfill SET retry_count=retry_count+1,status=CASE WHEN retry_count>=2 THEN 'failed' ELSE 'queued' END,next_attempt_at=datetime('now','+5 minutes'),last_error=?,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND entity_id=? AND lease_until=? AND status='running'",
   [message,id,entityId,lease]
  );
  console.error("Finance backfill batch failed",{jobId:id,accountId:job.account_id,error:message});
  return {id,status:"error",processed,error:message};
 }finally{
  await run("UPDATE oa_finance_mail_account SET sync_lock_until=NULL WHERE id=? AND entity_id=? AND sync_lock_until=?",
   [job.account_id,entityId,lease]);
 }
}
