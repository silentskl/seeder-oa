"use client";
import {financeTr,type FinanceLanguage} from "@/lib/oa/finance-i18n";

export type FinanceBalanceRow={
 direction:"ar"|"ap";currency:string;
 amount_minor:number|string;invoice_count:number|string;
 paid_minor:number|string;pending_minor:number|string;remaining_minor:number|string;
 outstanding_count:number|string;pending_count:number|string;paid_count:number|string;
};
function money(minor:number,currency:string){
 try{
  const digits=new Intl.NumberFormat("en",{style:"currency",currency}).resolvedOptions().maximumFractionDigits ?? 2;
  return new Intl.NumberFormat("en",{style:"currency",currency}).format(minor/10**digits);
 }catch{return currency+" "+minor;}
}
export function FinanceBalances({rows,lang}:{rows:FinanceBalanceRow[];lang:FinanceLanguage}){
 const t=(en:string,zh:string)=>financeTr(lang,en,zh);
 const all=rows.filter(row=>["ar","ap"].includes(row.direction)).map(row=>({
  direction:row.direction,currency:row.currency,remaining:Number(row.remaining_minor),pending:Number(row.pending_minor),settled:Number(row.paid_minor),
  outstandingCount:Number(row.outstanding_count),pendingCount:Number(row.pending_count),settledCount:Number(row.paid_count)
 })).filter(row=>[row.remaining,row.pending,row.settled,row.outstandingCount,row.pendingCount,row.settledCount].every(Number.isSafeInteger));
 return <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
  <h2 className="font-semibold">{t("AR / AP balances","应收应付余额")}</h2>
  <p className="mb-3 mt-1 text-xs text-neutral-500">{t("Only approved invoices are booked. Currencies are reported separately. Pending payment proofs remain outstanding until approved.","仅已审核通过的发票计入余额。不同币种分开统计，待审核的收付款凭证仍计入未结清金额。")}</p>
  <div className="grid gap-3 md:grid-cols-2">
   {(["ar","ap"] as const).map(direction=><div key={direction} className="rounded-lg border p-3 dark:border-neutral-800">
    <h3 className="text-sm font-semibold">{direction==="ar"?t("Accounts Receivable","应收账款"):t("Accounts Payable","应付账款")}</h3>
    <div className="mt-2 space-y-3">
     {all.filter(x=>x.direction===direction).map(x=><div key={x.currency} className="border-t pt-2 dark:border-neutral-800">
      <div className="text-xs font-semibold text-neutral-500">{x.currency}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{money(x.remaining,x.currency)}</div>
      <div className="text-xs text-neutral-500">{direction==="ar"?t("Outstanding to collect","待收款"):t("Outstanding to pay","待付款")} · {x.outstandingCount} {t("invoice(s)","张发票")}</div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
       <div>{t("Awaiting proof approval","待凭证审核")}<div className="font-medium">{money(x.pending,x.currency)} · {x.pendingCount}</div></div>
       <div>{direction==="ar"?t("Received","已收款"):t("Paid","已付款")}<div className="font-medium">{money(x.settled,x.currency)} · {x.settledCount}</div></div>
      </div>
     </div>)}
     {!all.some(x=>x.direction===direction)&&<p className="text-sm text-neutral-500">{t("No confirmed invoices.","暂无已审核发票。")}</p>}
    </div>
   </div>)}
  </div>
 </section>;
}
