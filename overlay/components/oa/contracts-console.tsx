"use client";
import {FormEvent,useCallback,useEffect,useRef,useState} from "react";
import {financeTr,useFinanceLanguage} from "@/lib/oa/finance-i18n";

type Entity={id:string;display_name:string;role:string};
type Party={root_id:string;party_type:"supplier"|"customer"|"both";company_name:string};
type Contract={
 id:string;party_root_id:string;party_role:"supplier"|"customer";party_name:string;
 title:string;contract_number:string;effective_date:string|null;expiry_date:string|null;
 notes:string;original_name:string;size_bytes:number;created_at:string;
};
type Page={parties:Party[];contracts:Contract[];nextOffset:number|null};
const input="w-full rounded-md border border-neutral-300 bg-white p-2 text-sm text-neutral-950 dark:border-neutral-700 dark:bg-neutral-950 dark:text-white";
const button="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900";
const primary=button+" bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-950";
const card="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950";
async function getJSON<T>(url:string):Promise<T>{
 const res=await fetch(url,{cache:"no-store"});
 const json=await res.json().catch(()=>null);
 if(!res.ok||!json?.ok)throw new Error(json?.error||"Request failed ("+res.status+")");
 return json.data as T;
}
const contractUrl=(entity:string,id:string,download=false)=>
 "/api/oa/contracts/"+encodeURIComponent(id)+"?entity_id="+encodeURIComponent(entity)+(download?"&download=1":"");
const size=(bytes:number)=>bytes>=1048576?(bytes/1048576).toFixed(1)+" MB":Math.ceil(bytes/1024)+" KB";

