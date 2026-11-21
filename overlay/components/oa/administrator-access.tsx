"use client";
import {FormEvent,useCallback,useEffect,useState} from "react";
import {financeTr,useFinanceLanguage} from "@/lib/oa/finance-i18n";

type Super={user_id:string;name:string;email:string;level:"founder"|"super_admin"};
type Grant={entity_id:string;display_name:string;user_id:string;name:string;email:string;permission:string};
type Entity={id:string;display_name:string};
type Snapshot={supers:Super[];grants:Grant[];contractGrants:Grant[];entities:Entity[];founderId:string|null;currentUserId:string};
const field="w-full rounded-md border border-neutral-300 bg-white p-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white";
const btn="rounded-md border border-neutral-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-neutral-700";
const primary="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900";
const card="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950";
async function api(action?:string,body?:Record<string,unknown>){
 const response=await fetch("/api/oa/administrators",action?{
  method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,...body})
 }:{cache:"no-store"});
 const json=await response.json();
 if(!response.ok||!json.ok)throw new Error(json.error||"Administrator request failed");
 return json.data;
}
export function AdministratorAccess(){
 const [lang]=useFinanceLanguage();
 const t=(en:string,zh:string)=>financeTr(lang,en,zh);
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
 const [superEmail,setSuperEmail]=useState("");
 const [partyEmail,setPartyEmail]=useState("");
 const [contractEmail,setContractEmail]=useState("");
 const [contractPermission,setContractPermission]=useState<"contracts.view"|"contracts.upload">("contracts.view");
 const [entity,setEntity]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const refresh=useCallback(async()=>{
  const next=await api() as Snapshot;
  setSnapshot(next);
  setEntity(prev=>next.entities.some(x=>x.id===prev)?prev:next.entities[0]?.id||"");
 },[]);
 useEffect(()=>{void refresh().catch(e=>setError(String(e)));},[refresh]);
 async function act(action:string,body:Record<string,unknown>){
  setBusy(true);setError("");setNotice("");
  try{
   await api(action,body);await refresh();
   setNotice(t("Account permissions updated.","账号权限已更新。"));
  }catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setBusy(false);}
 }
 const founder=snapshot?.supers.find(u=>u.user_id===snapshot.founderId);
 return <main className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
  <div><h1 className="text-xl font-semibold">{t("Accounts & permissions","账号与权限")}</h1>
   <p className="mt-1 text-sm text-neutral-500">{t("Manage Entity-scoped supplier/customer and contract permissions, plus super administrators. All changes are audited.","按 Entity 配置供应商/客户与合同查看/上传权限，以及额外超级管理员。所有变更保留审计记录。")}</p>
  </div>
  {error&&<p role="alert" className="rounded-md border border-red-400 p-3 text-sm text-red-700">{error}</p>}
  {notice&&<p role="status" className="rounded-md border p-3 text-sm">{notice}</p>}
  {!snapshot?<p>{t("Loading permissions…","正在加载权限…")}</p>:<>
   <section className={card}>
    <h2 className="font-semibold">{t("Original super administrator · protected","初始超级管理员 · 受保护")}</h2>
    <p className="mt-2 text-sm">{founder?(founder.name+" · "+founder.email):t("No initial owner registered. Sign in with the first owner account to initialize protection.","尚无初始 Owner 记录，请使用最初的 Owner 账号登录以完成保护初始化。")}</p>
    <p className="mt-1 text-xs text-neutral-500">{t("Other administrators cannot edit, demote, deactivate or revoke this account.","其他管理员不能修改、降级、停用或撤销此账号的权限。")}</p>
   </section>
   <section className={card}>
    <h2 className="font-semibold">{t("Super administrators","超级管理员")}</h2>
    <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();void act("setSuperAdmin",{email:superEmail,enabled:true}).then(()=>setSuperEmail(""));}}>
     <input type="email" required className={field+" min-w-56 flex-1"} value={superEmail} onChange={e=>setSuperEmail(e.target.value)} placeholder={t("Existing account email","现有账号邮箱")}/>
     <button className={primary} disabled={busy}>{t("Promote to super administrator","升级为超级管理员")}</button>
    </form>
    <div className="mt-3 divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
     {snapshot.supers.map(u=><div key={u.user_id} className="flex flex-wrap items-center justify-between gap-2 py-3">
      <div><span className="font-medium">{u.name||u.email}</span><span className="ml-2 text-neutral-500">{u.email}</span>
       <div className="text-xs text-neutral-500">{u.level==="founder"?t("Original · immutable","初始管理员 · 不可修改"):t("Additional super administrator","额外超级管理员")}</div>
      </div>
      {u.level!=="founder"&&<button className={btn} disabled={busy||u.user_id===snapshot.currentUserId} onClick={()=>void act("setSuperAdmin",{email:u.email,enabled:false})}>{t("Revoke super admin","撤销超级管理员")}</button>}
     </div>)}
    </div>
   </section>
   <section className={card}>
    <h2 className="font-semibold">{t("Ordinary administrator · Suppliers & Customers","普通管理员 · 供应商与客户")}</h2>
    <p className="mt-1 text-xs text-neutral-500">{t("Permission is granted to one Entity at a time. It does not grant payroll, billing, finance settings or account-management access.","按 Entity 分别授权，不包含薪资、账单、财务配置或账号权限管理。")}</p>
    <form className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto]" onSubmit={(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();void act("setPartyAdmin",{email:partyEmail,entityId:entity,enabled:true}).then(()=>setPartyEmail(""));}}>
     <input type="email" required className={field} value={partyEmail} onChange={e=>setPartyEmail(e.target.value)} placeholder={t("Existing account email","现有账号邮箱")}/>
     <select className={field} value={entity} onChange={e=>setEntity(e.target.value)} aria-label="Entity" required>{snapshot.entities.map(e=><option key={e.id} value={e.id}>{e.display_name}</option>)}</select>
     <button className={primary} disabled={busy||!entity}>{t("Grant permission","授予权限")}</button>
    </form>
    <div className="mt-4 overflow-x-auto">
     <table className="w-full text-left text-sm"><thead><tr className="border-b dark:border-neutral-800"><th className="p-2">{t("Account","账号")}</th><th className="p-2">Entity</th><th className="p-2">{t("Permission","权限")}</th><th className="p-2"></th></tr></thead>
      <tbody>{snapshot.grants.map(g=><tr key={g.entity_id+g.user_id+g.permission} className="border-b dark:border-neutral-800">
       <td className="p-2">{g.name||g.email}<div className="text-xs text-neutral-500">{g.email}</div></td>
       <td className="p-2">{g.display_name}</td>
       <td className="p-2">{t("Manage suppliers & customers","管理供应商及客户")}</td>
       <td className="p-2"><button className={btn} disabled={busy||g.user_id===snapshot.founderId} onClick={()=>void act("setPartyAdmin",{email:g.email,entityId:g.entity_id,enabled:false})}>{t("Revoke","撤销")}</button></td>
      </tr>)}</tbody>
     </table>
     {!snapshot.grants.length&&<p className="p-3 text-sm text-neutral-500">{t("No ordinary administrator grants yet.","暂无普通管理员授权。")}</p>}
    </div>
   </section>
   <section className={card}>
    <h2 className="font-semibold">{t("Contracts · Super administrator authorization","合同管理 · 超级管理员授权")}</h2>
    <p className="mt-1 text-xs text-neutral-500">{t("Contract viewing/downloading and uploading require separate explicit grants from a super administrator, scoped to an Entity and an existing active member. Supplier/customer administration does not include contract access.","查阅／下载合同与上传合同必须由超级管理员按 Entity 分别授权。授权对象必须已是该 Entity 的有效成员。供应商／客户管理权限不会自动附带合同权限。")}</p>
    <form className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]" onSubmit={(e:FormEvent<HTMLFormElement>)=>{
     e.preventDefault();
     void act("setContractPermission",{email:contractEmail,entityId:entity,permission:contractPermission,enabled:true}).then(()=>setContractEmail(""));
    }}>
     <input type="email" className={field} required placeholder={t("Existing account email","现有账号邮箱")} value={contractEmail} onChange={e=>setContractEmail(e.target.value)}/>
     <select className={field} aria-label={t("Contract Entity","合同所属公司")} required value={entity} onChange={e=>setEntity(e.target.value)}>
      {snapshot.entities.map(e=><option key={e.id} value={e.id}>{e.display_name}</option>)}
     </select>
     <select className={field} aria-label={t("Contract permission","合同权限")} value={contractPermission} onChange={e=>setContractPermission(e.target.value as "contracts.view"|"contracts.upload")}>
      <option value="contracts.view">{t("View / download","查阅 / 下载")}</option>
      <option value="contracts.upload">{t("Upload","上传")}</option>
     </select>
     <button className={primary} disabled={busy||!entity}>{t("Grant contract access","授予合同权限")}</button>
    </form>
    <div className="mt-4 overflow-x-auto">
     <table className="w-full text-left text-sm">
      <thead><tr className="border-b dark:border-neutral-800"><th className="p-2">{t("Account","账号")}</th><th className="p-2">Entity</th><th className="p-2">{t("Contract privilege","合同权限")}</th><th className="p-2"></th></tr></thead>
      <tbody>{(snapshot.contractGrants||[]).map(g=><tr key={g.entity_id+g.user_id+g.permission} className="border-b dark:border-neutral-800">
       <td className="p-2">{g.name||g.email}<div className="text-xs text-neutral-500">{g.email}</div></td>
       <td className="p-2">{g.display_name}</td>
       <td className="p-2">{g.permission==="contracts.upload"?t("Upload","上传"):t("View / download","查阅 / 下载")}</td>
       <td className="p-2"><button className={btn} disabled={busy||g.user_id===snapshot.founderId} onClick={()=>void act("setContractPermission",{email:g.email,entityId:g.entity_id,permission:g.permission,enabled:false})}>{t("Revoke","撤销")}</button></td>
      </tr>)}</tbody>
     </table>
     {!(snapshot.contractGrants||[]).length&&<p className="p-3 text-sm text-neutral-500">{t("No delegated contract permissions.","暂无委派的合同权限。")}</p>}
    </div>
   </section>
  </>}
 </main>;
}
