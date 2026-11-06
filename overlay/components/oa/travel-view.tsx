"use client";
import {FormEvent,useCallback,useEffect,useMemo,useState} from "react";
type Kind="flight"|"hotel"|"other";
type Item={key:string;type:Kind;itemName:string;description:string;departureAt:string;arrivalAt:string;checkInAt:string;checkOutAt:string;nights:string;amount:string};
type Saved={id:string;type:Kind;item_name:string;description:string|null;departure_at:string|null;arrival_at:string|null;check_in_at:string|null;check_out_at:string|null;nights:number|null;amount_minor:number};
type Trip={id:string;name:string;email:string;employee_no?:string;department?:string;job_title?:string;destination:string;purpose:string;currency:string;total_amount_minor:number;status:string;submitted_at:string;step_no?:number;approver_type?:string;items:Saved[]};
const field="w-full min-w-0 rounded-lg border border-neutral-300 bg-white px-2 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-white";
const button="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700";
const primary="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900";
const make=(type:Kind):Item=>({key:crypto.randomUUID(),type,itemName:"",description:"",departureAt:"",arrivalAt:"",checkInAt:"",checkOutAt:"",nights:"",amount:""});
const nights=(a:string,b:string)=>{if(!a||!b)return "";const v=(Date.parse(b.slice(0,10)+"T00:00:00Z")-Date.parse(a.slice(0,10)+"T00:00:00Z"))/86400000;return Number.isInteger(v)&&v>0?String(v):"";};
const format=(minor:number,c:string)=>{const d=new Intl.NumberFormat("en",{style:"currency",currency:c}).resolvedOptions().maximumFractionDigits??2;return new Intl.NumberFormat("en",{style:"currency",currency:c}).format(Number(minor||0)/10**d);};
async function api(entityId:string,action:string,body?:Record<string,unknown>){
  const get=body===undefined;
  const r=await fetch(get?`/api/oa/travel?entity_id=${encodeURIComponent(entityId)}&scope=${encodeURIComponent(action)}`:"/api/oa/travel",get?{cache:"no-store"}:{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,entity_id:entityId,...body})});
  const json=await r.json().catch(()=>null);if(!r.ok||!json?.ok)throw new Error(json?.error||`Travel API HTTP ${r.status}`);return json.data;
}
function Details({trip}:{trip:Trip}){
 return <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead className="bg-neutral-50 text-xs text-neutral-500 dark:bg-neutral-900"><tr><th className="p-2">Type</th><th className="p-2">Flight / Hotel / Project</th><th className="p-2">Description</th><th className="p-2">Departure / Check-in</th><th className="p-2">Arrival / Check-out</th><th className="p-2">Nights</th><th className="p-2 text-right">Budget</th></tr></thead><tbody>
 {trip.items.map(x=><tr key={x.id} className="border-t border-neutral-200 dark:border-neutral-800"><td className="p-2 capitalize">{x.type}</td><td className="p-2 font-medium">{x.item_name}</td><td className="p-2">{x.description||"—"}</td><td className="whitespace-nowrap p-2">{(x.type==="flight"?x.departure_at:x.check_in_at)?.replace("T"," ")||"—"}</td><td className="whitespace-nowrap p-2">{(x.type==="flight"?x.arrival_at:x.check_out_at)?.replace("T"," ")||"—"}</td><td className="p-2">{x.nights??"—"}</td><td className="p-2 whitespace-nowrap text-right">{format(x.amount_minor,trip.currency)}</td></tr>)}
 </tbody><tfoot><tr className="border-t border-neutral-300 font-semibold dark:border-neutral-700"><td colSpan={6} className="p-2">Estimated total · {trip.currency}</td><td className="p-2 text-right">{format(trip.total_amount_minor,trip.currency)}</td></tr></tfoot></table></div>;
}
export function TravelView({entityId,employee,viewer,currencies}:{entityId:string;employee:Record<string,any>;viewer:{name?:string|null;email:string};currencies:string[]}){
 const [items,setItems]=useState<Item[]>(()=>[make("flight"),make("hotel")]);
 const [destination,setDestination]=useState(""),[purpose,setPurpose]=useState("");
 const [currency,setCurrency]=useState(employee?.reimbursement_currency||"SGD");
 const [records,setRecords]=useState<Trip[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const load=useCallback(async()=>setRecords(await api(entityId,"mine") as Trip[]),[entityId]);
 useEffect(()=>{load().catch(e=>setError(String(e)));},[load]);
 const total=useMemo(()=>items.reduce((sum,x)=>sum+(Number(x.amount)||0),0),[items]);
 const patch=(id:string,changes:Partial<Item>)=>setItems(s=>s.map(x=>{if(x.key!==id)return x;const next={...x,...changes};if(x.type==="hotel"&&(changes.checkInAt!==undefined||changes.checkOutAt!==undefined))next.nights=nights(next.checkInAt,next.checkOutAt);return next;}));
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!window.confirm(`Submit ${items.length} budget line(s) for approval?`))return;
  setBusy(true);setError("");setNotice("");
  try{await api(entityId,"create",{destination,purpose,currency,items:items.map(({key,...x})=>x)});setNotice("Business travel application submitted.");setDestination("");setPurpose("");setItems([make("flight"),make("hotel")]);await load();}
  catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 }
 async function cancel(id:string){
  if(!window.confirm("Cancel this pending travel application?"))return;
  setBusy(true);setError("");try{await api(entityId,"cancel",{id});setNotice("Travel application cancelled.");await load();}catch(e){setError(String(e));}finally{setBusy(false);}
 }
 return <div className="space-y-4">
  <h2 className="text-lg font-semibold">Business travel application</h2>
  <p className="text-sm text-neutral-500">Flights, hotels and additional budgets are submitted together. Approved budgets are separate from actual expense reimbursements.</p>
  {error&&<p role="alert" className="rounded-lg border border-red-300 p-3 text-sm text-red-700">{error}</p>}{notice&&<p role="status" className="rounded-lg border p-3 text-sm">{notice}</p>}
  <form onSubmit={submit} className="space-y-4">
   <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
    <h3 className="font-semibold">Employee information</h3>
    <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
    {([["Employee",employee?.legal_name||employee?.name||viewer.name||viewer.email],["Employee no.",employee?.employee_no||"—"],["Department / title",[employee?.department,employee?.job_title].filter(Boolean).join(" · ")||"—"],["Manager",employee?.manager_name||"—"]] as [string,string][]).map(([label,value])=><div key={label}><p className="text-neutral-500">{label}</p><p className="font-medium">{value}</p></div>)}
    </div>
    <div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-xs font-medium">Destination<input required maxLength={200} className={field+" mt-1"} value={destination} onChange={e=>setDestination(e.target.value)} placeholder="Tokyo, Japan"/></label><label className="text-xs font-medium">Business purpose<input required maxLength={2000} className={field+" mt-1"} value={purpose} onChange={e=>setPurpose(e.target.value)} placeholder="Client visit / conference"/></label></div>
   </section>
   <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Flights · Hotels · Other budget items</h3><p className="text-xs text-neutral-500">Flight times are local to each airport. Hotel nights are derived from check-in and check-out dates.</p></div><label className="text-xs font-medium">Currency<select className={field+" mt-1"} value={currency} onChange={e=>setCurrency(e.target.value)}>{Array.from(new Set([currency,...currencies])).map(c=><option key={c} value={c}>{c}</option>)}</select></label></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[1070px] text-left text-sm">
     <thead className="bg-neutral-50 text-xs text-neutral-500 dark:bg-neutral-900"><tr><th className="p-2">Type</th><th className="min-w-[150px] p-2">Flight no. / Hotel / Project</th><th className="min-w-[150px] p-2">Description</th><th className="min-w-[185px] p-2">Departure / Check-in</th><th className="min-w-[185px] p-2">Arrival / Check-out</th><th className="w-[75px] p-2">Nights</th><th className="w-[125px] p-2">Budget ({currency})</th><th className="p-2">Action</th></tr></thead>
     <tbody>{items.map((x,i)=><tr key={x.key} className="border-t border-neutral-200 align-top dark:border-neutral-800">
      <td className="p-2 capitalize">{x.type}</td>
      <td className="p-2"><input required aria-label={`Row ${i+1} name`} className={field} maxLength={200} placeholder={x.type==="flight"?"Flight number":x.type==="hotel"?"Hotel name":"Project name"} value={x.itemName} onChange={e=>patch(x.key,{itemName:e.target.value})}/></td>
      <td className="p-2"><input required={x.type==="other"} aria-label={`Row ${i+1} description`} className={field} maxLength={1000} placeholder="Description" value={x.description} onChange={e=>patch(x.key,{description:e.target.value})}/></td>
      <td className="p-2">{x.type==="other"?"—":<input required type="datetime-local" aria-label={`Row ${i+1} departure or check-in`} className={field} value={x.type==="flight"?x.departureAt:x.checkInAt} onChange={e=>patch(x.key,x.type==="flight"?{departureAt:e.target.value}:{checkInAt:e.target.value})}/>}</td>
      <td className="p-2">{x.type==="other"?"—":<input required type="datetime-local" aria-label={`Row ${i+1} arrival or check-out`} className={field} value={x.type==="flight"?x.arrivalAt:x.checkOutAt} onChange={e=>patch(x.key,x.type==="flight"?{arrivalAt:e.target.value}:{checkOutAt:e.target.value})}/>}</td>
      <td className="p-2">{x.type==="hotel"?<input className={field} aria-label={`Row ${i+1} nights`} readOnly value={x.nights} placeholder="Auto"/>:"—"}</td>
      <td className="p-2"><input required type="number" min="0.01" step="any" className={field} aria-label={`Row ${i+1} budget`} value={x.amount} onChange={e=>patch(x.key,{amount:e.target.value})} placeholder="0.00"/></td>
      <td className="p-2"><button type="button" disabled={items.length===1} className="p-2 text-xs text-red-600 disabled:opacity-30" onClick={()=>setItems(s=>s.filter(y=>y.key!==x.key))}>Remove</button></td>
     </tr>)}</tbody></table></div>
    <div className="mt-3 flex flex-wrap gap-2">{(["flight","hotel","other"] as Kind[]).map(t=><button key={t} type="button" className={button} disabled={busy||items.length>=50} onClick={()=>setItems(s=>[...s,make(t)])}>+ {t==="other"?"Other budget item":t==="flight"?"Flight":"Hotel"}</button>)}</div>
    <div className="mt-4 flex items-center justify-between gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-800"><div><p className="text-xs text-neutral-500">{items.length} line(s) · Estimated total</p><p className="text-2xl font-semibold">{new Intl.NumberFormat("en",{style:"currency",currency}).format(total)}</p></div><button type="submit" className={primary} disabled={busy}>{busy?"Submitting…":"Submit travel application"}</button></div>
   </section>
  </form>
  <section className="space-y-3"><h3 className="text-lg font-semibold">My travel applications</h3>{records.length?records.map(t=><details key={t.id} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950"><summary className="cursor-pointer"><b>{t.destination}</b> · {format(t.total_amount_minor,t.currency)} · <span className="capitalize">{t.status}</span> · <span className="text-xs text-neutral-500">{t.submitted_at?.slice(0,16)}</span></summary><p className="mt-2 text-sm">{t.purpose}</p><Details trip={t}/>{t.status==="submitted"&&<button type="button" className={button+" mt-3"} disabled={busy} onClick={()=>cancel(t.id)}>Cancel pending application</button>}</details>):<p className="text-sm text-neutral-500">No travel applications yet.</p>}</section>
 </div>;
}
export function TravelApprovals({entityId}:{entityId:string}){
 const [records,setRecords]=useState<Trip[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const load=useCallback(async()=>setRecords(await api(entityId,"approvals") as Trip[]),[entityId]);
 useEffect(()=>{load().catch(e=>setError(String(e)));},[load]);
 async function decide(id:string,action:"approve"|"reject"){
  const note=window.prompt(action==="reject"?"Rejection reason:":"Approval note (optional):","");
  if(note===null)return;
  setBusy(true);setError("");setNotice("");
  try{await api(entityId,action,{id,note});await load();setNotice(action==="approve"?"Travel approval step completed.":"Travel application rejected.");}
  catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 }
 return <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
  <h2 className="mb-2 font-semibold">Pending business travel approvals</h2>
  {error&&<p role="alert" className="mb-2 text-sm text-red-600">{error}</p>}{notice&&<p role="status" className="mb-2 text-sm">{notice}</p>}
  {!records.length?<p className="text-sm text-neutral-500">No business travel applications assigned to you.</p>:<div className="space-y-3">{records.map(t=><div key={t.id} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"><p className="text-sm"><b>{t.name||t.email}</b> · {t.employee_no||"—"} · {t.department||"—"} · {t.destination} · <b>{format(t.total_amount_minor,t.currency)}</b> · Step {t.step_no} ({t.approver_type})</p><p className="mt-1 text-sm text-neutral-500">{t.purpose}</p><Details trip={t}/><div className="mt-3 flex gap-2"><button disabled={busy} className={primary} onClick={()=>decide(t.id,"approve")}>Approve step</button><button disabled={busy} className={button} onClick={()=>decide(t.id,"reject")}>Reject</button></div></div>)}</div>}
 </section>;
}
