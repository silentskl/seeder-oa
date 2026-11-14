import {all} from "./db";

export type InvoiceDirection="ar"|"ap"|"unknown";
export type InvoiceDuplicateInput={
 entityId:string;invoiceId?:string|null;invoiceNumber:string;direction:InvoiceDirection;
 partyRootId?:string|null;counterpartyName?:string|null;
 invoiceDate?:string|null;currency?:string|null;amountMinor?:number|null;
};
export type InvoiceDuplicateMatch={
 id:string;invoice_number:string;invoice_date:string|null;
 currency:string|null;amount_minor:number|null;status:string;
 reason:"same_fields"|"amount_conflict"|"date_conflict"|"amount_and_date_conflict"|"details_missing";
};
// Invoice numbers are identifiers, NOT quantities. Preserve all letters and
// digits but fold case, width, spaces and punctuation (INV/001 = inv-001).
export function invoiceNumberKey(value:unknown){
 return String(value??"").trim().slice(0,100).normalize("NFKC").toLowerCase()
  .replace(/[^a-z0-9\u00c0-\u024f\u3400-\u9fff]/g,"").slice(0,120);
}
export function counterpartyKey(value:unknown){
 return String(value??"").trim().slice(0,300).normalize("NFKC").toLowerCase()
  .replace(/[^a-z0-9\u00c0-\u024f\u3400-\u9fff]/g,"").slice(0,300);
}
export function duplicateReason(
 input:Pick<InvoiceDuplicateInput,"invoiceDate"|"currency"|"amountMinor">,
 candidate:{invoice_date:string|null;currency:string|null;amount_minor:number|null}
):InvoiceDuplicateMatch["reason"]{
 const missing= input.amountMinor==null||candidate.amount_minor==null||
  !input.currency||!candidate.currency||!input.invoiceDate||!candidate.invoice_date;
 const amountConflict=input.amountMinor!=null&&candidate.amount_minor!=null
  &&!!input.currency&&!!candidate.currency
  &&(Number(input.amountMinor)!==Number(candidate.amount_minor)||input.currency!==candidate.currency);
 const dateConflict=!!input.invoiceDate&&!!candidate.invoice_date&&input.invoiceDate!==candidate.invoice_date;
 if(amountConflict&&dateConflict)return "amount_and_date_conflict";
 if(amountConflict)return "amount_conflict";
 if(dateConflict)return "date_conflict";
 if(missing)return "details_missing";
 return "same_fields";
}
export async function findBusinessInvoiceDuplicate(input:InvoiceDuplicateInput):Promise<InvoiceDuplicateMatch|null>{
 const key=invoiceNumberKey(input.invoiceNumber),partyKey=counterpartyKey(input.counterpartyName);
 // Do not guess an issuer from amounts or a bare invoice number.
 // Unknown AR/AP or unknown issuer cannot be matched safely.
 if(!key||!["ar","ap"].includes(input.direction)||(!input.partyRootId&&!partyKey))return null;
 const matches=await all<{
  id:string;invoice_number:string;invoice_date:string|null;
  currency:string|null;amount_minor:number|null;status:string;
 }>(
  "SELECT id,invoice_number,invoice_date,currency,amount_minor,status "+
  "FROM oa_finance_invoice "+
  "WHERE entity_id=? AND direction=? AND invoice_number_key=? "+
  "AND status<>'rejected' AND id<>? "+
  "AND ( (?<>'' AND party_root_id=?) OR (?<>'' AND counterparty_key=?) ) "+
  "ORDER BY CASE WHEN status IN ('open','settlement_pending','settled') THEN 0 ELSE 1 END, "+
  "created_at ASC,id ASC LIMIT 1",
  [input.entityId,input.direction,key,input.invoiceId||"",input.partyRootId||"",input.partyRootId||"",partyKey,partyKey]
 );
 const match=matches[0];
 return match?{...match,reason:duplicateReason(input,match)}:null;
}
export function duplicateFields(input:InvoiceDuplicateInput,duplicate:InvoiceDuplicateMatch|null){
 return {
  invoice_number_key:invoiceNumberKey(input.invoiceNumber),
  counterparty_key:counterpartyKey(input.counterpartyName),
  duplicate_of_invoice_id:duplicate?.id||null,
  duplicate_status:duplicate?"possible" as const:"none" as const,
  duplicate_reason:duplicate?.reason||""
 };
}
