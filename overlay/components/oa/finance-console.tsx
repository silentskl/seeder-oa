"use client";
import {FormEvent,useCallback,useEffect,useRef,useState} from "react";
import {MailAccountsPanel} from "./finance-mail-accounts";
import {FinanceAiPanel} from "./finance-ai-panel";
import {FinanceBalances,type FinanceBalanceRow} from "./finance-balances";

type Row=Record<string,any>;
type Section="parties"|"ledger";
const input="w-full rounded-md border border-neutral-300 bg-white p-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-white";
const btn="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900";
const primary=btn+" bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-950";
const card="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950";
const emptyParty={party_type:"supplier",company_name:"",address:"",contact_name:"",email:"",phone:"",bank_name:"",bank_account:"",bank_swift:"",root_id:"",assigned_approver_user_id:""};
const emptyReview={id:"",direction:"ap",party_root_id:"",invoice_number:"",invoice_date:"",due_date:"",currency:"SGD",amount:"",invoice_bank_account:"",invoice_bank_name:""};
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
async function upload(entityId:string,purpose:"invoice"|"settlement",file:File){
 const form=new FormData();form.set("entity_id",entityId);form.set("purpose",purpose);form.set("file",file);
 const res=await fetch("/api/oa/finance/documents",{method:"POST",body:form});
 const json=await res.json().catch(()=>null);
 if(!res.ok||!json?.ok)throw new Error(json?.error||"Attachment upload failed");
 return json.data.id as string;
}
const fileUrl=(entity:string,id:string)=>"/api/oa/finance/documents/"+encodeURIComponent(id)+"?entity_id="+encodeURIComponent(entity);
function Field({label,name,value,onChange,type="text",required=false}:{label:string;name:string;value:any;onChange:(v:string)=>void;type?:string;required?:boolean}){
 return <label className="block text-xs font-medium"><span className="mb-1 block text-neutral-500">{label}</span><input className={input} name={name} type={type} value={value??""} required={required} onChange={e=>onChange(e.target.value)}/></label>;
}
function ProofForm({entity,invoice,busy,run}:{entity:string;invoice:Row;busy:boolean;run:(task:()=>Promise<any>,message:string)=>Promise<void>}){
 return <form className="flex flex-wrap items-center gap-2" onSubmit={e=>{
   e.preventDefault();const f=new FormData(e.currentTarget),file=f.get("file");
   if(!(file instanceof File)||!file.size)return;
   if(!window.confirm("Submit payment / receipt evidence for administrator approval?"))return;
   void run(async()=>{const document_id=await upload(entity,"settlement",file);await request(entity,"settlement_submit",{invoice_id:invoice.id,document_id,approver_id:f.get("approver_id")||""});},"Proof submitted for approval.");
  }}>
  <input aria-label="Bank proof" type="file" name="file" required accept=".pdf,.png,.jpg,.jpeg,.webp" className="max-w-52 text-xs"/>
  <button type="submit" className={btn} disabled={busy}>{invoice.direction==="ar"?"Record receipt (upload proof)":"Record payment (upload proof)"}</button>
 </form>;
}
export function FinanceConsole({section}:{section:Section}){
 const selectedEntity=useRef("legacy-primary");
 const requestVersion=useRef(0);
 const [entity,setEntity]=useState("legacy-primary"),[entities,setEntities]=useState<Row[]>([]);
 const [parties,setParties]=useState<Row[]>([]),[invoices,setInvoices]=useState<Row[]>([]),[settlements,setSettlements]=useState<Row[]>([]);
 const [balances,setBalances]=useState<FinanceBalanceRow[]>([]);
 const [activeTab,setActiveTab]=useState<"data"|"config">("data");
 const [statusFilter,setStatusFilter]=useState("all");
 const [config,setConfig]=useState<Row>({mailbox:"",approvers:[],aiConfigured:false,resendConfigured:false});
 const [party,setParty]=useState<Row>({...emptyParty}),[review,setReview]=useState<Row>({...emptyReview});
 const [mailbox,setMailbox]=useState(""),[receiveAddress,setReceiveAddress]=useState(""),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [error,setError]=useState(""),[notice,setNotice]=useState("");
 const [directionFilter,setDirectionFilter]=useState("ar");
 const load=useCallback(async(id:string)=>{
  if(id!==selectedEntity.current)return;
  const seq=++requestVersion.current;
  const [p,i,s,c,b]=await Promise.all([fetchView(id,"parties"),fetchView(id,"invoices"),fetchView(id,"settlements"),fetchView(id,"config"),fetchView(id,"balances")]);
  if(seq!==requestVersion.current||id!==selectedEntity.current)return;
  setParties(p);setInvoices(i);setSettlements(s);setBalances(b);setConfig(c);setMailbox(c.mailbox||"");setReceiveAddress(c.receiveAddress||c.mailbox||"");
 },[]);
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
  setEntity(id);setLoading(true);setError("");setParty({...emptyParty});setReview({...emptyReview});setActiveTab("data");
  window.sessionStorage.setItem("oa.selectedEntity",id);
  void load(id).catch(e=>setError(String(e))).finally(()=>setLoading(false));
 }
 const approved=parties.filter(p=>p.status==="approved"),pending=parties.filter(p=>p.status==="pending");
 const admins:Row[]=config.approvers||[];
 const shownInvoices=invoices.filter(i=>i.direction===directionFilter&&(statusFilter==="all"||i.status===statusFilter));
 const assignee=(assigned:string|null,action:string,id:string)=>(
  <select aria-label="Assign approving admin" className={input+" max-w-52"} value={assigned||""} disabled={busy}
    onChange={e=>{if(e.target.value)void run(()=>request(entity,action,{id,approver_id:e.target.value}),"Approver assigned.");}}>
   <option value="">Any other admin</option>{admins.map(a=><option key={a.id} value={a.id}>{a.name||a.email}</option>)}
  </select>
 );
 return <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">{section==="parties"?"Suppliers & Customers":"Finance · AR / AP"}</h1>
   <p className="text-sm text-neutral-500">Entity-scoped records · administrator approval · audit trail</p></div>
   {entities.length>1&&<select className={input+" max-w-72"} value={entity} onChange={e=>selectEntity(e.target.value)}>{entities.map(x=><option key={x.id} value={x.id}>{x.display_name}</option>)}</select>}
  </div>
  <div role="tablist" aria-label={section==="parties"?"Suppliers and customers":"AR and AP"} className="flex gap-1 border-b border-neutral-200 pb-2 dark:border-neutral-800">
   {(["data","config"] as const).map(t=><button key={t} type="button" role="tab" aria-selected={activeTab===t}
    className={btn+(activeTab===t?" bg-neutral-900 text-white dark:bg-white dark:text-black":"")}
    onClick={()=>setActiveTab(t)}>{t==="data"?"Data / 数据":"Configuration / 配置"}</button>)}
  </div>
  {error&&<div role="alert" className="rounded-md border border-red-300 p-3 text-sm text-red-700">{error}</div>}
  {notice&&<div role="status" className="rounded-md border p-3 text-sm">{notice}</div>}
  {loading?<p className="text-sm text-neutral-500">Loading finance records…</p>:section==="parties"?<>
   {activeTab==="config"&&<>
   <section className={card}>
    <h2 className="mb-3 font-semibold">{party.root_id?"Propose a change to approved company":"Add supplier or customer"}</h2>
     <p className="text-xs text-neutral-500">An active company administrator can approve or reject their own supplier/customer proposal. Payment/receipt proof approvals still require a different administrator.</p>
    <p className="mb-3 text-xs text-neutral-500">New and changed bank details remain pending until a different administrator approves.</p>
    <form className="space-y-3" onSubmit={e=>{e.preventDefault();void run(async()=>{await request(entity,"party_propose",party);setParty({...emptyParty});},"Company proposal submitted.");}}>
     <div className="grid gap-3 md:grid-cols-3">
      <label className="text-xs">Type<select className={input+" mt-1"} value={party.party_type} onChange={e=>setParty(s=>({...s,party_type:e.target.value}))}>
       <option value="supplier">Supplier / AP</option><option value="customer">Customer / AR</option><option value="both">Both</option></select></label>
      {([["Company name","company_name"],["Address","address"],["Contact name","contact_name"],["Email","email"],["Telephone","phone"],["Bank name","bank_name"],["Bank account","bank_account"],["SWIFT/BIC","bank_swift"]] as const).map(([label,k])=><Field key={k} label={label} name={k} value={party[k]}
       type={k==="email"?"email":"text"} required={k==="company_name"} onChange={v=>setParty(s=>({...s,[k]:v}))}/>)}
      <label className="text-xs">Approving admin (optional)<select className={input+" mt-1"} value={party.assigned_approver_user_id||""} onChange={e=>setParty(s=>({...s,assigned_approver_user_id:e.target.value}))}>
       <option value="">Any other admin</option>{admins.map(a=><option key={a.id} value={a.id}>{a.name||a.email}</option>)}</select></label>
     </div>
     <div className="flex gap-2"><button disabled={busy} className={primary}>Submit for approval</button>{party.root_id&&<button type="button" className={btn} onClick={()=>setParty({...emptyParty})}>Cancel editing</button>}</div>
    </form>
   </section>
   <section className={card}><h2 className="mb-3 font-semibold">Pending company approvals ({pending.length})</h2>
    {!pending.length?<p className="text-sm text-neutral-500">No pending proposals.</p>:pending.map(p=><div key={p.id} className="mb-3 rounded-lg border p-3 text-sm dark:border-neutral-800">
     <div className="font-semibold">{p.company_name} · {p.party_type}</div>
     <p className="text-xs text-neutral-500">{p.address} · {p.contact_name} · {p.email} · {p.phone}</p>
     <p className="mt-1 text-xs">Bank: {p.bank_name} / {p.bank_account} / {p.bank_swift}</p>
     <p className="mb-2 text-xs text-neutral-500">Requested by {p.created_by} · {p.created_at}</p>
     <div className="flex flex-wrap items-center gap-2">{assignee(p.assigned_approver_user_id,"party_assign",p.id)}
      <button className={primary} disabled={busy} onClick={()=>void run(()=>request(entity,"party_approve",{id:p.id}),"Company approved.")}>Approve</button>
      <button className={btn} disabled={busy} onClick={()=>void run(()=>request(entity,"party_reject",{id:p.id,note:window.prompt("Rejection reason")||""}),"Company change rejected.")}>Reject</button>
     </div>
    </div>)}
   </section>
   </>}
   {activeTab==="data"&&<>
   {(["supplier","customer"] as const).map(kind=><section key={kind} className={card}><h2 className="mb-3 font-semibold">Approved {kind==="supplier"?"Suppliers / 供应商":"Customers / 客户"} ({approved.filter(p=>p.party_type===kind||p.party_type==="both").length})</h2>
    <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="text-xs text-neutral-500">{["Company","Type","Contact","Bank details","Manage"].map(x=><th key={x} className="p-2">{x}</th>)}</tr></thead>
     <tbody>{approved.filter(p=>p.party_type===kind||p.party_type==="both").map(p=><tr key={p.id} className="border-t dark:border-neutral-800"><td className="p-2"><div className="font-semibold">{p.company_name}</div><div className="text-xs">{p.address}</div></td><td className="p-2">{p.party_type}</td>
      <td className="p-2">{p.contact_name}<div className="text-xs">{p.email} {p.phone}</div></td>
      <td className="p-2">{p.bank_name}<div className="text-xs">{p.bank_account} · {p.bank_swift}</div></td>
      <td className="p-2"><button className={btn} onClick={()=>{setParty({party_type:p.party_type,company_name:p.company_name,address:p.address,contact_name:p.contact_name,email:p.email,phone:p.phone,bank_name:p.bank_name,bank_account:p.bank_account,bank_swift:p.bank_swift,root_id:p.root_id,assigned_approver_user_id:""});setActiveTab("config");window.scrollTo({top:0,behavior:"smooth"});}}>Propose change</button></td>
     </tr>)}</tbody></table></div>
   </section>)}
   </>}
  </>:<>
   {activeTab==="config"&&<>
   <FinanceAiPanel key={entity} entityId={entity}/>
   <MailAccountsPanel entityId={entity}/>
   <details className={card}><summary className="cursor-pointer font-semibold">Legacy Resend forwarding (optional)</summary>
   <section className="mt-3">
    <h2 className="text-sm font-semibold">Resend mailbox configuration</h2>
    <p className="mb-3 mt-1 text-xs text-neutral-500">Route payable@your-domain to Resend Inbound, or forward it to a Resend-provided receiving address. Configure that actual destination below and subscribe to email.received. The webhook must point to /api/oa/finance/inbound. Email attachment imports always require financial review.</p>
    <form className="flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();void run(()=>request(entity,"set_mailbox",{address:mailbox,receive_address:receiveAddress}),"Finance mailbox saved.");}}>
     <div className="min-w-64 flex-1"><Field label="Incoming invoice mailbox" name="mailbox" value={mailbox} type="email" required onChange={setMailbox}/></div>
     <div className="min-w-64 flex-1"><Field label="Actual Resend receiving address (if forwarded)" name="receive_address" value={receiveAddress} type="email" onChange={setReceiveAddress}/></div>
     <button className={btn} disabled={busy}>Save mailbox</button>
    </form>
    <p className="mt-3 text-xs text-neutral-500">Resend inbound: {config.resendConfigured?"configured":"not configured"}</p>
   </section></details>
   <section className={card}><h2 className="mb-3 font-semibold">Import an invoice manually</h2>
    <form className="flex flex-wrap items-center gap-2" onSubmit={e=>{e.preventDefault();const fd=new FormData(e.currentTarget),file=fd.get("file");
     if(!(file instanceof File)||!file.size)return;
     void run(async()=>{const document_id=await upload(entity,"invoice",file);await request(entity,"invoice_import",{document_id,subject:fd.get("subject")});},"Invoice imported for review.");}}>
     <input className={input+" max-w-72"} name="subject" placeholder="Invoice subject (optional)"/>
     <input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png,.webp" className="text-xs"/>
     <button className={btn} disabled={busy}>Upload & extract</button>
    </form>
   </section>
   </>}
   {activeTab==="data"&&<>
   <FinanceBalances rows={balances}/>
   <section className={card}><div className="mb-3 flex flex-wrap items-center justify-between gap-2">
    <h2 className="font-semibold">{directionFilter==="ar"?"Accounts Receivable / 应收账款":directionFilter==="ap"?"Accounts Payable / 应付账款":"Needs classification / 未分类"} ({shownInvoices.length})</h2>
    <div className="flex flex-wrap items-center gap-2">
     {([["ar","AR / Receivables"],["ap","AP / Payables"],["unknown","Unclassified"]] as const).map(([v,label])=><button key={v} type="button" className={btn+(directionFilter===v?" font-bold underline":"")} onClick={()=>{setDirectionFilter(v);setStatusFilter("all");}}>{label}</button>)}
     <select aria-label="Filter invoice settlement status" className={input+" max-w-52"} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
      <option value="all">All statuses</option><option value="needs_review">Needs review</option>
      <option value="open">{directionFilter==="ar"?"Unreceived":"Unpaid"}</option>
      <option value="settlement_pending">Proof pending approval</option>
      <option value="settled">{directionFilter==="ar"?"Received":"Paid"}</option>
      <option value="rejected">Rejected</option>
     </select>
    </div>
   </div>
    <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="text-xs text-neutral-500">{["Invoice","Counterparty / Type","Amount / Due","Bank check","Status","Actions"].map(t=><th key={t} className="p-2">{t}</th>)}</tr></thead><tbody>
     {shownInvoices.map(i=><tr key={i.id} className="border-t align-top dark:border-neutral-800">
      <td className="p-2"><div className="font-medium">{i.invoice_number||"Unrecognized"}</div><div className="text-xs">{i.invoice_date||"—"}</div><a className="text-xs underline" href={fileUrl(entity,i.document_id)}>Original invoice</a></td>
      <td className="p-2">{i.approved_party_name||i.counterparty_name||"Unmatched"}<div className="text-xs">{String(i.direction).toUpperCase()} · {i.source}</div>{i.source_mailbox&&<div className="text-xs text-neutral-500">{i.source_mailbox} · {i.source_provider}</div>}</td>
      <td className="p-2">{i.amount_minor!=null?amount(i.amount_minor,i.currency):"—"}<div className="text-xs">Due {i.due_date||"—"}</div></td>
      <td className="p-2"><span className={i.bank_check==="mismatch"?"text-red-600 font-semibold":""}>{i.bank_check}</span><div className="text-xs">{i.invoice_bank_account||"No account"}</div></td>
      <td className="p-2"><span className="font-medium">{i.status==="open"?(i.direction==="ar"?"Unreceived / 未收款":"Unpaid / 未付款"):i.status==="settlement_pending"?"Proof pending approval / 待核销审核":i.status==="settled"?(i.direction==="ar"?"Received / 已收款":"Paid / 已付款"):i.status==="needs_review"?"Needs review / 待审核":i.status}</span>
       <div className="text-xs">{i.extraction_note||""}</div>
       {i.last_ai_outcome&&<div className="mt-1 rounded border p-2 text-xs dark:border-neutral-700">
        <div className="font-medium">Latest AI: {i.last_ai_outcome} · HTTP {i.last_ai_http_status??"—"} · {i.last_ai_response_status||"—"}</div>
        <div>Output tokens: {i.last_ai_output_tokens??"—"} · Reasoning tokens: {i.last_ai_reasoning_tokens??"—"} · Reason: {i.last_ai_finish_reason||"—"}</div>
        <div>Response shape: {i.last_ai_output_types||"—"}</div>
        {i.last_ai_request_id&&<div>Request ID: {i.last_ai_request_id}</div>}
       </div>}
      </td>
      <td className="space-y-2 p-2">{i.status==="needs_review"?<>
       <button className={btn} disabled={busy} onClick={()=>setReview({id:i.id,direction:i.direction==="unknown"?"ap":i.direction,party_root_id:i.party_root_id||"",invoice_number:i.invoice_number||"",invoice_date:i.invoice_date||"",due_date:i.due_date||"",currency:i.currency||"SGD",amount:major(i.amount_minor,i.currency),invoice_bank_account:i.invoice_bank_account||"",invoice_bank_name:i.invoice_bank_name||""})}>Review</button>
       <button className={btn} disabled={busy} onClick={()=>void run(async()=>{try{const result=await request(entity,"invoice_reextract",{id:i.id});setReview({...emptyReview});return result;}finally{window.dispatchEvent(new Event("finance-ai-call-updated"));}},"AI re-extraction completed; verify the fields before confirming.")}>{busy?"Processing…":"Re-extract AI"}</button>
       <button className={btn} disabled={busy} onClick={()=>void run(()=>request(entity,"invoice_reject",{id:i.id}),"Invoice rejected.")}>Reject</button>
      </>:i.status==="open"?<ProofForm entity={entity} invoice={i} busy={busy} run={run}/>:null}</td>
     </tr>)}</tbody></table></div>
   </section>
   {review.id&&<section className={card}><h2 className="mb-3 font-semibold">Review Invoice · {review.invoice_number||review.id}</h2>
    <form className="space-y-3" onSubmit={e=>{e.preventDefault();void run(async()=>{await request(entity,"invoice_review",review);setReview({...emptyReview});},"Invoice reviewed and opened.");}}>
     <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-xs">AR / AP<select className={input+" mt-1"} value={review.direction} onChange={e=>setReview(s=>({...s,direction:e.target.value,party_root_id:""}))}><option value="ap">AP / Payable</option><option value="ar">AR / Receivable</option></select></label>
      <label className="text-xs">Approved counterparty<select className={input+" mt-1"} value={review.party_root_id} required onChange={e=>setReview(s=>({...s,party_root_id:e.target.value}))}><option value="">Select...</option>
       {approved.filter(p=>p.party_type==="both"||p.party_type===(review.direction==="ap"?"supplier":"customer")).map(p=><option key={p.root_id} value={p.root_id}>{p.company_name}</option>)}</select></label>
      {([["Invoice number","invoice_number"],["Invoice date","invoice_date"],["Due date","due_date"],["Currency","currency"],["Total amount","amount"],["Invoice bank account","invoice_bank_account"],["Invoice bank name","invoice_bank_name"]] as const).map(([label,k])=><Field key={k} label={label} name={k} value={review[k]} required={["invoice_number","currency","amount"].includes(k)} onChange={v=>setReview(s=>({...s,[k]:v}))}/>)}
     </div>
     <p className="text-xs text-neutral-500">AP approval is blocked unless the beneficiary account exactly matches the currently approved supplier record. For AR, the invoice may display your own receiving account rather than the customer's; review the comparison manually.</p>
     <button className={primary} disabled={busy}>Confirm reviewed invoice</button><button type="button" className={btn+" ml-2"} onClick={()=>setReview({...emptyReview})}>Cancel</button>
    </form>
   </section>}
   <section className={card}><h2 className="mb-3 font-semibold">Receipt / payment proof approvals ({settlements.length})</h2>
    <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr>{["Invoice","Type / Amount","Evidence","Approval","Action"].map(x=><th key={x} className="p-2 text-xs text-neutral-500">{x}</th>)}</tr></thead><tbody>
     {settlements.map(s=><tr key={s.id} className="border-t align-top dark:border-neutral-800"><td className="p-2">{s.invoice_number||s.invoice_id}</td><td className="p-2">{String(s.direction).toUpperCase()} · {amount(s.amount_minor,s.currency)}</td>
      <td className="p-2"><a className="underline" href={fileUrl(entity,s.document_id)}>{s.proof_name||"Bank proof"}</a></td>
      <td className="p-2">{s.status}<div className="text-xs text-neutral-500">{s.decided_at||s.submitted_at}</div></td>
      <td className="p-2">{s.status==="pending"?<div className="flex flex-wrap gap-2">
       {assignee(s.approver_user_id,"settlement_assign",s.id)}
       <button className={primary} disabled={busy} onClick={()=>void run(()=>request(entity,"settlement_approve",{id:s.id}),s.direction==="ar"?"Receipt confirmed; invoice marked received.":"Payment confirmed; invoice marked paid.")}>Approve {s.direction==="ar"?"receipt":"payment"}</button>
       <button className={btn} disabled={busy} onClick={()=>void run(()=>request(entity,"settlement_reject",{id:s.id,note:window.prompt("Rejection note")||""}),"Bank proof rejected.")}>Reject</button>
      </div>:null}</td>
     </tr>)}</tbody></table></div>
   </section>
   </>}
  </>}
 </div>;
}