export function ContractsConsole(){
 const [lang]=useFinanceLanguage();
 const t=(en:string,zh:string)=>financeTr(lang,en,zh);
 const [entities,setEntities]=useState<Entity[]>([]);
 const [entity,setEntity]=useState("");
 const selected=useRef("");
 const [parties,setParties]=useState<Party[]>([]);
 const [contracts,setContracts]=useState<Contract[]>([]);
 const [nextOffset,setNextOffset]=useState<number|null>(null);
 const [role,setRole]=useState<"supplier"|"customer">("supplier");
 const [partyId,setPartyId]=useState("");
 const [filter,setFilter]=useState<"all"|"supplier"|"customer">("all");
 const [search,setSearch]=useState("");
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const load=useCallback(async(id:string,offset=0)=>{
  const url="/api/oa/contracts?entity_id="+encodeURIComponent(id)+"&offset="+offset;
  const data=await getJSON<Page>(url);
  if(selected.current!==id)return;
  setParties(data.parties);
  setContracts(previous=>offset===0?data.contracts:[
   ...previous,...data.contracts.filter(c=>!previous.some(old=>old.id===c.id))
  ]);
  setNextOffset(data.nextOffset);
 },[]);
 useEffect(()=>{
  let active=true;
  (async()=>{
   const r=await getJSON<{entities:Entity[];multiEntityEnabled:boolean}>("/api/oa/finance/entities");
   if(!active)return;
   const available=(r.entities||[]).filter(e=>e.role==="admin"||e.role==="parties_admin");
   setEntities(available);
   const stored=window.sessionStorage.getItem("oa.selectedEntity");
   const id=available.find(e=>e.id===stored)?.id||available[0]?.id||"";
   selected.current=id;setEntity(id);
   if(id)await load(id);
  })().catch(e=>{if(active)setError(e instanceof Error?e.message:String(e));})
    .finally(()=>{if(active)setLoading(false);});
  return ()=>{active=false;selected.current="";};
 },[load]);
 function changeEntity(id:string){
  selected.current=id;setEntity(id);setPartyId("");setContracts([]);setParties([]);
  setNextOffset(null);setError("");setNotice("");setLoading(true);
  window.sessionStorage.setItem("oa.selectedEntity",id);
  void load(id).catch(e=>{if(selected.current===id)setError(String(e));})
   .finally(()=>{if(selected.current===id)setLoading(false);});
 }
 async function upload(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(busy||!entity)return;
  const form=event.currentTarget;
  const fields=new FormData(form);
  fields.set("entity_id",entity);fields.set("party_role",role);fields.set("party_root_id",partyId);
  setBusy(true);setError("");setNotice("");
  try{
   const res=await fetch("/api/oa/contracts",{method:"POST",body:fields});
   const json=await res.json().catch(()=>null);
   if(!res.ok||!json?.ok)throw new Error(json?.error||"Upload failed ("+res.status+")");
   form.reset();setPartyId("");setRole("supplier");
   setNotice(t("Contract uploaded and linked to the counterparty.","合同已上传并关联到往来单位。"));
   await load(entity);
  }catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setBusy(false);}
 }
 async function more(){
  if(nextOffset===null||busy||!entity)return;
  const id=entity;
  setBusy(true);setError("");
  try{await load(id,nextOffset);}catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setBusy(false);}
 }
 const choices=parties.filter(p=>p.party_type===role||p.party_type==="both");
 const shown=contracts.filter(c=>(filter==="all"||c.party_role===filter)
  &&[c.title,c.contract_number,c.party_name,c.original_name].join(" ").toLowerCase().includes(search.toLowerCase()));
 return <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
  <div>
   <h1 className="text-xl font-semibold">{t("Contract Management","合同管理")}</h1>
   <p className="mt-1 text-sm text-neutral-500">{t("Upload and view contracts linked to an approved supplier or customer. Files are private to authorized company managers.","上传及查看关联已批准供应商／客户的合同，文件仅对有权限的公司管理员开放。")}</p>
  </div>
  {entities.length>1&&<label className="block max-w-md text-sm font-medium">{t("Company / Entity","所属公司 / Entity")}
   <select className={input+" mt-1"} value={entity} disabled={busy} onChange={e=>changeEntity(e.target.value)}>
    {entities.map(e=><option key={e.id} value={e.id}>{e.display_name}</option>)}
   </select>
  </label>}
  {error&&<p role="alert" className="rounded-md border border-red-200 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
  {notice&&<p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
  {loading?<p className="text-sm text-neutral-500">{t("Loading contracts…","正在加载合同…")}</p>:!entity?<p className="text-sm text-neutral-500">{t("No permitted company found.","没有可管理的公司。")}</p>:<>
   <section className={card}>
    <h2 className="mb-3 font-semibold">{t("Upload contract","上传合同")}</h2>
    <form onSubmit={e=>void upload(e)} className="grid gap-3 md:grid-cols-2">
     <label className="text-sm">{t("Counterparty category","合同对方类型")}
      <select className={input+" mt-1"} value={role} disabled={busy} onChange={e=>{setRole(e.target.value as "supplier"|"customer");setPartyId("");}}>
       <option value="supplier">{t("Supplier","供应商")}</option><option value="customer">{t("Customer","客户")}</option>
      </select>
     </label>
     <label className="text-sm">{t("Approved counterparty","已批准供应商／客户")}
      <select name="party_root_id" className={input+" mt-1"} value={partyId} onChange={e=>setPartyId(e.target.value)} disabled={busy||!choices.length} required>
       <option value="">{t("Select a counterparty","选择供应商或客户")}</option>
       {choices.map(p=><option key={p.root_id} value={p.root_id}>{p.company_name}</option>)}
      </select>
     </label>
     <label className="text-sm">{t("Contract title","合同名称")}<input name="title" className={input+" mt-1"} required maxLength={200} disabled={busy}/></label>
     <label className="text-sm">{t("Contract number (optional)","合同编号（选填）")}<input name="contract_number" className={input+" mt-1"} maxLength={120} disabled={busy}/></label>
     <label className="text-sm">{t("Effective date (optional)","生效日期（选填）")}<input type="date" name="effective_date" className={input+" mt-1"} disabled={busy}/></label>
     <label className="text-sm">{t("Expiry date (optional)","到期日期（选填）")}<input type="date" name="expiry_date" className={input+" mt-1"} disabled={busy}/></label>
     <label className="text-sm md:col-span-2">{t("Notes (optional)","备注（选填）")}<textarea name="notes" className={input+" mt-1"} maxLength={1000} rows={2} disabled={busy}/></label>
     <label className="text-sm md:col-span-2">{t("Contract file (PDF or image, up to 12 MB)","合同文件（PDF 或图片，最多 12 MB）")}
      <input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className={input+" mt-1"} required disabled={busy}/>
     </label>
     {!choices.length&&<p className="text-xs text-amber-700 md:col-span-2">{t("Approve a supplier/customer before attaching a contract.","请先在供应商与客户管理中审批对应的往来单位。")}</p>}
     <div className="md:col-span-2"><button type="submit" className={primary} disabled={busy||!partyId}>{busy?t("Uploading…","上传中…"):t("Upload & link contract","上传并关联合同")}</button></div>
    </form>
   </section>
   <section className={card}>
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
     <h2 className="font-semibold">{t("Contract library","合同列表")} ({contracts.length}{nextOffset!==null?"+":""})</h2>
     <div className="flex flex-wrap gap-2">
      <select className={input} aria-label={t("Counterparty filter","供应商／客户筛选")} value={filter} onChange={e=>setFilter(e.target.value as typeof filter)}>
       <option value="all">{t("All","全部")}</option><option value="supplier">{t("Suppliers","供应商")}</option><option value="customer">{t("Customers","客户")}</option>
      </select>
      <input className={input} aria-label={t("Search contracts","搜索合同")} placeholder={t("Search title / counterparty","搜索合同／往来单位")} value={search} onChange={e=>setSearch(e.target.value)}/>
     </div>
    </div>
    <div className="overflow-x-auto">
     <table className="min-w-full text-left text-sm">
      <thead className="text-xs text-neutral-500"><tr>
       <th className="p-2">{t("Contract","合同")}</th>
       <th className="p-2">{t("Counterparty","所属供应商／客户")}</th>
       <th className="p-2">{t("Dates","日期")}</th>
       <th className="p-2">{t("File","文件")}</th>
      </tr></thead>
      <tbody>{shown.map(c=><tr key={c.id} className="border-t border-neutral-200 dark:border-neutral-800">
       <td className="p-2"><div className="font-medium">{c.title}</div><div className="text-xs text-neutral-500">{c.contract_number||"—"} · {c.created_at}</div>{c.notes&&<div className="max-w-sm whitespace-pre-wrap text-xs text-neutral-500">{c.notes}</div>}</td>
       <td className="p-2">{c.party_name}<div className="text-xs text-neutral-500">{c.party_role==="supplier"?t("Supplier","供应商"):t("Customer","客户")}</div></td>
       <td className="p-2"><div>{t("Start","开始")}: {c.effective_date||"—"}</div><div>{t("End","结束")}: {c.expiry_date||"—"}</div></td>
       <td className="p-2"><div className="max-w-48 break-all text-xs text-neutral-500">{c.original_name} · {size(c.size_bytes)}</div>
        <div className="mt-1 flex gap-3">
         <a className="underline" href={contractUrl(entity,c.id)} target="_blank" rel="noopener noreferrer">{t("View","查看")}</a>
         <a className="underline" href={contractUrl(entity,c.id,true)}>{t("Download","下载")}</a>
        </div>
       </td>
      </tr>)}</tbody>
     </table>
     {!shown.length&&<p className="p-4 text-sm text-neutral-500">{t("No matching contracts.","暂无符合条件的合同。")}</p>}
    </div>
    {nextOffset!==null&&<button type="button" className={button+" mt-3"} disabled={busy} onClick={()=>void more()}>{t("Load more contracts","加载更多合同")}</button>}
   </section>
  </>}
 </div>;
}
