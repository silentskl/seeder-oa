"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";

type AnyRow = Record<string, any>;
type Bootstrap = {
  viewer: { id:string; name?:string|null; email:string; role:string };
  admin: boolean;
  isManager: boolean;
  employee: AnyRow;
  leaveSummary: {year:number;entitlement:number;used:number;pending:number;available:number};
  settings: AnyRow;
  currencies: string[];
};

type Tab = "overview"|"leave"|"expenses"|"payslips"|"approvals"|"employees"|"payroll"|"settings";

const field = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100";
const button = "inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
const primary = `${button} bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200`;
const secondary = `${button} border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:bg-neutral-900`;
const danger = `${button} border border-red-300 bg-white text-red-700 hover:bg-red-50 dark:border-red-900 dark:bg-neutral-950 dark:text-red-300`;

function currencyDigits(currency:string){ try{return new Intl.NumberFormat("en",{style:"currency",currency}).resolvedOptions().maximumFractionDigits;}catch{return 2;} }
function money(minor:number|string|null|undefined,currency:string){ const n=Number(minor||0); const d=currencyDigits(currency||"SGD"); try{return new Intl.NumberFormat("en",{style:"currency",currency:currency||"SGD",minimumFractionDigits:d,maximumFractionDigits:d}).format(n/(10**d));}catch{return `${currency} ${(n/(10**d)).toFixed(d)}`;} }
function formatDate(value:any){ if(!value)return "—"; return String(value).slice(0,10); }
function statusClass(status:string){
  if(["approved","published","paid"].includes(status)) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
  if(["rejected","void","cancelled"].includes(status)) return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
  return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
}
function Status({value}:{value:string}){ return <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass(value)}`}>{value}</span>; }
function Card({children,className=""}:{children:ReactNode;className?:string}){ return <div className={`rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-950 ${className}`}>{children}</div>; }
function Label({children}:{children:ReactNode}){ return <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">{children}</label>; }
function Empty({children="Nothing here yet."}:{children?:ReactNode}){ return <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">{children}</div>; }
function ErrorBox({message}:{message:string}){ return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{message}</div>; }

async function api(resource:string){
  const res=await fetch(`/api/oa?resource=${encodeURIComponent(resource)}`,{cache:"no-store"});
  const json=await res.json(); if(!res.ok||!json.ok) throw new Error(json.error||`HTTP ${res.status}`); return json.data;
}
async function act(action:string,data:AnyRow={}){
  const res=await fetch("/api/oa",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,...data})});
  const json=await res.json(); if(!res.ok||!json.ok) throw new Error(json.error||`HTTP ${res.status}`); return json.data;
}
async function upload(file:File,kind:string,ownerUserId?:string){
  const form=new FormData(); form.set("file",file); form.set("kind",kind); if(ownerUserId) form.set("ownerUserId",ownerUserId);
  const res=await fetch("/api/oa/files/upload",{method:"POST",body:form}); const json=await res.json();
  if(!res.ok||!json.ok) throw new Error(json.error||`HTTP ${res.status}`); return json.data as {id:string;name:string};
}

export function OaConsole(){
  const [boot,setBoot]=useState<Bootstrap|null>(null);
  const [tab,setTab]=useState<Tab>("overview");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const refresh=useCallback(async()=>{ setError(""); try{setBoot(await api("bootstrap"));}catch(e){setError(e instanceof Error?e.message:String(e));}},[]);
  useEffect(()=>{refresh();},[refresh]);
  const run=useCallback(async<T,>(fn:()=>Promise<T>,message?:string)=>{setBusy(true);setError("");setNotice("");try{const out=await fn();if(message)setNotice(message);await refresh();return out;}catch(e){setError(e instanceof Error?e.message:String(e));throw e;}finally{setBusy(false);}},[refresh]);

  if(!boot) return <div className="mx-auto max-w-7xl p-6">{error?<ErrorBox message={error}/>:<div className="text-sm text-neutral-500">Loading Office…</div>}</div>;

  const tabs:{id:Tab;label:string;show:boolean}[]=[
    {id:"overview",label:"Overview",show:true},{id:"leave",label:"Leave",show:true},{id:"expenses",label:"Expenses",show:true},{id:"payslips",label:"Payslips",show:true},
    {id:"approvals",label:"Approvals",show:boot.admin||boot.isManager},{id:"employees",label:"Employees",show:boot.admin},{id:"payroll",label:"Payroll",show:boot.admin},{id:"settings",label:"Settings",show:boot.admin},
  ];

  return <div className="mx-auto w-full max-w-7xl p-4 md:p-6">
    <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
      <div><div className="text-xs font-medium uppercase tracking-[0.2em] text-neutral-500">Office</div><h1 className="text-2xl font-semibold text-neutral-950 dark:text-white">Employee self-service</h1><p className="mt-1 text-sm text-neutral-500">Leave, reimbursements and payslips on Cloudflare.</p></div>
      <div className="text-sm text-neutral-500">{boot.viewer.name||boot.viewer.email} · {boot.employee?.department||"No department"}</div>
    </div>
    <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-neutral-200 bg-neutral-50 p-1 dark:border-neutral-800 dark:bg-neutral-900">
      {tabs.filter(x=>x.show).map(x=><button key={x.id} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${tab===x.id?"bg-white font-medium text-neutral-950 shadow-sm dark:bg-neutral-800 dark:text-white":"text-neutral-500 hover:text-neutral-900 dark:hover:text-white"}`} onClick={()=>setTab(x.id)}>{x.label}</button>)}
    </div>
    <datalist id="oa-currencies">{boot.currencies.map(c=><option key={c} value={c}/>)}</datalist>
    {error&&<div className="mb-4"><ErrorBox message={error}/></div>}
    {notice&&<div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</div>}
    {tab==="overview"&&<Overview boot={boot} setTab={setTab}/>} 
    {tab==="leave"&&<LeaveView boot={boot} busy={busy} run={run}/>} 
    {tab==="expenses"&&<ExpenseView boot={boot} busy={busy} run={run}/>} 
    {tab==="payslips"&&<PayslipView/>} 
    {tab==="approvals"&&(boot.admin||boot.isManager)&&<Approvals busy={busy} run={run}/>} 
    {tab==="employees"&&boot.admin&&<Employees boot={boot} busy={busy} run={run}/>} 
    {tab==="payroll"&&boot.admin&&<Payroll boot={boot} busy={busy} run={run}/>} 
    {tab==="settings"&&boot.admin&&<Settings boot={boot} busy={busy} run={run}/>} 
  </div>;
}

