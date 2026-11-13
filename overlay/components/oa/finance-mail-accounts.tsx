"use client";
import {FormEvent,useCallback,useEffect,useRef,useState,type ReactNode} from "react";

type Provider="microsoft365"|"alibaba_mail";
type Mailbox={id:string;entity_id:string;address:string;display_name:string;provider:Provider;tenant_id:string;client_id:string;api_base:string;folder_id:string;active:number;credential_configured:boolean;sync_interval_minutes:number;initial_lookback_days:number;last_success_at:string|null;last_attempt_at:string|null;last_error:string|null;};
type SyncLog={account_id:string;started_at:string;status:string;scanned_count:number;imported_count:number;duplicate_count:number;error_text:string|null};
const field="w-full min-w-0 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950";
const button="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium disabled:opacity-40 dark:border-neutral-700";
const primary=button+" bg-neutral-900 text-white dark:bg-white dark:text-black";
const defaults={
 id:"",display_name:"",address:"",provider:"microsoft365" as Provider,tenant_id:"",
 client_id:"",client_secret:"",api_base:"https://alimail-cn.aliyuncs.com",folder_id:"",
 active:false,sync_interval_minutes:5,initial_lookback_days:7
};
async function api(entityId:string,action:string,data:Record<string,unknown>={}){
 const response=await fetch("/api/oa/finance/mail-accounts",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({entity_id:entityId,action,...data})});
 const parsed=await response.json().catch(()=>null);
 if(!response.ok||!parsed?.ok)throw new Error(parsed?.error||"Mail account API failed");
 return parsed.data;
}
function Labeled({label,children}:{label:string;children:ReactNode}){
 return <label className="block min-w-0 text-xs font-medium"><span className="mb-1 block text-neutral-500">{label}</span>{children}</label>;
}
export function MailAccountsPanel({entityId}:{entityId:string}){
 const currentEntity=useRef(entityId); currentEntity.current=entityId;
 const requestVersion=useRef(0);
 const [accounts,setAccounts]=useState<Mailbox[]>([]);
 const [logs,setLogs]=useState<SyncLog[]>([]);
 const [form,setForm]=useState({...defaults});
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(""),[notice,setNotice]=useState("");
 const [hasKey,setHasKey]=useState(false);
 const load=useCallback(async()=>{
  const seq=++requestVersion.current;
  if(entityId!==currentEntity.current)return;
  const r=await fetch("/api/oa/finance/mail-accounts?entity_id="+encodeURIComponent(entityId),{cache:"no-store"});
  const j=await r.json().catch(()=>null);
  if(!r.ok||!j?.ok)throw new Error(j?.error||"Unable to load email accounts");
  if(seq!==requestVersion.current||entityId!==currentEntity.current)return;
  setAccounts(j.data.accounts||[]);setLogs(j.data.logs||[]);setHasKey(!!j.data.hasMasterKey);
 },[entityId]);
 useEffect(()=>{
  let active=true;
  setForm({...defaults});setLoading(true);setError("");setNotice("");
  load().catch(e=>{if(active)setError(String(e));}).finally(()=>{if(active)setLoading(false);});
  return ()=>{active=false;requestVersion.current++;};
 },[load]);
 const patch=(values:Partial<typeof defaults>)=>setForm(s=>({...s,...values}));
 async function doWork(task:()=>Promise<unknown>,success:string){
  setBusy(true);setError("");setNotice("");
  try{const result=await task();await load();setNotice(success+(result&&typeof result==="object"&&"imported" in result?" Imported "+String((result as any).imported)+" invoice(s).":""));}
  catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setBusy(false);}
 }
 const editing=!!form.id;
 async function save(e:FormEvent){
  e.preventDefault();
  if(!editing&&!form.client_secret){setError("App client secret is required for a new mailbox.");return;}
  if(!hasKey){setError("OA_SETTINGS_MASTER_KEY must be configured for encrypted mailbox credentials.");return;}
  await doWork(async()=>{
   await api(entityId,editing?"update":"add",form);
   setForm({...defaults});
  },editing?"Mailbox updated.":"Mailbox added disabled. Test connectivity before enabling.");
 }
 function edit(a:Mailbox){
  setForm({id:a.id,display_name:a.display_name||"",address:a.address,provider:a.provider,
   tenant_id:a.tenant_id||"",client_id:a.client_id||"",client_secret:"",api_base:a.api_base||"https://alimail-cn.aliyuncs.com",folder_id:a.folder_id||"",
   active:!!a.active,sync_interval_minutes:a.sync_interval_minutes,initial_lookback_days:a.initial_lookback_days});
  setError("");setNotice("");
 }
 return <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
  <h2 className="font-semibold">Connected company mailboxes / 企业财务邮箱</h2>
  <p className="mt-1 text-xs text-neutral-500">Add one or more mailboxes for this company. Microsoft 365 and Alibaba Mail are polled directly; no MX change or third-party forwarding is required. Credentials are encrypted and are never displayed again.</p>
  {error&&<p role="alert" className="my-3 text-sm text-red-700">{error}</p>}
  {notice&&<p role="status" className="my-3 text-sm">{notice}</p>}
  {!hasKey&&!loading&&<p className="my-3 text-xs text-red-700">Encrypted credentials unavailable: configure OA_SETTINGS_MASTER_KEY.</p>}
  {loading?<p className="mt-3 text-sm text-neutral-500">Loading mail accounts…</p>:<>
   <div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-sm">
    <thead><tr className="text-xs text-neutral-500">{["Mailbox","Provider / Interval","Enabled","Last success","Status / Actions"].map(x=><th key={x} className="p-2">{x}</th>)}</tr></thead>
    <tbody>{accounts.map(a=><tr className="border-t align-top dark:border-neutral-800" key={a.id}>
     <td className="p-2"><strong>{a.display_name||a.address}</strong><div className="text-xs">{a.address}</div></td>
     <td className="p-2">{a.provider==="microsoft365"?"Microsoft 365":"Alibaba Mail"}<div className="text-xs">{a.sync_interval_minutes} min · {a.initial_lookback_days} day initial lookback</div></td>
     <td className="p-2">{a.active?"Enabled":"Disabled"}</td>
     <td className="p-2 text-xs">{a.last_success_at||"Never"}</td>
     <td className="p-2"><div className="flex flex-wrap gap-2">
      <button className={button} type="button" disabled={busy} onClick={()=>edit(a)}>Configure</button>
      <button className={button} type="button" disabled={busy} onClick={()=>void doWork(()=>api(entityId,"test",{id:a.id}),"Connection test succeeded.")}>Test connection</button>
      <button className={button} type="button" disabled={busy||!a.active} onClick={()=>void doWork(()=>api(entityId,"sync",{id:a.id}),"Manual sync complete.")}>Sync now</button>
     </div>{a.last_error&&<p className="mt-1 text-xs text-red-600">{a.last_error}</p>}</td>
    </tr>)}</tbody>
   </table>{!accounts.length&&<p className="p-3 text-sm text-neutral-500">No mailboxes connected to this company yet.</p>}</div>
   <form className="mt-5 space-y-3 border-t pt-4 dark:border-neutral-800" onSubmit={save}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{editing?"Edit mailbox":"Add mailbox"}</h3>{editing&&<button type="button" className={button} onClick={()=>setForm({...defaults})}>New connection / Cancel edit</button>}</div>
    <div className="grid gap-3 md:grid-cols-3">
     <Labeled label="Email provider"><select className={field} disabled={editing} value={form.provider} onChange={e=>patch({provider:e.target.value as Provider,folder_id:""})}>
      <option value="microsoft365">Microsoft 365 / Outlook</option><option value="alibaba_mail">Alibaba Mail / 阿里企业邮箱</option>
     </select></Labeled>
     <Labeled label="Mailbox address"><input className={field} type="email" required readOnly={editing} value={form.address} placeholder="payable@example.com" onChange={e=>patch({address:e.target.value})}/></Labeled>
     <Labeled label="Display name"><input className={field} value={form.display_name} placeholder="AP invoice inbox" onChange={e=>patch({display_name:e.target.value})}/></Labeled>
     <Labeled label="App client ID"><input className={field} required value={form.client_id} onChange={e=>patch({client_id:e.target.value})}/></Labeled>
     <Labeled label={editing?"App client secret (blank = unchanged)":"App client secret"}>
      <input className={field} type="password" autoComplete="new-password" required={!editing} value={form.client_secret} onChange={e=>patch({client_secret:e.target.value})}/>
     </Labeled>
     {form.provider==="microsoft365"?<Labeled label="Microsoft Entra tenant ID"><input className={field} required placeholder="Tenant GUID" value={form.tenant_id} onChange={e=>patch({tenant_id:e.target.value})}/></Labeled>:
      <Labeled label="Alibaba API region"><select className={field} value={form.api_base} onChange={e=>patch({api_base:e.target.value})}>
       <option value="https://alimail-cn.aliyuncs.com">Standard / AI premium</option><option value="https://mail-open.xc.aliyun.com">Domestic deployment</option>
      </select></Labeled>}
     <Labeled label="Folder ID (optional)"><input className={field} placeholder={form.provider==="microsoft365"?"inbox":"2 (Inbox)"} value={form.folder_id} onChange={e=>patch({folder_id:e.target.value})}/></Labeled>
     <Labeled label="Sync interval (minutes)"><input className={field} type="number" min={5} max={1440} value={form.sync_interval_minutes} onChange={e=>patch({sync_interval_minutes:Number(e.target.value)})}/></Labeled>
     <Labeled label="Initial import window (days)"><input className={field} type="number" min={1} max={30} value={form.initial_lookback_days} onChange={e=>patch({initial_lookback_days:Number(e.target.value)})}/></Labeled>
    </div>
    {editing&&<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={e=>patch({active:e.target.checked})}/>Enable scheduled synchronization</label>}
    <button className={primary} disabled={busy||!hasKey}>{editing?"Save mailbox settings":"Add connection (disabled)"}</button>
   </form>
   <details className="mt-4 border-t pt-3 dark:border-neutral-800"><summary className="cursor-pointer text-sm font-semibold">Recent synchronization history</summary>
    <div className="mt-2 overflow-x-auto"><table className="min-w-full text-left text-xs"><thead><tr>{["Mailbox","Started","Result","Scanned","Imported","Duplicates","Error"].map(x=><th className="p-2" key={x}>{x}</th>)}</tr></thead><tbody>{logs.map((l,i)=><tr key={i} className="border-t dark:border-neutral-800"><td className="p-2">{accounts.find(a=>a.id===l.account_id)?.address||l.account_id}</td><td className="p-2">{l.started_at}</td><td className="p-2">{l.status}</td><td className="p-2">{l.scanned_count}</td><td className="p-2">{l.imported_count}</td><td className="p-2">{l.duplicate_count}</td><td className="p-2">{l.error_text||""}</td></tr>)}</tbody></table></div>
   </details>
  </>}
 </section>;
}
