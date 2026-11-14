// Pure and shared by the review UI and server's authoritative approval check.
// Empty invoice/party values are mismatches, never silently treated as equal.
export type InvoiceReviewField="company_name"|"bank_name"|"bank_account"|"bank_swift";
export type InvoiceReviewCheck={
 field:InvoiceReviewField;expected:string;actual:string;
 status:"match"|"mismatch"|"missing"|"not_required";
};
export type InvoiceReviewCandidate={
 counterparty_name?:unknown;invoice_bank_name?:unknown;
 invoice_bank_account?:unknown;invoice_bank_swift?:unknown;currency?:unknown;
};
export type ApprovedReviewParty={
 company_name?:unknown;bank_name?:unknown;bank_account?:unknown;bank_swift?:unknown;
};
function text(v:unknown){return String(v??"").trim();}
function companyKey(v:unknown){
 return text(v).normalize("NFKC").toLowerCase().replace(/[^a-z0-9\u00c0-\u024f\u3400-\u9fff]/g,"");
}
function bankNameKey(v:unknown){return companyKey(v);}
function accountKey(v:unknown){return text(v).normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g,"");}
function swiftKey(v:unknown){return accountKey(v);}
export function invoiceReviewChecks(invoice:InvoiceReviewCandidate,party:ApprovedReviewParty|null|undefined):InvoiceReviewCheck[]{
 const requiredSwift=text(invoice.currency).toUpperCase()==="USD";
 const source=[
  {field:"company_name" as const,expected:party?.company_name,actual:invoice.counterparty_name,key:companyKey,required:true},
  {field:"bank_name" as const,expected:party?.bank_name,actual:invoice.invoice_bank_name,key:bankNameKey,required:true},
  {field:"bank_account" as const,expected:party?.bank_account,actual:invoice.invoice_bank_account,key:accountKey,required:true},
  {field:"bank_swift" as const,expected:party?.bank_swift,actual:invoice.invoice_bank_swift,key:swiftKey,required:requiredSwift}
 ];
 return source.map(f=>{
  const expected=text(f.expected),actual=text(f.actual),a=f.key(f.expected),b=f.key(f.actual);
  const status:InvoiceReviewCheck["status"]=!f.required?"not_required":!a||!b?"missing":a===b?"match":"mismatch";
  return {field:f.field,expected,actual,status};
 });
}
export function invoiceReviewVerified(checks:InvoiceReviewCheck[]){
 return checks.length===4&&checks.every(c=>c.status==="match"||c.status==="not_required");
}