function Overview({boot,setTab}:{boot:Bootstrap;setTab:(t:Tab)=>void}){
  const s=boot.leaveSummary;
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[['Annual entitlement',s.entitlement],['Used',s.used],['Pending',s.pending],['Available',s.available]].map(([label,value])=><Card key={String(label)}><div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div><div className="mt-2 text-3xl font-semibold">{value as number}<span className="ml-1 text-sm font-normal text-neutral-400">days</span></div></Card>)}
    </div>
    <div className="grid gap-4 lg:grid-cols-3">
      <Card><h2 className="font-semibold">Request leave</h2><p className="mt-1 text-sm text-neutral-500">Annual, sick, unpaid or compassionate leave.</p><button className={`${primary} mt-4`} onClick={()=>setTab("leave")}>New leave request</button></Card>
      <Card><h2 className="font-semibold">Submit expense</h2><p className="mt-1 text-sm text-neutral-500">Claims can use a different transaction and reimbursement currency.</p><button className={`${primary} mt-4`} onClick={()=>setTab("expenses")}>New expense claim</button></Card>
      <Card><h2 className="font-semibold">Payslips</h2><p className="mt-1 text-sm text-neutral-500">Your published salary records and private attachments.</p><button className={`${primary} mt-4`} onClick={()=>setTab("payslips")}>View payslips</button></Card>
    </div>
    <Card><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm"><div><div className="text-neutral-500">Employee no.</div><div className="font-medium">{boot.employee?.employee_no||"—"}</div></div><div><div className="text-neutral-500">Job title</div><div className="font-medium">{boot.employee?.job_title||"—"}</div></div><div><div className="text-neutral-500">Manager</div><div className="font-medium">{boot.employee?.manager_name||"—"}</div></div><div><div className="text-neutral-500">Reimbursement currency</div><div className="font-medium">{boot.employee?.reimbursement_currency||boot.settings?.base_currency||"SGD"}</div></div></div></Card>
  </div>;
}

