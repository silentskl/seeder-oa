import {all,audit,one,run} from "./db";
import {getOaEnv} from "./env";
import {majorToMinor,normalizeCurrency} from "./money";
import {extractWithFinanceAi} from "./finance-ai";
import {duplicateFields,findBusinessInvoiceDuplicate} from "./finance-duplicates";

export const clean=(v:unknown,max=300)=>String(v??"").trim().slice(0,max);
export const normalizedName=(v:unknown)=>clean(v,300).normalize("NFKC").toLowerCase().replace(/[^a-z0-9\u00c0-\u024f\u3400-\u9fff]+/g,"");
export const normalizedBank=(v:unknown)=>clean(v,150).toUpperCase().replace(/[^A-Z0-9]/g,"");
export const validDate=(v:unknown)=>{const s=clean(v,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+"T00:00:00Z"))?s:null;};
export const mailAddress=(v:unknown)=>{const raw=clean(v,400);const s=(raw.match(/<([^<>]+)>\s*$/)?.[1]||raw).trim().toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)?s:"";};
export const safeFileName=(v:string)=>v.replace(/[\r\n"\\/]/g,"_").slice(0,150)||"invoice";
export const FINANCE_MAX_FILE=12*1024*1024;
export const FINANCE_TYPES=new Set(["application/pdf","image/png","image/jpeg","image/webp"]);
export type Extracted={
 seller_name:string;buyer_name:string;invoice_number:string;invoice_date:string;due_date:string;
 currency:string;total_amount:string;bank_name:string;bank_account:string;notes:string;
};
export type ParsedInvoice={
 direction:"ar"|"ap"|"unknown";partyRootId:string|null;counterpartyName:string;
 invoiceNumber:string;invoiceDate:string|null;dueDate:string|null;
 currency:string|null;amountMinor:number|null;bankName:string;bankAccount:string;
 bankCheck:"match"|"mismatch"|"missing"|"unverified";extractionStatus:"extracted"|"needs_manual_review";
 extractionNote:string;
};
function isInvoiceDocumentType(contentType:string,bytes:Uint8Array){
 if(!FINANCE_TYPES.has(contentType))return false;
 if(contentType==="application/pdf")return bytes.length>4&&bytes[0]===37&&bytes[1]===80&&bytes[2]===68&&bytes[3]===70;
 if(contentType==="image/png")return bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;
 if(contentType==="image/jpeg")return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(contentType==="image/webp")return new TextDecoder().decode(bytes.slice(0,4))==="RIFF"&&new TextDecoder().decode(bytes.slice(8,12))==="WEBP";
 return false;
}
export async function storeFinanceDocument(input:{entityId:string;purpose:"invoice"|"settlement";name:string;type:string;bytes:Uint8Array;uploadedBy?:string|null}){
 if(!input.bytes.length||input.bytes.length>FINANCE_MAX_FILE||!isInvoiceDocumentType(input.type,input.bytes))
   throw new Error("Only PDF/JPEG/PNG/WebP up to 12 MB with valid file signatures are accepted");
 const id=crypto.randomUUID(),name=safeFileName(input.name);
 const key="oa/"+input.entityId+"/finance/"+input.purpose+"/"+id+"-"+name;
 await getOaEnv().uploads.put(key,input.bytes,{httpMetadata:{contentType:input.type}});
 try{
   await run("INSERT INTO oa_finance_document(id,entity_id,purpose,r2_key,original_name,content_type,size_bytes,uploaded_by) VALUES(?,?,?,?,?,?,?,?)",
     [id,input.entityId,input.purpose,key,name,input.type,input.bytes.length,input.uploadedBy||null]);
 }catch(e){await getOaEnv().uploads.delete(key);throw e;}
 return id;
}
export async function bankCheck(entityId:string,rootId:string|null,invoiceAccount:string){
 if(!rootId)return "unverified" as const;
 const party=await one<{bank_account:string}>("SELECT bank_account FROM oa_finance_party WHERE entity_id=? AND root_id=? AND status='approved'",[entityId,rootId]);
 if(!party)return "unverified" as const;
 const expected=normalizedBank(party.bank_account),actual=normalizedBank(invoiceAccount);
 if(!expected||!actual)return "missing" as const;
 return expected===actual?"match" as const:"mismatch" as const;
}
export async function findParty(entityId:string,name:string,partyType:"supplier"|"customer",email?:string){
 const parties=await all<{root_id:string;company_name:string;email:string;party_type:string}>(
  "SELECT root_id,company_name,email,party_type FROM oa_finance_party WHERE entity_id=? AND status='approved' AND (party_type=? OR party_type='both')",
  [entityId,partyType]);
 let matched=parties.filter(p=>normalizedName(p.company_name)===normalizedName(name)&&normalizedName(name)!=="");
 if(matched.length!==1&&email)matched=parties.filter(p=>mailAddress(p.email)===mailAddress(email)&&mailAddress(email)!=="");
 return matched.length===1?matched[0]:null;
}
export async function extractInvoice(input:{entityId:string;bytes:Uint8Array;type:string;name:string;subject:string;body:string;sender:string;invoiceId?:string;throwOnAiFailure?:boolean}):Promise<ParsedInvoice>{
 let data:Extracted|null=null,reason="";
 try{data=await extractWithFinanceAi(input.entityId,{bytes:input.bytes,type:input.type,name:input.name},input.subject,input.body,input.invoiceId);}
 catch(e){if(input.throwOnAiFailure)throw e;reason="AI extraction unavailable: "+(e instanceof Error?e.message:String(e)).slice(0,350);}
 const entity=await one<{legal_name:string;display_name:string}>("SELECT legal_name,display_name FROM oa_entity WHERE id=?",[input.entityId]);
 if(!data)reason=reason||"Invoice AI not configured or disabled; manual review required";
 const self=[normalizedName(entity?.legal_name),normalizedName(entity?.display_name)].filter(Boolean);
 const seller=normalizedName(data?.seller_name),buyer=normalizedName(data?.buyer_name);
 const isSeller=!!seller&&self.includes(seller),isBuyer=!!buyer&&self.includes(buyer);
 const direction:"ar"|"ap"|"unknown"=isSeller&&!isBuyer?"ar":isBuyer&&!isSeller?"ap":"unknown";
 const counterpartyName=direction==="ar"?clean(data?.buyer_name):direction==="ap"?clean(data?.seller_name):"";
 const party=direction==="unknown"?null:await findParty(input.entityId,counterpartyName,direction==="ap"?"supplier":"customer",direction==="ap"?input.sender:"");
 let currency:string|null=null,amountMinor:number|null=null;
 try{
   if(data?.currency&&data?.total_amount){currency=normalizeCurrency(data.currency);amountMinor=majorToMinor(data.total_amount,currency);if(amountMinor<=0)amountMinor=null;}
 }catch{currency=null;amountMinor=null;reason+=" Invalid amount or currency.";}
 const check=await bankCheck(input.entityId,party?.root_id||null,clean(data?.bank_account,150));
 return {direction,partyRootId:party?.root_id||null,counterpartyName,invoiceNumber:clean(data?.invoice_number,100),
   invoiceDate:validDate(data?.invoice_date),dueDate:validDate(data?.due_date),
   currency,amountMinor,bankName:clean(data?.bank_name,150),bankAccount:clean(data?.bank_account,150),
   bankCheck:check,extractionStatus:data?"extracted":"needs_manual_review",
   extractionNote:(reason||(!party?"Counterparty not uniquely matched to an approved record.":"")).slice(0,400)};
}
export async function createInvoice(input:{entityId:string;documentId:string;source:"email"|"manual";sourceEmailId?:string|null;sourceAttachmentId?:string|null;sourceMailAccountId?:string|null;sender:string;parsed:ParsedInvoice}){
 const id=crypto.randomUUID(),p=input.parsed;
 const probe={entityId:input.entityId,invoiceId:id,invoiceNumber:p.invoiceNumber,direction:p.direction,
  partyRootId:p.partyRootId,counterpartyName:p.counterpartyName,invoiceDate:p.invoiceDate,
  currency:p.currency,amountMinor:p.amountMinor};
 const duplicate=await findBusinessInvoiceDuplicate(probe);
 const fields=duplicateFields(probe,duplicate);
 // A possible business duplicate remains a separate, reviewable invoice and
 // keeps its original R2 document. It is NOT booked until reviewed.
 await run(
  "INSERT INTO oa_finance_invoice(id,entity_id,direction,party_root_id,counterparty_name,invoice_number,invoice_date,due_date,currency,amount_minor,invoice_bank_account,invoice_bank_name,sender_email,source,source_email_id,source_attachment_id,document_id,bank_check,extraction_status,extraction_note,source_mail_account_id,invoice_number_key,counterparty_key,duplicate_of_invoice_id,duplicate_status,duplicate_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  [id,input.entityId,p.direction,p.partyRootId,p.counterpartyName,p.invoiceNumber,p.invoiceDate,p.dueDate,p.currency,p.amountMinor,p.bankAccount,p.bankName,
   mailAddress(input.sender),input.source,input.sourceEmailId||null,input.sourceAttachmentId||null,input.documentId,p.bankCheck,p.extractionStatus,p.extractionNote,input.sourceMailAccountId||null,
   fields.invoice_number_key,fields.counterparty_key,fields.duplicate_of_invoice_id,fields.duplicate_status,fields.duplicate_reason]
 );
 if(duplicate){
  await audit(null,"finance.invoice.possible_duplicate","finance_invoice",id,
   {duplicateOf:duplicate.id,reason:duplicate.reason,source:input.source},input.entityId);
 }
 return id;
}