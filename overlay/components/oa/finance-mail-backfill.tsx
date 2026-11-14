"use client";

import {useCallback,useEffect,useState} from "react";

type Account={id:string;address:string;active:number};
type History={
 id:string;account_id:string;date_from:string;date_to:string;
 status:"queued"|"running"|"paused"|"completed"|"failed"|"cancelled";
 pages_processed:number;messages_scanned:number;invoices_imported:number;
 duplicates_skipped:number;other_skipped:number;retry_count:number;
 last_error:string|null;updated_at:string;created_at:string;finished_at:string|null;
};
const button="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-medium disabled:opacity-40 dark:border-neutral-700";
const input="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950";
const initialRange=()=>{
 const now=new Date(),from=new Date(now.getTime()-29*86400000);
 return {from:from.toISOString().slice(0,10),to:now.toISOString().slice(0,10)};
};
async function api(entityId:string,method:"GET"|"POST",data:Record<string,unknown>={}){
 const url="/api/oa/finance/mail-backfill";
 const resp=await fetch(method==="GET"?url+"?entity_id="+encodeURIComponent(entityId):url,{
  method,cache:"no-store",
  ...(method==="POST"?{headers:{"Content-Type":"application/json"},body:JSON.stringify({entity_id:entityId,...data})}:{})
 });
 const result=await resp.json().catch(()=>null);
 if(!resp.ok||!result?.ok)throw new Error(result?.error||"Historical synchronization request failed ("+resp.status+")");
 return result.data;
}
export function FinanceMailBackfillPanel({entityId,accounts}:{entityId:string;accounts:Account[]}){
 const [accountId,setAccountId]=useState("");
 const [range,setRange]=useState(initialRange);
 const [jobs,setJobs]=useState<History[]>([]);
 const [error,setError]=useState(""),[notice,setNotice]=useState("");
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const load=useCallback(async()=>setJobs(await api(entityId,"GET") as History[]),[entityId]);
 useEffect(()=>{
  let active=true;
  setAccountId("");setError("");setNotice("");setJobs([]);setLoading(true);
  void load().catch(e=>{if(active)setError(e instanceof Error?e.message:String(e));})
   .finally(()=>{if(active)setLoading(false);});
  return ()=>{active=false;};
 },[load]);
 useEffect(()=>{
  if(!jobs.some(j=>j.status==="running"||j.status==="queued"))return;
  const timer=setInterval(()=>{void load().catch(()=>{});},20000);
  return ()=>clearInterval(timer);
 },[jobs,load]);
 const activeAccounts=accounts.filter(a=>a.active);
 const selected=activeAccounts.some(a=>a.id===accountId)?accountId:activeAccounts[0]?.id||"";
 async function perform(action:"create"|"process"|"pause"|"resume"|"cancel",id?:string){
  setBusy(true);setError("");setNotice("");
  try{
   const result=await api(entityId,"POST",action==="create"?
    {action,account_id:selected,date_from:range.from,date_to:range.to}:{action,id});
   setNotice(action==="create"?"Historical sync queued. The scheduled worker advances it in small batches; use Run next batch for an immediate step.":
    action==="process"?"Historical batch processed: "+String((result as any)?.processed??0)+" message(s).":
    "Historical sync "+action+" request accepted.");
  }catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{try{await load();}catch(e){setError(e instanceof Error?e.message:String(e));}setBusy(false);}
 }
 return <section className="mt-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
  <h3 className="font-semibold">Historical email backfill / 历史邮件补同步</h3>
  <p className="mb-3 mt-1 text-xs text-neutral-500">
   Choose an inclusive UTC date range. Jobs run in durable batches with per-mailbox locking and duplicate detection.
   Normal incremental synchronization and its successful checkpoint are not reset.
  </p>
  <div className="grid gap-3 sm:grid-cols-3">
   <label className="text-xs font-medium">Mailbox
    <select className={input+" mt-1"} disabled={busy||!activeAccounts.length} value={selected} onChange={e=>setAccountId(e.target.value)}>
     {!activeAccounts.length&&<option value="">Enable a mailbox first</option>}
     {activeAccounts.map(a=><option key={a.id} value={a.id}>{a.address}</option>)}
    </select>
   </label>
   <label className="text-xs font-medium">From (UTC)
    <input className={input+" mt-1"} type="date" value={range.from} max={range.to} onChange={e=>setRange(v=>({...v,from:e.target.value}))}/>
   </label>
   <label className="text-xs font-medium">To (UTC)
    <input className={input+" mt-1"} type="date" value={range.to} min={range.from} onChange={e=>setRange(v=>({...v,to:e.target.value}))}/>
   </label>
  </div>
  <div className="mt-3 flex flex-wrap gap-2">
   <button type="button" className={button} disabled={busy||!selected||!range.from||!range.to}
    onClick={()=>void perform("create")}>{busy?"Working…":"Start history backfill / 开始补同步"}</button>
   <button type="button" className={button} disabled={busy} onClick={()=>void load().catch(e=>setError(String(e)))}>Refresh progress</button>
  </div>
  {error&&<p role="alert" className="mt-3 rounded-md border border-red-300 p-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
  {notice&&<p role="status" className="mt-3 rounded-md border p-2 text-sm">{notice}</p>}
  <div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-xs">
   <thead><tr>{["Mailbox / Dates","State","Pages","Scanned","Imported","Duplicates","Skipped","Last error","Actions"].map(x=><th key={x} className="p-2">{x}</th>)}</tr></thead>
   <tbody>{jobs.map(job=><tr key={job.id} className="border-t align-top dark:border-neutral-800">
    <td className="p-2">{accounts.find(a=>a.id===job.account_id)?.address||job.account_id}
     <div className="text-neutral-500">{job.date_from} – {job.date_to}</div></td>
    <td className="p-2 font-medium">{job.status}<div className="font-normal text-neutral-500">{job.updated_at}</div></td>
    <td className="p-2">{job.pages_processed}</td><td className="p-2">{job.messages_scanned}</td>
    <td className="p-2">{job.invoices_imported}</td><td className="p-2">{job.duplicates_skipped}</td>
    <td className="p-2">{job.other_skipped}</td><td className="max-w-52 p-2">{job.last_error||"—"}</td>
    <td className="p-2"><div className="flex flex-wrap gap-1">
     {(job.status==="queued"||job.status==="running")&&<>
      <button type="button" className={button} disabled={busy} onClick={()=>void perform("process",job.id)}>Run next batch</button>
      <button type="button" className={button} disabled={busy} onClick={()=>void perform("pause",job.id)}>Pause</button>
     </>}
     {(job.status==="paused"||job.status==="failed")&&<button type="button" className={button} disabled={busy} onClick={()=>void perform("resume",job.id)}>Resume</button>}
     {!["completed","cancelled"].includes(job.status)&&<button type="button" className={button} disabled={busy}
      onClick={()=>{if(window.confirm("Cancel this historical sync? Imported invoices will remain."))void perform("cancel",job.id);}}>Cancel</button>}
    </div></td>
   </tr>)}</tbody>
  </table>{!loading&&!jobs.length&&<p className="p-3 text-sm text-neutral-500">No historical backfill tasks yet.</p>}</div>
 </section>;
}