function LeaveView({boot,busy,run}:{boot:Bootstrap;busy:boolean;run:any}){
  const [data,setData]=useState<any>(null); const [localError,setLocalError]=useState("");
  const load=useCallback(()=>api("leave").then(setData).catch(e=>setLocalError(e.message)),[]); useEffect(()=>{load();},[load]);
  const submit=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);const file=f.get("file") as File;try{await run(async()=>{let attachmentFileId:string|undefined;if(file?.size) attachmentFileId=(await upload(file,"leave_attachment")).id;return act("createLeave",{leaveTypeCode:f.get("leaveTypeCode"),startDate:f.get("startDate"),endDate:f.get("endDate"),dayPart:f.get("dayPart"),reason:f.get("reason"),attachmentFileId});},"Leave request submitted.");(e.target as HTMLFormElement).reset();await load();}catch{}};
  if(!data)return <>{localError?<ErrorBox message={localError}/>:<div className="text-sm text-neutral-500">Loading leave…</div>}</>;
  return <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
    <Card><h2 className="font-semibold">New leave request</h2><p className="mt-1 text-xs text-neutral-500">Weekends and configured public holidays are excluded automatically.</p><form onSubmit={submit} className="mt-4 space-y-3">
      <div><Label>Leave type</Label><select name="leaveTypeCode" className={field}>{data.types.map((t:any)=><option key={t.code} value={t.code}>{t.name}</option>)}</select></div>
      <div className="grid grid-cols-2 gap-2"><div><Label>Start</Label><input required type="date" name="startDate" className={field}/></div><div><Label>End</Label><input required type="date" name="endDate" className={field}/></div></div>
      <div><Label>Day</Label><select name="dayPart" className={field}><option value="full">Full day</option><option value="am">Half day · AM</option><option value="pm">Half day · PM</option></select></div>
      <div><Label>Reason</Label><textarea name="reason" rows={3} className={field}/></div>
      <div><Label>Attachment (optional)</Label><input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" className={field}/></div>
      <button disabled={busy} className={primary}>Submit request</button>
    </form></Card>
    <div className="space-y-4"><div className="grid grid-cols-4 gap-2">{[["Entitlement",data.summary.entitlement],["Used",data.summary.used],["Pending",data.summary.pending],["Available",data.summary.available]].map(x=><Card key={x[0] as string}><div className="text-xs text-neutral-500">{x[0]}</div><div className="mt-1 text-xl font-semibold">{x[1]}</div></Card>)}</div>
      <Card><h2 className="mb-3 font-semibold">My requests</h2>{!data.requests.length?<Empty/>:<div className="space-y-2">{data.requests.map((r:any)=><div key={r.id} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="font-medium">{r.leave_type_name} · {r.business_days} day{r.business_days===1?"":"s"}</div><div className="text-sm text-neutral-500">{formatDate(r.start_date)} → {formatDate(r.end_date)} · {r.day_part}</div></div><Status value={r.status}/></div>{r.reason&&<p className="mt-2 text-sm">{r.reason}</p>}<div className="mt-2 flex gap-2">{r.attachment_file_id&&<a className={secondary} href={`/api/oa/files/${r.attachment_file_id}`}>Attachment</a>}{r.status==="submitted"&&<button disabled={busy} className={danger} onClick={()=>run(()=>act("cancelLeave",{id:r.id}),"Leave request cancelled.").then(load).catch(()=>{})}>Cancel</button>}</div></div>)}</div>}</Card>
    </div>
  </div>;
}

