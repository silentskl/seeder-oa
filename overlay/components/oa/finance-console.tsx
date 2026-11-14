"use client";
import {FormEvent,useCallback,useEffect,useRef,useState} from "react";
import {MailAccountsPanel} from "./finance-mail-accounts";
import {FinanceAiPanel} from "./finance-ai-panel";
import {FinanceBalances,type FinanceBalanceRow} from "./finance-balances";
import {invoiceReviewChecks,invoiceReviewVerified} from "@/lib/oa/finance-review-checks";
import {useFinanceLanguage,financeTr,financeError} from "@/lib/oa/finance-i18n";

type Row=Record<string,any>;
type Section="parties"|"ledger";
const input="w-full rounded-md border border-neutral-300 bg-white p-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-white";
const btn="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900";
const primary=btn+" bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-950";
const card="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950";
const emptyParty={party_type:"supplier",company_name:"",address:"",contact_name:"",email:"",phone:"",bank_name:"",bank_account:"",bank_swift:"",root_id:"",assigned_approver_user_id:""};
const duplicateReasonLabel=(reason:string,lang:"en"|"zh")=>({same_fields:financeTr(lang,"Same number and details","发票号和信息一致"),amount_conflict:financeTr(lang,"Amount or currency differs","金额或币种不一致"),date_conflict:financeTr(lang,"Invoice date differs","开票日期不一致"),amount_and_date_conflict:financeTr(lang,"Amount and date differ","金额与日期不一致"),details_missing:financeTr(lang,"Some fields are missing","部分字段缺失"),legacy_same_number_party:financeTr(lang,"Historical duplicate candidate","历史疑似重复")} as Record<string,string>)[reason]||financeTr(lang,"Invoice number matches","发票编号相同");
function overdueDays(dueDate:unknown,status:unknown):number{
 if(!["open","settlement_pending","needs_review"].includes(String(status))||typeof dueDate!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(dueDate))return 0;
 const due=Date.parse(dueDate+"T00:00:00Z");
 if(!Number.isFinite(due))return 0;
 const today=new Date(),todayEpoch=Date.UTC(today.getFullYear(),today.getMonth(),today.getDate());
 return Math.max(0,Math.floor((todayEpoch-due)/86400000));
}
const emptyReview={id:"",direction:"ap",party_root_id:"",counterparty_name:"",invoice_number:"",invoice_date:"",due_date:"",currency:"SGD",amount:"",invoice_bank_account:"",invoice_bank_name:"",invoice_bank_swift:""};
function amount(minor:number|string|null,currency:string){
 try{const c=currency||"SGD",digits=new Intl.NumberFormat("en",{style:"currency",currency:c}).resolvedOptions().maximumFractionDigits??2;
 return new Intl.NumberFormat("en",{style:"currency",currency:c}).format(Number(minor||0)/(10**digits));}catch{return String(minor||"—");}
}
function major(minor:number|string|null,currency:string){
 try{const digits=new Intl.NumberFormat("en",{style:"currency",currency:currency||"SGD"}).resolvedOptions().maximumFractionDigits??2;
 return String(Number(minor||0)/10**digits);}catch{return "";}
}
async function request(entityId:string,action:string,data:Record<string,unknown>={}){
 const res=await fetch("/api/oa/finance",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({entity_id:entityId,action,...data})});
 const json=await res.json().catch(()=>null);
 if(!res.ok||!json?.ok)throw new Error(json?.error||"Finance HTTP "+res.status);
 return json.data;
}
async function fetchView(entityId:string,view:string){
 const res=await fetch("/api/oa/finance?entity_id="+encodeURIComponent(entityId)+"&view="+encodeURIComponent(view),{cache:"no-store"});
 const json=await res.json().catch(()=>null);
 if(!res.ok||!json?.ok)throw new Error(json?.error||"Unable to load "+view);
 return json.data;
}
async function fetchInvoicePage(entityId:string,offset:number){
 const res=await fetch("/api/oa/finance?entity_id="+encodeURIComponent(entityId)+"&view=invoices&offset="+encodeURIComponent(String(offset)),{cache:"no-store"});
 const result=await res.json().catch(()=>null);
 if(!res.ok||!result?.ok)throw new Error(result?.error||"Unable to load invoice page");
 return result.data as Row[];
}
async function upload(entityId:string,purpose:"invoice"|"settlement",file:File){
 const form=new FormData();form.set("entity_id",entityId);form.set("purpose",purpose);form.set("file",file);
 const res=await fetch("/api/oa/finance/documents",{method:"POST",body:form});
 const json=await res.json().catch(()=>null);
 if(!res.ok||!json?.ok)throw new Error(json?.error||"Attachment upload failed");
 return json.data.id as string;
}
const fileUrl=(entity:string,id:string)=>"/api/oa/finance/documents/"+encodeURIComponent(id)+"?entity_id="+encodeURIComponent(entity);
function Field({label,name,value,onChange,type="text",required=false,disabled=false}:{label:string;name:string;value:any;onChange:(v:string)=>void;type?:string;required?:boolean;disabled?:boolean}){
 return <label className="block text-xs font-medium"><span className="mb-1 block text-neutral-500">{label}</span><input className={input} name={name} type={type} value={value??""} required={required} disabled={disabled} onChange={e=>onChange(e.target.value)}/></label>;
}
function ProofForm({entity,invoice,busy,run,lang}:{entity:string;invoice:Row;busy:boolean;run:(task:()=>Promise<any>,message:string)=>Promise<void>;lang:"en"|"zh"}){
 const t=(en:string,zh:string)=>financeTr(lang,en,zh);
 return <form className="flex flex-wrap items-center gap-2" onSubmit={e=>{
   e.preventDefault();const f=new FormData(e.currentTarget),file=f.get("file");
   if(!(file instanceof File)||!file.size)return;
   if(!window.confirm(t("Submit payment / receipt evidence for administrator approval?","确认提交收付款凭证供管理员审批？")))return;
   void run(async()=>{const document_id=await upload(entity,"settlement",file);await request(entity,"settlement_submit",{invoice_id:invoice.id,document_id,approver_id:f.get("approver_id")||""});},t("Proof submitted for approval.","凭证已提交审批。"));
  }}>
  <input aria-label={t("Bank proof","银行凭证")} type="file" name="file" required accept=".pdf,.png,.jpg,.jpeg,.webp" className="max-w-52 text-xs"/>
  <button type="submit" className={btn} disabled={busy}>{invoice.direction==="ar"?t("Record receipt (upload proof)","登记收款（上传凭证）"):t("Record payment (upload proof)","登记付款（上传凭证）")}</button>
 </form>;
}
export function FinanceConsole({section}:{section:Section}){
 const [lang]=useFinanceLanguage();
 const t=(en:string,zh:string)=>financeTr(lang,en,zh);
 const selectedEntity=useRef("legacy-primary");
 const requestVersion=useRef(0);
 const [entity,setEntity]=useState("legacy-primary"),[entities,setEntities]=useState<Row[]>([]);
 const [parties,setParties]=useState<Row[]>([]),[invoices,setInvoices]=useState<Row[]>([]),[settlements,setSettlements]=useState<Row[]>([]);
 const [balances,setBalances]=useState<FinanceBalanceRow[]>([]);
 const [invoiceOffset,setInvoiceOffset]=useState(0),[hasMoreInvoices,setHasMoreInvoices]=useState(false);
 const [activeTab,setActiveTab]=useState<"data"|"config">("data");
 const [configTab,setConfigTab]=useState<"mailboxes"|"ai"|"calls">("mailboxes");
 const [statusFilter,setStatusFilter]=useState("all");
 const [config,setConfig]=useState<Row>({mailbox:"",approvers:[],aiConfigured:false,resendConfigured:false});
 const [party,setParty]=useState<Row>({...emptyParty}),[review,setReview]=useState<Row>({...emptyReview});
 const [mailbox,setMailbox]=useState(""),[receiveAddress,setReceiveAddress]=useState(""),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [error,setError]=useState(""),[notice,setNotice]=useState("");
 const [directionFilter,setDirectionFilter]=useState("ar");
 const load=useCallback(async(id:string)=>{
  if(id!==selectedEntity.current)return;
  const seq=++requestVersion.current;
  if(section==="parties"){
   const [p,c]=await Promise.all([fetchView(id,"parties"),fetchView(id,"config")]);
   if(seq!==requestVersion.current||id!==selectedEntity.current)return;
   setParties(p);setConfig(c);
   return;
  }
  const [p,i,s,c,b]=await Promise.all([fetchView(id,"parties"),fetchInvoicePage(id,0),fetchView(id,"settlements"),fetchView(id,"config"),fetchView(id,"balances")]);
  if(seq!==requestVersion.current||id!==selectedEntity.current)return;
  setParties(p);setInvoices(i);setInvoiceOffset(i.length);setHasMoreInvoices(i.length===300);setSettlements(s);setBalances(b);setConfig(c);setMailbox(c.mailbox||"");setReceiveAddress(c.receiveAddress||c.mailbox||"");
 },[section]);
 useEffect(()=>{
  let active=true;
  (async()=>{
   const res=await fetch("/api/oa/finance/entities",{cache:"no-store"});const json=await res.json();
   const available:Row[]=json?.data?.entities||[];
   const enabled=!!json?.data?.multiEntityEnabled;
   const shown=available.filter(x=>x.role==="admin"&&(enabled||x.id==="legacy-primary"));
   if(!active)return;
   setEntities(shown);
   const saved=window.sessionStorage.getItem("oa.selectedEntity");
   const id=shown.some(x=>x.id===saved)?saved||"legacy-primary":shown[0]?.id||"legacy-primary";
   selectedEntity.current=id;
   setEntity(id);
   await load(id);
  })().catch(e=>{if(active)setError(e instanceof Error?e.message:String(e));}).finally(()=>{if(active)setLoading(false);});
  return ()=>{active=false;};
 },[load]);
 async function run(task:()=>Promise<any>,message:string){
  const company=entity;
  setBusy(true);setError("");setNotice("");
  try{await task();setNotice(message);}
  catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{
   // Refresh even on error so failed re-extractions replace the old stored note
   // with the latest diagnostic result from the server.
   try{await load(company);}
   catch(e){setError(e instanceof Error?e.message:String(e));}
   setBusy(false);
  }
 }
 function selectEntity(id:string){
  selectedEntity.current=id;requestVersion.current++;
  setEntity(id);setLoading(true);setError("");setParty({...emptyParty});setReview({...emptyReview});setActiveTab("data");setConfigTab("mailboxes");setInvoices([]);setInvoiceOffset(0);setHasMoreInvoices(false);
  window.sessionStorage.setItem("oa.selectedEntity",id);
  void load(id).catch(e=>setError(String(e))).finally(()=>setLoading(false));
 }
 async function loadMoreInvoices(){
  if(busy||!hasMoreInvoices)return;
  const company=entity;
  setBusy(true);setError("");
  try{
   const next=await fetchInvoicePage(company,invoiceOffset);
   if(selectedEntity.current!==company)return;
   setInvoices(prev=>{
    const ids=new Set(prev.map(x=>x.id));
    return [...prev,...next.filter(x=>!ids.has(x.id))];
   });
   setInvoiceOffset(prev=>prev+next.length);
   setHasMoreInvoices(next.length===300);
  }catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setBusy(false);}
 }
 const approved=parties.filter(p=>p.status==="approved"),pending=parties.filter(p=>p.status==="pending");
 const admins:Row[]=config.approvers||[];
 const approvedParty=approved.find(p=>p.root_id===review.party_root_id&&(p.party_type==="both"||p.party_type===(review.direction==="ap"?"supplier":"customer")));
 const checks=invoiceReviewChecks({counterparty_name:review.counterparty_name,invoice_bank_name:review.invoice_bank_name,invoice_bank_account:review.invoice_bank_account,invoice_bank_swift:review.invoice_bank_swift,currency:review.currency},approvedParty);
 const reviewVerified=!!approvedParty&&invoiceReviewVerified(checks);
 const shownInvoices=invoices.filter(i=>i.direction===directionFilter&&(statusFilter==="all"||(statusFilter==="possible_duplicate"?i.duplicate_status==="possible":i.status===statusFilter)));
 const assignee=(assigned:string|null,action:string,id:string)=>(
  <select aria-label="Assign approving admin" className={input+" max-w-52"} value={assigned||""} disabled={busy}
    onChange={e=>{if(e.target.value)void run(()=>request(entity,action,{id,approver_id:e.target.value}),t("Approver assigned.","已指派审批人。"));}}>
   <option value="">{t("Any other admin","任意其他管理员")}</option>{admins.map(a=><option key={a.id} value={a.id}>{a.name||a.email}</option>)}
  </select>
 );
 return <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">{section==="parties"?t("Suppliers & Customers","供应商与客户"):t("Finance · AR / AP","应收应付账款")}</h1>
   <p className="text-sm text-neutral-500">{t("Company-scoped records · administrator approval · audit trail","数据按公司隔离 · 管理员审批 · 全程审计")}</p></div>
   {entities.length>1&&<select className={input+" max-w-72"} value={entity} onChange={e=>selectEntity(e.target.value)}>{entities.map(x=><option key={x.id} value={x.id}>{x.display_name}</option>)}</select>}
  </div>
  <div role="tablist" aria-label={section==="parties"?t("Suppliers and customers","供应商与客户"):t("AR and AP","应收应付")} className="flex gap-1 border-b border-neutral-200 pb-2 dark:border-neutral-800">
   {(["data","config"] as const).map(tab=><button key={tab} type="button" role="tab" aria-selected={activeTab===tab}
    className={btn+(activeTab===tab?" bg-neutral-900 text-white dark:bg-white dark:text-black":"")}
    onClick={()=>setActiveTab(tab)}>{tab==="data"?t("Data","数据"):t("Configuration","配置")}</button>)}
  </div>
  {error&&<div role="alert" className="rounded-md border border-red-300 p-3 text-sm text-red-700">{financeError(lang,error)}</div>}
  {notice&&<div role="status" className="rounded-md border p-3 text-sm">{notice}</div>}
  {loading?<p className="text-sm text-neutral-500">{t("Loading finance records…","正在加载财务数据…")}</p>:section==="parties"?<>
   {activeTab==="config"&&<>
   <section className={card}>
    <h2 className="mb-3 font-semibold">{party.root_id?t("Propose a change to approved company","申请修改已批准企业资料"):t("Add supplier or customer","新增供应商或客户")}</h2>
     <p className="text-xs text-neutral-500">{t("Company administrators may approve counterparty proposals. Receipt and payment proofs require a separate reviewer.","公司管理员可以审批供应商／客户资料申请；收付款凭证仍须另一名管理员独立审批。")}</p>
    <p className="mb-3 text-xs text-neutral-500">{t("New or updated bank details require approval before use.","新增或变更的银行信息须经审批才能生效。")}</p>
    <form className="space-y-3" onSubmit={e=>{e.preventDefault();void run(async()=>{await request(entity,"party_propose",party);setParty({...emptyParty});},t("Company proposal submitted.","公司资料申请已提交。"));}}>
     <div className="grid gap-3 md:grid-cols-3">
      <label className="text-xs">{t("Type","类型")}<select className={input+" mt-1"} value={party.party_type} onChange={e=>setParty(s=>({...s,party_type:e.target.value}))}>
       <option value="supplier">{t("Supplier","供应商")}</option><option value="customer">{t("Customer","客户")}</option><option value="both">{t("Both","两者")}</option></select></label>
      {([[t("Company name","公司名称"),"company_name"],[t("Address","地址"),"address"],[t("Contact name","联系人"),"contact_name"],[t("Email","电子邮箱"),"email"],[t("Telephone","电话"),"phone"],[t("Bank name","银行名称"),"bank_name"],[t("Bank account","银行账号"),"bank_account"],["SWIFT/BIC","bank_swift"]] as const).map(([label,k])=><Field key={k} label={label} name={k} value={party[k]}
       type={k==="email"?"email":"text"} required={k==="company_name"} onChange={v=>setParty(s=>({...s,[k]:v}))}/>)}
      <label className="text-xs">{t("Approving admin (optional)","审批管理员（可选）")}<select className={input+" mt-1"} value={party.assigned_approver_user_id||""} onChange={e=>setParty(s=>({...s,assigned_approver_user_id:e.target.value}))}>
       <option value="">{t("Any other admin","任意其他管理员")}</option>{admins.map(a=><option key={a.id} value={a.id}>{a.name||a.email}</option>)}</select></label>
     </div>
     <div className="flex gap-2"><button disabled={busy} className={primary}>{t("Submit for approval","提交审批")}</button>{party.root_id&&<button type="button" className={btn} onClick={()=>setParty({...emptyParty})}>{t("Cancel editing","取消编辑")}</button>}</div>
    </form>
   </section>
   <section className={card}><h2 className="mb-3 font-semibold">{t("Pending company approvals","待审批公司资料")} ({pending.length})</h2>
    {!pending.length?<p className="text-sm text-neutral-500">{t("No pending proposals.","暂无待审批申请。")}</p>:pending.map(p=><div key={p.id} className="mb-3 rounded-lg border p-3 text-sm dark:border-neutral-800">
     <div className="font-semibold">{p.company_name} · {p.party_type}</div>
     <p className="text-xs text-neutral-500">{p.address} · {p.contact_name} · {p.email} · {p.phone}</p>
     <p className="mt-1 text-xs">{t("Bank","银行")}: {p.bank_name} / {p.bank_account} / {p.bank_swift}</p>
     <p className="mb-2 text-xs text-neutral-500">{t("Requested by","申请人")} {p.created_by} · {p.created_at}</p>
     <div className="flex flex-wrap items-center gap-2">{assignee(p.assigned_approver_user_id,"party_assign",p.id)}
      <button className={primary} disabled={busy} onClick={()=>void run(()=>request(entity,"party_approve",{id:p.id}),t("Company approved.","公司资料已批准。"))}>{t("Approve","批准")}</button>
      <button className={btn} disabled={busy} onClick={()=>void run(()=>request(entity,"party_reject",{id:p.id,note:window.prompt(t("Rejection reason","拒绝原因"))||""}),t("Company change rejected.","公司资料变更已拒绝。"))}>{t("Reject","拒绝")}</button>
     </div>
    </div>)}
   </section>
   </>}
   {activeTab==="data"&&<>
   {(["supplier","customer"] as const).map(kind=><section key={kind} className={card}><h2 className="mb-3 font-semibold">{t("Approved","已批准")} {kind==="supplier"?t("Suppliers","供应商"):t("Customers","客户")} ({approved.filter(p=>p.party_type===kind||p.party_type==="both").length})</h2>
    <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="text-xs text-neutral-500">{[t("Company","公司"),t("Type","类型"),t("Contact","联系人"),t("Bank details","银行资料"),t("Manage","管理")].map(x=><th key={x} className="p-2">{x}</th>)}</tr></thead>
     <tbody>{approved.filter(p=>p.party_type===kind||p.party_type==="both").map(p=><tr key={p.id} className="border-t dark:border-neutral-800"><td className="p-2"><div className="font-semibold">{p.company_name}</div><div className="text-xs">{p.address}</div></td><td className="p-2">{p.party_type}</td>
      <td className="p-2">{p.contact_name}<div className="text-xs">{p.email} {p.phone}</div></td>
      <td className="p-2">{p.bank_name}<div className="text-xs">{p.bank_account} · {p.bank_swift}</div></td>
      <td className="p-2"><button className={btn} onClick={()=>{setParty({party_type:p.party_type,company_name:p.company_name,address:p.address,contact_name:p.contact_name,email:p.email,phone:p.phone,bank_name:p.bank_name,bank_account:p.bank_account,bank_swift:p.bank_swift,root_id:p.root_id,assigned_approver_user_id:""});setActiveTab("config");window.scrollTo({top:0,behavior:"smooth"});}}>{t("Propose change","申请修改")}</button></td>
     </tr>)}</tbody></table></div>
   </section>)}
   </>}
  </>:<>
   {activeTab==="config"&&<>
   <div role="tablist" aria-label={t("Finance configuration","财务配置")} className="flex flex-wrap gap-2 border-b pb-2 dark:border-neutral-800">
    {([["mailboxes",t("Connected company mailboxes","企业财务邮箱")],["ai",t("ModelBridge AI settings","ModelBridge AI 设置")],["calls",t("Recent ModelBridge calls","最近 ModelBridge 调用")]] as const).map(([tab,label])=><button type="button" key={tab} role="tab" aria-selected={configTab===tab} className={btn+(configTab===tab?" bg-neutral-900 text-white dark:bg-white dark:text-black":"")} onClick={()=>setConfigTab(tab)}>{label}</button>)}
   </div>
   {configTab==="ai"&&<FinanceAiPanel key={entity+"-ai"} entityId={entity} lang={lang} mode="settings"/>}
   {configTab==="calls"&&<FinanceAiPanel key={entity+"-calls"} entityId={entity} lang={lang} mode="calls"/>}
   {configTab==="mailboxes"&&<>
   <MailAccountsPanel entityId={entity} lang={lang}/>
   <details className={card}><summary className="cursor-pointer font-semibold">{t("Legacy Resend forwarding (optional)","旧版 Resend 转发（可选）")}</summary>
   <section className="mt-3">
    <h2 className="text-sm font-semibold">{t("Resend mailbox configuration","Resend 邮箱配置")}</h2>
    <p className="mb-3 mt-1 text-xs text-neutral-500">{t("Use Resend Inbound or forward to a receiving address. The webhook must point to /api/oa/finance/inbound. Imported invoices require review.","可使用 Resend 入站邮件或转发邮箱，回调地址为 /api/oa/finance/inbound。导入发票仍需人工审核。")}</p>
    <form className="flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();void run(()=>request(entity,"set_mailbox",{address:mailbox,receive_address:receiveAddress}),t("Finance mailbox saved.","财务邮箱已保存。"));}}>
     <div className="min-w-64 flex-1"><Field label={t("Incoming invoice mailbox","发票接收邮箱")} name="mailbox" value={mailbox} type="email" required onChange={setMailbox}/></div>
     <div className="min-w-64 flex-1"><Field label={t("Actual Resend receiving address (if forwarded)","Resend 接收地址（如转发）")} name="receive_address" value={receiveAddress} type="email" onChange={setReceiveAddress}/></div>
     <button className={btn} disabled={busy}>{t("Save mailbox","保存邮箱")}</button>
    </form>
    <p className="mt-3 text-xs text-neutral-500">{t("Resend inbound","Resend 入站邮件")}: {config.resendConfigured?t("configured","已配置"):t("not configured","未配置")}</p>
   </section></details>
   <section className={card}><h2 className="mb-3 font-semibold">{t("Import an invoice manually","手动导入发票")}</h2>
    <form className="flex flex-wrap items-center gap-2" onSubmit={e=>{e.preventDefault();const fd=new FormData(e.currentTarget),file=fd.get("file");
     if(!(file instanceof File)||!file.size)return;
     void run(async()=>{const document_id=await upload(entity,"invoice",file);await request(entity,"invoice_import",{document_id,subject:fd.get("subject")});},t("Invoice imported for review.","发票已导入待审核。"));}}>
     <input className={input+" max-w-72"} name="subject" placeholder={t("Invoice subject (optional)","发票主题（可选）")}/>
     <input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png,.webp" className="text-xs"/>
     <button className={btn} disabled={busy}>{t("Upload & extract","上传并识别")}</button>
    </form>
   </section>
   </>}
   </>}
   {activeTab==="data"&&<>
   <FinanceBalances rows={balances} lang={lang}/>
   <section className={card}><div className="mb-3 flex flex-wrap items-center justify-between gap-2">
    <h2 className="font-semibold">{directionFilter==="ar"?t("Accounts Receivable","应收账款"):directionFilter==="ap"?t("Accounts Payable","应付账款"):t("Needs classification","待分类")} ({shownInvoices.length})</h2>
    <div className="flex flex-wrap items-center gap-2">
     {( [["ar",t("Accounts receivable","应收账款")],["ap",t("Accounts payable","应付账款")],["unknown",t("Unclassified","待分类")]] as const).map(([v,label])=><button key={v} type="button" className={btn+(directionFilter===v?" font-bold underline":"")} onClick={()=>{setDirectionFilter(v);setStatusFilter("all");}}>{label}</button>)}
     <select aria-label={t("Filter invoice status","筛选发票状态")} className={input+" max-w-52"} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
      <option value="all">{t("All statuses","全部状态")}</option><option value="possible_duplicate">{t("Possible duplicates","疑似重复")}</option><option value="needs_review">{t("Needs review","待审核")}</option>
      <option value="open">{directionFilter==="ar"?t("Unreceived","未收款"):t("Unpaid","未付款")}</option>
      <option value="settlement_pending">{t("Proof pending approval","凭证待审核")}</option>
      <option value="settled">{directionFilter==="ar"?t("Received","已收款"):t("Paid","已付款")}</option>
      <option value="rejected">{t("Rejected","已拒绝")}</option>
     </select>
    </div>
   </div>
    <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="text-xs text-neutral-500">{[t("Invoice","发票"),t("Counterparty / Type","往来单位与类型"),t("Amount / Due","金额与到期日"),t("Bank check","银行校验"),t("Status","状态"),t("Actions","操作")].map(t=><th key={t} className="p-2">{t}</th>)}</tr></thead><tbody>
     {shownInvoices.map(i=><tr key={i.id} className={"border-t align-top "+(overdueDays(i.due_date,i.status)>0?"bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200":"dark:border-neutral-800")}>
      <td className="p-2"><div className="font-medium">{i.invoice_number||t("Unrecognized","未识别")}</div><div className="text-xs">{i.invoice_date||"—"}</div><a className="text-xs underline" href={fileUrl(entity,i.document_id)}>{t("Original invoice","原始发票")}</a></td>
      <td className="p-2">{i.approved_party_name||i.counterparty_name||t("Unmatched","未匹配")}<div className="text-xs">{String(i.direction).toUpperCase()} · {i.source}</div>{i.source_mailbox&&<div className="text-xs text-neutral-500">{i.source_mailbox} · {i.source_provider}</div>}</td>
      <td className="p-2">{i.amount_minor!=null?amount(i.amount_minor,i.currency):"—"}<div className="text-xs">{t("Due","到期日")} {i.due_date||"—"}{i.due_date_inferred===1&&<span className="ml-1 text-amber-700 dark:text-amber-300">{t("(estimated +30 days)","（推算 +30 天）")}</span>}</div>{overdueDays(i.due_date,i.status)>0&&<div className="text-xs font-bold text-red-700 dark:text-red-300">{t("Overdue by","已逾期")} {overdueDays(i.due_date,i.status)} {t("days","天")}</div>}</td>
      <td className="p-2">{i.direction==="ar"?<span className="text-xs text-neutral-500">{t("AR receiving bank account","应收发票收款账户")}</span>:<span className={i.bank_check==="mismatch"?"text-red-600 font-semibold":""}>{i.bank_check}</span>}<div className="text-xs">{i.invoice_bank_account||t("No account","无银行账号")}</div></td>
      <td className="p-2"><span className="font-medium">{i.status==="open"?(i.direction==="ar"?t("Unreceived","未收款"):t("Unpaid","未付款")):i.status==="settlement_pending"?t("Proof pending approval","待核销审核"):i.status==="settled"?(i.direction==="ar"?t("Received","已收款"):t("Paid","已付款")):i.status==="needs_review"?t("Needs review","待审核"):i.status}</span>
       <div className="text-xs">{i.extraction_note||""}</div>
       {i.duplicate_status==="possible"&&<div role="alert" className="mt-2 rounded-md border border-amber-500 bg-amber-50 p-2 text-xs text-amber-950 dark:bg-amber-950 dark:text-amber-100">
        <div className="font-semibold">{t("Possible duplicate invoice","疑似重复发票")}</div>
        <div>{duplicateReasonLabel(i.duplicate_reason,lang)}</div>
        <div>{t("Linked invoice","关联发票")}: <strong>{i.duplicate_of_number||i.duplicate_of_invoice_id||"Existing invoice"}</strong> · {i.duplicate_of_status||"—"}</div>
        {i.duplicate_of_document_id&&<a className="underline" href={fileUrl(entity,i.duplicate_of_document_id)} target="_blank" rel="noopener noreferrer">{t("Compare original invoice","对照原始发票")}</a>}
        <div className="mt-1">{t("Not booked until reviewed. Confirm or clear with a reason.","审核前不计入账款。请确认重复或填写理由排除。")}</div>
       </div>}
       {i.duplicate_status==="dismissed"&&<div className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">{t("Duplicate warning cleared","重复提示已人工排除")} · {i.duplicate_decision_note}</div>}
       {i.duplicate_status==="confirmed"&&<div className="mt-1 text-xs text-neutral-500">{t("Confirmed duplicate (excluded from ledger)","已确认重复（不予入账）")}</div>}
       {i.last_ai_outcome&&<div className="mt-1 rounded border p-2 text-xs dark:border-neutral-700">
        <div className="font-medium">{t("Latest AI","最近 AI 调用")}: {i.last_ai_outcome} · HTTP {i.last_ai_http_status??"—"} · {i.last_ai_response_status||"—"}</div>
        <div>{t("Output tokens","输出 Token")}: {i.last_ai_output_tokens??"—"} · {t("Reasoning tokens","推理 Token")}: {i.last_ai_reasoning_tokens??"—"} · {t("Reason","原因")}: {i.last_ai_finish_reason||"—"}</div>
        <div>{t("Response shape","响应格式")}: {i.last_ai_output_types||"—"}</div>
        {i.last_ai_request_id&&<div>{t("Request ID","请求 ID")}: {i.last_ai_request_id}</div>}
       </div>}
      </td>
      <td className="space-y-2 p-2">{i.status==="needs_review"?<>
       {i.duplicate_status==="possible"&&<div className="flex flex-col gap-1">
        <button type="button" className={btn+" border-amber-400"} disabled={busy} onClick={()=>{
         const note=window.prompt(t("Reason this invoice is a duplicate (required):","请填写确认重复的原因（必填）："));
         if(note===null)return;
         void run(()=>request(entity,"invoice_duplicate_confirm",{id:i.id,note}),t("Duplicate confirmed and excluded from AR/AP.","重复发票已确认，不计入应收应付。"));
        }}>{t("Confirm duplicate","确认重复")}</button>
        <button type="button" className={btn} disabled={busy} onClick={()=>{
         const note=window.prompt(t("Why is this a distinct invoice? (at least 8 characters):","请说明为何不是同一张发票（至少 8 个字）："));
         if(note===null)return;
         void run(()=>request(entity,"invoice_duplicate_dismiss",{id:i.id,note}),t("Duplicate warning cleared. Complete invoice review.","疑似重复提示已排除，请继续审核发票。"));
        }}>{t("Clear warning","排除重复")}</button>
       </div>}
       <button className={btn} disabled={busy} onClick={()=>setReview({id:i.id,direction:i.direction==="unknown"?"ap":i.direction,party_root_id:i.party_root_id||"",counterparty_name:i.counterparty_name||"",invoice_number:i.invoice_number||"",invoice_date:i.invoice_date||"",due_date:i.due_date||"",currency:i.currency||"SGD",amount:major(i.amount_minor,i.currency),invoice_bank_account:i.invoice_bank_account||"",invoice_bank_name:i.invoice_bank_name||"",invoice_bank_swift:i.invoice_bank_swift||""})}>{t("Review","审核")}</button>
       <button className={btn} disabled={busy} onClick={()=>void run(async()=>{try{const result=await request(entity,"invoice_reextract",{id:i.id});setReview({...emptyReview});return result;}finally{window.dispatchEvent(new Event("finance-ai-call-updated"));}},t("AI re-extraction completed; verify fields before confirming.","AI 重新识别已完成，请核对资料后再确认。"))}>{busy?t("Processing…","处理中…"):t("Re-extract AI","重新 AI 识别")}</button>
       <button className={btn} disabled={busy} onClick={()=>void run(()=>request(entity,"invoice_reject",{id:i.id}),t("Invoice rejected.","发票已拒绝。"))}>Reject</button>
      </>:i.status==="open"?<ProofForm entity={entity} invoice={i} busy={busy} run={run} lang={lang}/>:null}</td>
     </tr>)}</tbody></table></div>
    {hasMoreInvoices&&<div className="mt-3 flex items-center justify-between gap-2">
     <p className="text-xs text-neutral-500">{t("Showing recent invoices. Load older records as needed; balances always cover all approved invoices.","当前显示近期导入的发票。可继续加载历史记录；余额统计始终包含全部已批准发票。")}</p>
     <button type="button" className={btn} disabled={busy} onClick={()=>void loadMoreInvoices()}>{t("Load older invoices","加载更早发票")}</button>
    </div>}
   </section>
   {review.id&&<section className={card}><h2 className="mb-3 font-semibold">{t("Review invoice","审核发票")} · {review.invoice_number||review.id}</h2>
    {invoices.find(i=>i.id===review.id)?.duplicate_status==="possible"&&<p role="alert" className="rounded-md border border-amber-400 p-3 text-sm text-amber-900 dark:text-amber-300">{t("Possible duplicate: compare the originals and resolve the warning before approving.","发现疑似重复发票：请先对照原件并处理重复提示，再批准入账。")}</p>}
    <form className="space-y-3" onSubmit={e=>{e.preventDefault();void run(async()=>{await request(entity,"invoice_review",review);setReview({...emptyReview});},t("Invoice reviewed and opened.","发票审核通过，已计入待结清账款。"));}}>
     <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-xs">AR / AP<select className={input+" mt-1"} value={review.direction} onChange={e=>setReview(s=>({...s,direction:e.target.value,party_root_id:""}))}><option value="ap">{t("AP / Payable","应付账款")}</option><option value="ar">{t("AR / Receivable","应收账款")}</option></select></label>
      <label className="text-xs">{t("Approved counterparty","已批准的往来单位")}<select className={input+" mt-1"} value={review.party_root_id} required onChange={e=>setReview(s=>({...s,party_root_id:e.target.value}))}><option value="">{t("Select...","请选择…")}</option>
       {approved.filter(p=>p.party_type==="both"||p.party_type===(review.direction==="ap"?"supplier":"customer")).map(p=><option key={p.root_id} value={p.root_id}>{p.company_name}</option>)}</select></label>
      {([[t("Invoice company name","发票公司名称"),"counterparty_name"],[t("Bank name","银行名称"),"invoice_bank_name"],[t("Bank account","银行账号"),"invoice_bank_account"],[t("SWIFT / BIC (USD only)","SWIFT / BIC（仅 USD 必填）"),"invoice_bank_swift"],[t("Invoice number","发票编号"),"invoice_number"],[t("Invoice date","开票日期"),"invoice_date"],[t("Due date","到期日"),"due_date"],[t("Currency","币种"),"currency"],[t("Total amount","账单金额"),"amount"]] as const).map(([label,k])=><Field key={k} label={label} name={k} value={review[k]} required={["counterparty_name","invoice_bank_name","invoice_bank_account","invoice_number","currency","amount"].includes(k)||(k==="invoice_bank_swift"&&review.currency.trim().toUpperCase()==="USD")} disabled={k==="amount"&&!reviewVerified} onChange={v=>setReview(s=>({...s,[k]:v}))}/>)}
     </div>
     <div role="status" className="rounded-lg border p-3 dark:border-neutral-800">
      <h3 className="mb-2 font-semibold">{t("Invoice vs approved counterparty","发票与已批准供应商／客户资料对照")}</h3>
      <div className="overflow-x-auto"><table className="w-full text-left text-xs">
       <thead><tr>{[t("Field","项目"),t("Invoice value","发票值"),t("Approved value","已批准资料"),t("Result","结果")].map(label=><th key={label} className="p-2">{label}</th>)}</tr></thead>
       <tbody>{checks.map(x=><tr key={x.field} className={"border-t "+(x.status==="mismatch"||x.status==="missing"?"bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200":"")}>
        <td className="p-2">{({company_name:t("Company name","公司名称"),bank_name:t("Bank name","银行名称"),bank_account:t("Bank account","银行账号"),bank_swift:"SWIFT/BIC"} as Record<string,string>)[x.field]}</td>
        <td className="p-2">{x.actual||"—"}</td><td className="p-2">{x.expected||"—"}</td>
        <td className="p-2 font-semibold">{({match:t("Match","一致"),mismatch:t("Mismatch","不一致"),missing:t("Missing","缺失"),not_required:t("Not required","无需校验")} as Record<string,string>)[x.status]}</td>
       </tr>)}</tbody>
      </table></div>
      <p className={"mt-2 text-sm "+(reviewVerified?"text-emerald-700 dark:text-emerald-300":"text-red-700 dark:text-red-300")}>{reviewVerified?t("All required fields match. You may confirm the amount.","全部必填资料一致，可以确认金额。"):t("Resolve every mismatch before confirming the amount. SWIFT is required only for USD.","必须先解决全部不一致项才能确认金额。只有 USD 发票要求校验 SWIFT。")}</p>
     </div>
     <button className={primary} disabled={busy||!reviewVerified}>{t("Confirm reviewed invoice","确认金额并审核入账")}</button><button type="button" className={btn+" ml-2"} onClick={()=>setReview({...emptyReview})}>{t("Cancel","取消")}</button>
    </form>
   </section>}
   <section className={card}><h2 className="mb-3 font-semibold">{t("Receipt / payment proof approvals","收付款凭证审核")} ({settlements.length})</h2>
    <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr>{[t("Invoice","发票"),t("Type / Amount","类型与金额"),t("Evidence","凭证"),t("Approval","审核"),t("Action","操作")].map(x=><th key={x} className="p-2 text-xs text-neutral-500">{x}</th>)}</tr></thead><tbody>
     {settlements.map(s=><tr key={s.id} className="border-t align-top dark:border-neutral-800"><td className="p-2">{s.invoice_number||s.invoice_id}</td><td className="p-2">{String(s.direction).toUpperCase()} · {amount(s.amount_minor,s.currency)}</td>
      <td className="p-2"><a className="underline" href={fileUrl(entity,s.document_id)}>{s.proof_name||t("Bank proof","银行凭证")}</a></td>
      <td className="p-2">{s.status}<div className="text-xs text-neutral-500">{s.decided_at||s.submitted_at}</div></td>
      <td className="p-2">{s.status==="pending"?<div className="flex flex-wrap gap-2">
       {assignee(s.approver_user_id,"settlement_assign",s.id)}
       <button className={primary} disabled={busy} onClick={()=>void run(()=>request(entity,"settlement_approve",{id:s.id}),s.direction==="ar"?t("Receipt confirmed; invoice marked received.","收款已确认，发票已标记为已收款。"):t("Payment confirmed; invoice marked paid.","付款已确认，发票已标记为已付款。"))}>{t("Approve","批准")} {s.direction==="ar"?t("receipt","收款"):t("payment","付款")}</button>
       <button className={btn} disabled={busy} onClick={()=>void run(()=>request(entity,"settlement_reject",{id:s.id,note:window.prompt(t("Rejection note","拒绝说明"))||""}),t("Bank proof rejected.","银行凭证已拒绝。"))}>Reject</button>
      </div>:null}</td>
     </tr>)}</tbody></table></div>
   </section>
   </>}
  </>}
 </div>;
}