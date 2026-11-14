"use client";
import {FormEvent,useCallback,useEffect,useRef,useState,type ReactNode} from "react";
import {FinanceMailBackfillPanel} from "./finance-mail-backfill";
import {financeTr,financeError,type FinanceLanguage} from "@/lib/oa/finance-i18n";

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
export function MailAccountsPanel({entityId,lang}:{entityId:string;lang:FinanceLanguage}){
 const t=(en:string,zh:string)=>financeTr(lang,en,zh);
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
  try{const result=await task();await load();setNotice(success+(result&&typeof result==="object"&&"imported" in result?" "+t("Imported","已导入")+" "+String((result as any).imported)+" "+t("invoice(s).","张发票。"):""));}
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
  },editing?t("Mailbox updated.","邮箱配置已更新。"):t("Mailbox added disabled. Test connectivity before enabling.","邮箱已添加（默认关闭）；请先测试连接再启用。"));
 }
 function edit(a:Mailbox){
  setForm({id:a.id,display_name:a.display_name||"",address:a.address,provider:a.provider,
   tenant_id:a.tenant_id||"",client_id:a.client_id||"",client_secret:"",api_base:a.api_base||"https://alimail-cn.aliyuncs.com",folder_id:a.folder_id||"",
   active:!!a.active,sync_interval_minutes:a.sync_interval_minutes,initial_lookback_days:a.initial_lookback_days});
  setError("");setNotice("");
 }
 return <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
  <h2 className="font-semibold">{t("Connected company mailboxes","企业财务邮箱")}</h2>
  <p className="mt-1 text-xs text-neutral-500">{t("Connect Microsoft 365 or Alibaba Mail inboxes without changing MX records. Credentials are stored encrypted.","可连接 Microsoft 365 或阿里邮箱，无需修改 MX 记录。凭证均加密保存。")}</p>
  {error&&<p role="alert" className="my-3 text-sm text-red-700">{financeError(lang,error)}</p>}
  {notice&&<p role="status" className="my-3 text-sm">{notice}</p>}
  {!hasKey&&!loading&&<p className="my-3 text-xs text-red-700">{t("Encrypted credentials unavailable: configure OA_SETTINGS_MASTER_KEY.","加密凭证不可用，请配置 OA_SETTINGS_MASTER_KEY。")}</p>}
  {loading?<p className="mt-3 text-sm text-neutral-500">{t("Loading mail accounts…","正在加载邮箱账户…")}</p>:<>
   <div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-sm">
    <thead><tr className="text-xs text-neutral-500">{[t("Mailbox","邮箱"),t("Provider / Interval","服务商与同步周期"),t("Enabled","启用状态"),t("Last success","最近同步成功"),t("Status / Actions","状态与操作")].map(x=><th key={x} className="p-2">{x}</th>)}</tr></thead>
    <tbody>{accounts.map(a=><tr className="border-t align-top dark:border-neutral-800" key={a.id}>
     <td className="p-2"><strong>{a.display_name||a.address}</strong><div className="text-xs">{a.address}</div></td>
     <td className="p-2">{a.provider==="microsoft365"?"Microsoft 365":"Alibaba Mail"}<div className="text-xs">{a.sync_interval_minutes} {t("min","分钟")} · {a.initial_lookback_days} {t("day initial lookback","天首次回溯")}</div></td>
     <td className="p-2">{a.active?t("Enabled","已启用"):t("Disabled","已停用")}</td>
     <td className="p-2 text-xs">{a.last_success_at||t("Never","从未同步")}</td>
     <td className="p-2"><div className="flex flex-wrap gap-2">
      <button className={button} type="button" disabled={busy} onClick={()=>edit(a)}>{t("Configure","配置")}</button>
      <button className={button} type="button" disabled={busy} onClick={()=>void doWork(()=>api(entityId,"test",{id:a.id}) ,t("Connection test succeeded.","连接测试成功。"))}>{t("Test connection","测试连接")}</button>
      <button className={button} type="button" disabled={busy||!a.active} onClick={()=>void doWork(()=>api(entityId,"sync",{id:a.id}) ,t("Manual sync complete.","手动同步完成。"))}>{t("Sync now","立即同步")}</button>
     </div>{a.last_error&&<p className="mt-1 text-xs text-red-600">{a.last_error}</p>}</td>
    </tr>)}</tbody>
   </table>{!accounts.length&&<p className="p-3 text-sm text-neutral-500">{t("No mailboxes connected to this company yet.","该公司尚未连接财务邮箱。")}</p>}</div>
   <form className="mt-5 space-y-3 border-t pt-4 dark:border-neutral-800" onSubmit={save}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{editing?t("Edit mailbox","编辑邮箱"):t("Add mailbox","添加邮箱")}</h3>{editing&&<button type="button" className={button} onClick={()=>setForm({...defaults})}>{t("New connection / Cancel edit","新建连接／取消编辑")}</button>}</div>
    <div className="grid gap-3 md:grid-cols-3">
     <Labeled label={t("Email provider","邮箱服务商")}><select className={field} disabled={editing} value={form.provider} onChange={e=>patch({provider:e.target.value as Provider,folder_id:""})}>
      <option value="microsoft365">Microsoft 365 / Outlook</option><option value="alibaba_mail">{t("Alibaba Mail","阿里企业邮箱")}</option>
     </select></Labeled>
     <Labeled label={t("Mailbox address","邮箱地址")}><input className={field} type="email" required readOnly={editing} value={form.address} placeholder="payable@example.com" onChange={e=>patch({address:e.target.value})}/></Labeled>
     <Labeled label={t("Display name","显示名称")}><input className={field} value={form.display_name} placeholder={t("AP invoice inbox","应付发票收件箱")} onChange={e=>patch({display_name:e.target.value})}/></Labeled>
     <Labeled label={t("App client ID","应用客户端 ID")}><input className={field} required value={form.client_id} onChange={e=>patch({client_id:e.target.value})}/></Labeled>
     <Labeled label={editing?t("App client secret (blank = unchanged)","应用客户端密钥（留空保持不变）"):t("App client secret","应用客户端密钥")}>
      <input className={field} type="password" autoComplete="new-password" required={!editing} value={form.client_secret} onChange={e=>patch({client_secret:e.target.value})}/>
     </Labeled>
     {form.provider==="microsoft365"?<Labeled label={t("Microsoft Entra tenant ID","Microsoft Entra 租户 ID")}><input className={field} required placeholder="Tenant GUID" value={form.tenant_id} onChange={e=>patch({tenant_id:e.target.value})}/></Labeled>:
      <Labeled label={t("Alibaba API region","阿里云 API 区域")}><select className={field} value={form.api_base} onChange={e=>patch({api_base:e.target.value})}>
       <option value="https://alimail-cn.aliyuncs.com">{t("Standard / AI premium","标准版／AI 高级版")}</option><option value="https://mail-open.xc.aliyun.com">{t("Domestic deployment","国内部署")}</option>
      </select></Labeled>}
     <Labeled label={t("Folder ID (optional)","文件夹 ID（可选）")}><input className={field} placeholder={form.provider==="microsoft365"?"inbox":"2 (Inbox)"} value={form.folder_id} onChange={e=>patch({folder_id:e.target.value})}/></Labeled>
     <Labeled label={t("Sync interval (minutes)","同步间隔（分钟）")}><input className={field} type="number" min={5} max={1440} value={form.sync_interval_minutes} onChange={e=>patch({sync_interval_minutes:Number(e.target.value)})}/></Labeled>
     <Labeled label={t("Initial import window (days)","首次导入范围（天）")}><input className={field} type="number" min={1} max={30} value={form.initial_lookback_days} onChange={e=>patch({initial_lookback_days:Number(e.target.value)})}/></Labeled>
    </div>
    {editing&&<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={e=>patch({active:e.target.checked})}/>{t("Enable scheduled synchronization","启用定时同步")}</label>}
    <button className={primary} disabled={busy||!hasKey}>{editing?t("Save mailbox settings","保存邮箱配置"):t("Add connection (disabled)","新增连接（默认关闭）")}</button>
   </form>
   <FinanceMailBackfillPanel entityId={entityId} accounts={accounts} lang={lang}/>
   <details className="mt-4 border-t pt-3 dark:border-neutral-800"><summary className="cursor-pointer text-sm font-semibold">{t("Recent synchronization history","最近同步记录")}</summary>
    <div className="mt-2 overflow-x-auto"><table className="min-w-full text-left text-xs"><thead><tr>{[t("Mailbox","邮箱"),t("Started","开始时间"),t("Result","结果"),t("Scanned","已扫描"),t("Imported","已导入"),t("Duplicates","重复"),t("Error","错误")].map(x=><th className="p-2" key={x}>{x}</th>)}</tr></thead><tbody>{logs.map((l,i)=><tr key={i} className="border-t dark:border-neutral-800"><td className="p-2">{accounts.find(a=>a.id===l.account_id)?.address||l.account_id}</td><td className="p-2">{l.started_at}</td><td className="p-2">{l.status}</td><td className="p-2">{l.scanned_count}</td><td className="p-2">{l.imported_count}</td><td className="p-2">{l.duplicate_count}</td><td className="p-2">{l.error_text||""}</td></tr>)}</tbody></table></div>
   </details>
  </>}
 </section>;
}