function ExpenseView({boot,busy,run}:{boot:Bootstrap;busy:boolean;run:any}){
  const [rows,setRows]=useState<any[]>([]); const load=useCallback(()=>api("expenses").then(setRows),[]); useEffect(()=>{load();},[load]);
  const reimbursementDefault=boot.employee?.reimbursement_currency||boot.settings?.base_currency||"SGD";
  const submit=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);const file=f.get("file") as File;try{const result=await run(async()=>{let receiptFileId:string|undefined;if(file?.size) receiptFileId=(await upload(file,"receipt")).id;return act("createExpense",{expenseDate:f.get("expenseDate"),category:f.get("category"),description:f.get("description"),amount:f.get("amount"),originalCurrency:f.get("originalCurrency"),reimbursementCurrency:f.get("reimbursementCurrency"),receiptFileId});},"Expense claim submitted with an FX snapshot.");(e.target as HTMLFormElement).reset();await load();return result;}catch{}};
  return <div className="grid gap-4 lg:grid-cols-[380px_1fr]"><Card><h2 className="font-semibold">New expense claim</h2><p className="mt-1 text-xs text-neutral-500">Historical FX uses the expense date and is locked on submission.</p><form onSubmit={submit} className="mt-4 space-y-3">
    <div><Label>Expense date</Label><input required type="date" name="expenseDate" defaultValue={new Date().toISOString().slice(0,10)} className={field}/></div>
    <div><Label>Category</Label><select name="category" className={field}>{["Travel","Meals","Transport","Accommodation","Office","Telecom","Client entertainment","Other"].map(x=><option key={x}>{x}</option>)}</select></div>
    <div><Label>Description</Label><textarea required name="description" rows={3} className={field}/></div>
    <div className="grid grid-cols-[1fr_100px] gap-2"><div><Label>Amount</Label><input required name="amount" inputMode="decimal" placeholder="0.00" className={field}/></div><div><Label>Spent in</Label><input required name="originalCurrency" list="oa-currencies" defaultValue={reimbursementDefault} maxLength={3} className={field}/></div></div>
    <div><Label>Reimburse in</Label><input required name="reimbursementCurrency" list="oa-currencies" defaultValue={reimbursementDefault} maxLength={3} className={field}/></div>
    <div><Label>Receipt (optional)</Label><input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" className={field}/></div>
    <button disabled={busy} className={primary}>Submit claim</button>
  </form></Card>
  <Card><h2 className="mb-3 font-semibold">My expense claims</h2>{!rows.length?<Empty/>:<div className="space-y-2">{rows.map(r=><div key={r.id} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="font-medium">{r.category} · {money(r.original_amount_minor,r.original_currency)}</div><div className="text-sm text-neutral-500">{formatDate(r.expense_date)} · reimbursement {money(r.reimbursement_amount_minor,r.reimbursement_currency)}</div></div><Status value={r.status}/></div><p className="mt-2 text-sm">{r.description}</p>{r.original_currency!==r.reimbursement_currency&&<div className="mt-2 text-xs text-neutral-500">FX {r.original_currency}/{r.reimbursement_currency}: {Number(r.fx_rate).toFixed(6)} · {r.fx_source} · {r.fx_rate_date}</div>}<div className="mt-2 flex gap-2">{r.receipt_file_id&&<a className={secondary} href={`/api/oa/files/${r.receipt_file_id}`}>Receipt</a>}{r.status==="submitted"&&<button disabled={busy} className={danger} onClick={()=>run(()=>act("cancelExpense",{id:r.id}),"Expense cancelled.").then(load).catch(()=>{})}>Cancel</button>}</div></div>)}</div>}</Card></div>;
}

