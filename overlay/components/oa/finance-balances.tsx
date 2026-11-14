"use client";

export type FinanceBalanceRow={
 direction:"ar"|"ap";currency:string;
 status:"open"|"settlement_pending"|"settled";
 amount_minor:number|string;invoice_count:number|string;
};
function money(minor:number,currency:string){
 try{
  const digits=new Intl.NumberFormat("en",{style:"currency",currency}).resolvedOptions().maximumFractionDigits;
  return new Intl.NumberFormat("en",{style:"currency",currency}).format(minor/10**digits);
 }catch{return currency+" "+minor;}
}
export function FinanceBalances({rows}:{rows:FinanceBalanceRow[]}){
 const groups=new Map<string,{direction:"ar"|"ap";currency:string;open:number;pending:number;settled:number;openCount:number;pendingCount:number;settledCount:number}>();
 for(const row of rows){
  if(!["ar","ap"].includes(row.direction)||!["open","settlement_pending","settled"].includes(row.status))continue;
  const key=row.direction+"|"+row.currency;
  let g=groups.get(key);
  if(!g){g={direction:row.direction,currency:row.currency,open:0,pending:0,settled:0,openCount:0,pendingCount:0,settledCount:0};groups.set(key,g);}
  const value=Number(row.amount_minor),count=Number(row.invoice_count);
  if(!Number.isSafeInteger(value)||!Number.isSafeInteger(count))continue;
  if(row.status==="open"){g.open+=value;g.openCount+=count;}
  else if(row.status==="settlement_pending"){g.pending+=value;g.pendingCount+=count;}
  else {g.settled+=value;g.settledCount+=count;}
 }
 const all=[...groups.values()];
 return <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
  <h2 className="font-semibold">AR / AP balances · 当前应收应付</h2>
  <p className="mb-3 mt-1 text-xs text-neutral-500">Only reviewed/confirmed invoices are booked. Each currency is shown separately. Submitted receipts/payment proofs remain outstanding until independently approved. Unclassified and awaiting-review invoices are excluded.</p>
  <div className="grid gap-3 md:grid-cols-2">
   {(["ar","ap"] as const).map(direction=><div key={direction} className="rounded-lg border p-3 dark:border-neutral-800">
    <h3 className="text-sm font-semibold">{direction==="ar"?"Accounts Receivable · 应收账款":"Accounts Payable · 应付账款"}</h3>
    <div className="mt-2 space-y-3">
     {all.filter(x=>x.direction===direction).map(x=><div key={x.currency} className="border-t pt-2 dark:border-neutral-800">
      <div className="text-xs font-semibold text-neutral-500">{x.currency}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{money(x.open+x.pending,x.currency)}</div>
      <div className="text-xs text-neutral-500">{direction==="ar"?"Outstanding to collect":"Outstanding to pay"} · {x.openCount+x.pendingCount} invoice(s)</div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
       <div>Awaiting proof approval<div className="font-medium">{money(x.pending,x.currency)} · {x.pendingCount}</div></div>
       <div>{direction==="ar"?"Received":"Paid"}<div className="font-medium">{money(x.settled,x.currency)} · {x.settledCount}</div></div>
      </div>
     </div>)}
     {!all.some(x=>x.direction===direction)&&<p className="text-sm text-neutral-500">No confirmed invoices.</p>}
    </div>
   </div>)}
  </div>
 </section>;
}