function PayslipView(){
  const [rows,setRows]=useState<any[]>([]); const [error,setError]=useState(""); useEffect(()=>{api("payslips").then(setRows).catch(e=>setError(e.message));},[]);
  if(error)return <ErrorBox message={error}/>;
  return <div className="space-y-3">{!rows.length?<Empty>No published payslips yet.</Empty>:rows.map(p=><Card key={p.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs uppercase tracking-wide text-neutral-500">{formatDate(p.period_start)} → {formatDate(p.period_end)}</div><div className="mt-1 text-xl font-semibold">Net {money(p.net_minor,p.currency)}</div><div className="text-sm text-neutral-500">Paid {formatDate(p.pay_date)}</div></div><Status value={p.status}/></div><div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4"><PayLine label="Base salary" value={money(p.base_salary_minor,p.currency)}/><PayLine label="Allowances" value={money(p.allowances_minor,p.currency)}/><PayLine label="Bonus" value={money(p.bonus_minor,p.currency)}/><PayLine label="Commission" value={money(p.commission_minor,p.currency)}/><PayLine label="Gross" value={money(p.gross_minor,p.currency)}/><PayLine label="Employee contribution" value={money(p.employee_contribution_minor,p.currency)}/><PayLine label="Tax" value={money(p.tax_minor,p.currency)}/><PayLine label="Other deductions" value={money(p.other_deductions_minor,p.currency)}/></div>{p.currency!==p.reporting_currency&&<div className="mt-3 text-xs text-neutral-500">Reporting equivalent: {money(p.net_reporting_minor,p.reporting_currency)} · FX {Number(p.fx_rate_to_reporting).toFixed(6)} · {p.fx_source} · {p.fx_rate_date}</div>}<div className="mt-3 flex gap-2">{p.attachment_file_id&&<a className={secondary} href={`/api/oa/files/${p.attachment_file_id}`}>Download payslip</a>}</div></Card>)}</div>;
}
function PayLine({label,value}:{label:string;value:string}){return <div className="rounded-lg bg-neutral-50 p-2 dark:bg-neutral-900"><div className="text-xs text-neutral-500">{label}</div><div className="font-medium">{value}</div></div>}

function Approvals({busy,run}:{busy:boolean;run:any}){
  const [data,setData]=useState<{leave:any[];expenses:any[]}>({leave:[],expenses:[]}); const load=useCallback(()=>api("approvals").then(setData),[]); useEffect(()=>{load();},[load]);
  const decide=(action:string,id:string)=>run(()=>act(action,{id}),"Decision saved.").then(load).catch(()=>{});
  return <div className="grid gap-4 xl:grid-cols-2"><Card><h2 className="mb-3 font-semibold">Pending leave</h2>{!data.leave.length?<Empty/>:<div className="space-y-2">{data.leave.map(r=><div key={r.id} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"><div className="font-medium">{r.name||r.email} · {r.leave_type_name}</div><div className="text-sm text-neutral-500">{formatDate(r.start_date)} → {formatDate(r.end_date)} · {r.business_days} day(s)</div>{r.reason&&<p className="mt-2 text-sm">{r.reason}</p>}<div className="mt-3 flex gap-2">{r.attachment_file_id&&<a className={secondary} href={`/api/oa/files/${r.attachment_file_id}`}>Attachment</a>}<button disabled={busy} className={primary} onClick={()=>decide("approveLeave",r.id)}>Approve</button><button disabled={busy} className={danger} onClick={()=>decide("rejectLeave",r.id)}>Reject</button></div></div>)}</div>}</Card>
  <Card><h2 className="mb-3 font-semibold">Expense approvals / payment</h2>{!data.expenses.length?<Empty/>:<div className="space-y-2">{data.expenses.map(r=><div key={r.id} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"><div className="flex justify-between gap-2"><div><div className="font-medium">{r.name||r.email} · {money(r.original_amount_minor,r.original_currency)}</div><div className="text-sm text-neutral-500">Reimburse {money(r.reimbursement_amount_minor,r.reimbursement_currency)} · {formatDate(r.expense_date)}</div></div><Status value={r.status}/></div><p className="mt-2 text-sm">{r.description}</p><div className="mt-3 flex flex-wrap gap-2">{r.receipt_file_id&&<a className={secondary} href={`/api/oa/files/${r.receipt_file_id}`}>Receipt</a>}{r.status==="submitted"&&<><button disabled={busy} className={primary} onClick={()=>decide("approveExpense",r.id)}>Approve</button><button disabled={busy} className={danger} onClick={()=>decide("rejectExpense",r.id)}>Reject</button></>}{r.status==="approved"&&<button disabled={busy} className={primary} onClick={()=>decide("markExpensePaid",r.id)}>Mark paid</button>}</div></div>)}</div>}</Card></div>;
}

function Employees({boot,busy,run}:{boot:Bootstrap;busy:boolean;run:any}){
  const [rows,setRows]=useState<any[]>([]); const load=useCallback(()=>api("employees").then(setRows),[]); useEffect(()=>{load();},[load]);
  return <div className="space-y-4"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Employees</h2><p className="text-sm text-neutral-500">Map Seeder users to HR details, manager and preferred currencies.</p></div><button disabled={busy} className={secondary} onClick={()=>run(()=>act("syncEmployees"),"Users synced.").then(load).catch(()=>{})}>Sync Seeder users</button></div>{!rows.length?<Empty/>:<div className="space-y-3">{rows.map(r=><EmployeeEditor key={r.id} row={r} employees={rows} base={boot.settings?.base_currency||"SGD"} busy={busy} save={(payload:any)=>run(()=>act("updateEmployee",payload),"Employee updated.").then(load)}/>)}</div>}</div>;
}
function EmployeeEditor({row,employees,base,busy,save}:{row:any;employees:any[];base:string;busy:boolean;save:(p:any)=>Promise<any>}){
  const [open,setOpen]=useState(false);
  return <Card><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-medium">{row.name||row.email}</div><div className="text-sm text-neutral-500">{row.email} · {row.department||"No department"} · {row.job_title||"No title"}</div></div><div className="flex items-center gap-2"><span className="text-xs text-neutral-500">{row.payroll_currency||base} payroll · {row.reimbursement_currency||base} expense</span><button className={secondary} onClick={()=>setOpen(!open)}>{open?"Close":"Edit"}</button></div></div>{open&&<form className="mt-4 grid gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-800 md:grid-cols-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);save({userId:row.id,employeeNo:f.get("employeeNo"),department:f.get("department"),jobTitle:f.get("jobTitle"),managerUserId:f.get("managerUserId"),joinDate:f.get("joinDate"),annualLeaveDays:f.get("annualLeaveDays"),payrollCurrency:f.get("payrollCurrency"),reimbursementCurrency:f.get("reimbursementCurrency"),active:f.get("active")==="on"}).then(()=>setOpen(false)).catch(()=>{});}}>
  <div><Label>Employee no.</Label><input name="employeeNo" defaultValue={row.employee_no||""} className={field}/></div><div><Label>Department</Label><input name="department" defaultValue={row.department||""} className={field}/></div><div><Label>Job title</Label><input name="jobTitle" defaultValue={row.job_title||""} className={field}/></div>
  <div><Label>Manager</Label><select name="managerUserId" defaultValue={row.manager_user_id||""} className={field}><option value="">No manager</option>{employees.filter(x=>x.id!==row.id).map(x=><option key={x.id} value={x.id}>{x.name||x.email}</option>)}</select></div><div><Label>Join date</Label><input required type="date" name="joinDate" defaultValue={row.join_date||new Date().toISOString().slice(0,10)} className={field}/></div><div><Label>Annual leave days</Label><input required type="number" step="0.5" min="0" max="365" name="annualLeaveDays" defaultValue={row.annual_leave_days??14} className={field}/></div>
  <div><Label>Payroll currency</Label><input required list="oa-currencies" maxLength={3} name="payrollCurrency" defaultValue={row.payroll_currency||base} className={field}/></div><div><Label>Reimbursement currency</Label><input required list="oa-currencies" maxLength={3} name="reimbursementCurrency" defaultValue={row.reimbursement_currency||base} className={field}/></div><div className="flex items-end"><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={row.active!==0}/> Active employee</label></div>
  <div className="md:col-span-3"><button disabled={busy} className={primary}>Save employee</button></div></form>}</Card>;
}

function Payroll({boot,busy,run}:{boot:Bootstrap;busy:boolean;run:any}){
  const [employees,setEmployees]=useState<any[]>([]); const [rows,setRows]=useState<any[]>([]); const load=useCallback(async()=>{setEmployees(await api("employees"));setRows(await api("admin-payslips"));},[]); useEffect(()=>{load();},[load]);
  const submit=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const form=e.currentTarget;const f=new FormData(form);const userId=String(f.get("userId"));const file=f.get("file") as File;try{await run(async()=>{let attachmentFileId:string|undefined;if(file?.size) attachmentFileId=(await upload(file,"payslip",userId)).id;return act("createPayslip",{userId,periodStart:f.get("periodStart"),periodEnd:f.get("periodEnd"),payDate:f.get("payDate"),currency:f.get("currency"),baseSalary:f.get("baseSalary"),allowances:f.get("allowances"),bonus:f.get("bonus"),commission:f.get("commission"),employeeContribution:f.get("employeeContribution"),employerContribution:f.get("employerContribution"),tax:f.get("tax"),otherDeductions:f.get("otherDeductions"),note:f.get("note"),attachmentFileId});},"Draft payslip created.");form.reset();await load();}catch{}};
  const active=employees.filter(x=>x.active!==0);
  return <div className="grid gap-4 xl:grid-cols-[420px_1fr]"><Card><h2 className="font-semibold">Create payslip</h2><p className="mt-1 text-xs text-neutral-500">Currency is per payslip. Reporting equivalent uses {boot.settings?.base_currency||"SGD"} and a locked FX snapshot.</p><form onSubmit={submit} className="mt-4 space-y-3"><div><Label>Employee</Label><select required name="userId" className={field}><option value="">Select employee</option>{active.map(x=><option key={x.id} value={x.id}>{x.name||x.email}</option>)}</select></div><div className="grid grid-cols-2 gap-2"><div><Label>Period start</Label><input required type="date" name="periodStart" className={field}/></div><div><Label>Period end</Label><input required type="date" name="periodEnd" className={field}/></div></div><div className="grid grid-cols-2 gap-2"><div><Label>Pay date</Label><input required type="date" name="payDate" className={field}/></div><div><Label>Currency</Label><input required list="oa-currencies" maxLength={3} name="currency" defaultValue={boot.settings?.base_currency||"SGD"} className={field}/></div></div>
  {[['Base salary','baseSalary'],['Allowances','allowances'],['Bonus','bonus'],['Commission','commission'],['Employee contribution','employeeContribution'],['Employer contribution','employerContribution'],['Tax','tax'],['Other deductions','otherDeductions']].map(([l,n])=><div key={n}><Label>{l}</Label><input name={n} inputMode="decimal" defaultValue="0" className={field}/></div>)}<div><Label>Note</Label><textarea name="note" rows={2} className={field}/></div><div><Label>Original payslip PDF/image (optional)</Label><input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" className={field}/></div><button disabled={busy||!active.length} className={primary}>Create draft</button></form></Card>
  <Card><h2 className="mb-3 font-semibold">Payroll records</h2>{!rows.length?<Empty/>:<div className="space-y-2">{rows.map(p=><div key={p.id} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"><div className="flex flex-wrap justify-between gap-2"><div><div className="font-medium">{p.name||p.email} · Net {money(p.net_minor,p.currency)}</div><div className="text-sm text-neutral-500">{formatDate(p.period_start)} → {formatDate(p.period_end)} · pay {formatDate(p.pay_date)}</div></div><Status value={p.status}/></div><div className="mt-2 text-xs text-neutral-500">Reporting: {money(p.net_reporting_minor,p.reporting_currency)} · FX {Number(p.fx_rate_to_reporting).toFixed(6)} ({p.fx_source}, {p.fx_rate_date})</div><div className="mt-3 flex gap-2">{p.attachment_file_id&&<a className={secondary} href={`/api/oa/files/${p.attachment_file_id}`}>Attachment</a>}{p.status==="draft"&&<button disabled={busy} className={primary} onClick={()=>run(()=>act("publishPayslip",{id:p.id}),"Payslip published.").then(load).catch(()=>{})}>Publish</button>}{p.status!=="void"&&<button disabled={busy} className={danger} onClick={()=>run(()=>act("voidPayslip",{id:p.id}),"Payslip voided.").then(load).catch(()=>{})}>Void</button>}</div></div>)}</div>}</Card></div>;
}

function Settings({boot,busy,run}:{boot:Bootstrap;busy:boolean;run:any}){
  const [data,setData]=useState<any>(null); const load=useCallback(()=>api("settings").then(setData),[]); useEffect(()=>{load();},[load]);
  if(!data)return <div className="text-sm text-neutral-500">Loading settings…</div>;
  const save=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);run(()=>act("updateSettings",{companyName:f.get("companyName"),baseCurrency:f.get("baseCurrency"),defaultAnnualLeaveDays:f.get("defaultAnnualLeaveDays")}),"OA settings saved.").then(load).catch(()=>{});};
  const addHoliday=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const form=e.currentTarget;const f=new FormData(form);run(()=>act("addHoliday",{holidayDate:f.get("holidayDate"),name:f.get("name")}),"Holiday saved.").then(()=>{form.reset();return load();}).catch(()=>{});};
  return <div className="grid gap-4 xl:grid-cols-2"><div className="space-y-4"><Card><h2 className="font-semibold">OA settings</h2><form onSubmit={save} className="mt-4 space-y-3"><div><Label>Company name</Label><input name="companyName" defaultValue={data.settings?.company_name||"Company"} className={field}/></div><div><Label>Reporting / base currency</Label><input required name="baseCurrency" list="oa-currencies" maxLength={3} defaultValue={data.settings?.base_currency||boot.settings?.base_currency||"SGD"} className={field}/><p className="mt-1 text-xs text-neutral-500">Salary and expense source currencies remain unchanged; this controls reporting equivalents.</p></div><div><Label>Default annual leave days</Label><input required type="number" min="0" max="365" step="0.5" name="defaultAnnualLeaveDays" defaultValue={data.settings?.default_annual_leave_days??14} className={field}/></div><button disabled={busy} className={primary}>Save settings</button></form></Card><Card><h2 className="font-semibold">FX provider</h2><p className="mt-2 text-sm">Frankfurter · free public API · no API key required.</p><p className="mt-1 text-xs text-neutral-500">Rates are cached in D1 and every financial record stores its own rate/date/source snapshot.</p></Card></div>
  <div className="space-y-4"><Card><h2 className="font-semibold">Public holidays</h2><form onSubmit={addHoliday} className="mt-3 grid grid-cols-[150px_1fr_auto] gap-2"><input required type="date" name="holidayDate" className={field}/><input required name="name" placeholder="Holiday name" className={field}/><button disabled={busy} className={secondary}>Add</button></form><div className="mt-3 space-y-1">{data.holidays.map((h:any)=><div key={h.id} className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2 text-sm dark:bg-neutral-900"><span>{h.holiday_date} · {h.name}</span><button disabled={busy} className="text-xs text-red-600" onClick={()=>run(()=>act("deleteHoliday",{id:h.id}),"Holiday removed.").then(load).catch(()=>{})}>Delete</button></div>)}</div></Card><Card><h2 className="font-semibold">Recent FX cache</h2>{!data.fxCache.length?<Empty>No FX rates cached yet.</Empty>:<div className="mt-3 space-y-1 text-xs">{data.fxCache.map((x:any)=><div key={`${x.base_currency}-${x.quote_currency}-${x.requested_date}`} className="flex justify-between rounded bg-neutral-50 p-2 dark:bg-neutral-900"><span>{x.base_currency}/{x.quote_currency} · request {x.requested_date}</span><span>{Number(x.rate).toFixed(6)} · {x.provider_date}</span></div>)}</div>}</Card></div></div>;
}
