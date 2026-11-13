import {NextRequest,NextResponse} from "next/server";
import {getViewer} from "@/lib/auth-server";
import {all,audit,one,run} from "@/lib/oa/db";
import {resolveBusinessEntityAccess,EntityAccessError} from "@/lib/oa/entity";
import {bankCheck,clean,createInvoice,extractInvoice,mailAddress,normalizedBank,normalizedName} from "@/lib/oa/finance";
import {getOaEnv} from "@/lib/oa/env";
import {majorToMinor,normalizeCurrency} from "@/lib/oa/money";

export const runtime="nodejs";
const ok=(data:unknown,status=200)=>NextResponse.json({ok:true,data},{status});
const fail=(error:string,status=400)=>NextResponse.json({ok:false,error},{status});
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);
function checkEmail(v:unknown){const s=clean(v,320);if(s&&!mailAddress(s))throw new Error("Invalid email address");return s.toLowerCase();}
function validDate(v:unknown){const s=clean(v,10);if(s&&!/^\d{4}-\d{2}-\d{2}$/.test(s))throw new Error("Invalid YYYY-MM-DD date");return s||null;}
function partyType(v:unknown){const s=clean(v,12);if(!["supplier","customer","both"].includes(s))throw new Error("Invalid supplier/customer type");return s;}
async function adminAssignee(entity:string,userId:string,proposer:string){
 const member=await one<{user_id:string}>("SELECT user_id FROM oa_entity_member WHERE entity_id=? AND user_id=? AND role='admin' AND active=1",[entity,userId]);
 if(!member||userId===proposer)throw new Error("Assignee must be an active different Entity admin");
 return userId;
}
function withAccess(e:unknown){
 if(e instanceof EntityAccessError)return fail(e.message,e.status);
 const msg=errorText(e);if(/^(Invalid|Missing|Select|Invoice|Bank|Cannot|Assignee|Only|This|Party|Settlement|Duplicate|No |A |Proof)/.test(msg))return fail(msg,409);
 console.error("OA finance operation failed",e);
 return fail("Finance operation failed",500);
}
async function accessFor(req:NextRequest,entity:unknown){
 const viewer=await getViewer();if(!viewer)throw new Error("UNAUTHORIZED");
 const access=await resolveBusinessEntityAccess(viewer.id,entity);
 return {viewer,access,entity:access.entityId};
}
export async function GET(request:NextRequest){
 try{
  const {access,entity}=await accessFor(request,request.nextUrl.searchParams.get("entity_id"));
  if(access.role!=="admin")return fail("Forbidden",403);
  const view=clean(request.nextUrl.searchParams.get("view"),30);
  if(view==="parties")return ok(await all<any>("SELECT * FROM oa_finance_party WHERE entity_id=? ORDER BY created_at DESC,id DESC LIMIT 300",[entity]));
  if(view==="invoices")return ok(await all<any>("SELECT i.*,p.company_name AS approved_party_name,d.original_name AS document_name FROM oa_finance_invoice i LEFT JOIN oa_finance_party p ON p.entity_id=i.entity_id AND p.root_id=i.party_root_id AND p.status='approved' LEFT JOIN oa_finance_document d ON d.id=i.document_id AND d.entity_id=i.entity_id WHERE i.entity_id=? ORDER BY i.created_at DESC,i.id DESC LIMIT 300",[entity]));
  if(view==="settlements")return ok(await all<any>("SELECT s.*,i.invoice_number,i.direction,i.currency,i.amount_minor,i.counterparty_name,d.original_name AS proof_name FROM oa_finance_settlement s JOIN oa_finance_invoice i ON i.id=s.invoice_id AND i.entity_id=s.entity_id JOIN oa_finance_document d ON d.id=s.document_id AND d.entity_id=s.entity_id WHERE s.entity_id=? ORDER BY s.submitted_at DESC,s.id DESC LIMIT 300",[entity]));
  if(view==="config"){
   const mailbox=await one<{address:string;receive_address:string}>("SELECT address,receive_address FROM oa_finance_mailbox WHERE entity_id=?",[entity]);
   const approvers=await all<{id:string;name:string;email:string}>("SELECT u.id,u.name,u.email FROM oa_entity_member m JOIN user u ON u.id=m.user_id WHERE m.entity_id=? AND m.active=1 AND m.role='admin' ORDER BY u.name,u.email",[entity]);
   return ok({mailbox:mailbox?.address||"",receiveAddress:mailbox?.receive_address||"",approvers,aiConfigured:!!getOaEnv().financeAiKey,resendConfigured:!!getOaEnv().financeResendApiKey&&!!getOaEnv().financeResendWebhookSecret});
  }
  return fail("Unknown finance view",404);
 }catch(e){if(errorText(e)==="UNAUTHORIZED")return fail("Unauthorized",401);return withAccess(e);}
}
export async function POST(request:NextRequest){
 try{
  const body=await request.json() as Record<string,any>;
  const {viewer,access,entity}=await accessFor(request,body.entity_id);
  const action=clean(body.action,40);
  if(action==="party_propose"){
   const name=clean(body.company_name,250);
   if(!name)throw new Error("Missing company name");
   const type=partyType(body.party_type),email=checkEmail(body.email);
   let root=clean(body.root_id,60),current=null as any;
   if(root){
    current=await one<any>("SELECT id,created_by FROM oa_finance_party WHERE root_id=? AND entity_id=? AND status='approved'",[root,entity]);
    if(!current)throw new Error("Party not found or unapproved");
   }else root=crypto.randomUUID();
   if(await one("SELECT id FROM oa_finance_party WHERE root_id=? AND entity_id=? AND status='pending'",[root,entity]))throw new Error("Party already has a pending change");
   const id=crypto.randomUUID(),assignee=clean(body.assigned_approver_user_id,80);
   if(assignee)await adminAssignee(entity,assignee,viewer.id);
   await run("INSERT INTO oa_finance_party(id,entity_id,root_id,party_type,company_name,address,contact_name,email,phone,bank_name,bank_account,bank_swift,status,created_by,assigned_approver_user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [id,entity,root,type,name,clean(body.address,1500),clean(body.contact_name,150),email,clean(body.phone,90),clean(body.bank_name,160),clean(body.bank_account,150),clean(body.bank_swift,80),"pending",viewer.id,assignee||null]);
   await audit(viewer.id,"finance.party.propose","finance_party",id,{root,type,change:!!current,assignee:assignee||null},entity);
   return ok({id,root_id:root,status:"pending"},201);
  }
  if(access.role!=="admin")return fail("Forbidden",403);
  if(action==="set_mailbox"){
   const address=checkEmail(body.address);
   if(!/^payable@[^@]+$/.test(address))throw new Error("Invalid mailbox: use payable@your-company-domain");
   const receiveAddress=body.receive_address?checkEmail(body.receive_address):address;
   if(!receiveAddress)throw new Error("Invalid receiving/forwarding address");
   await run("INSERT INTO oa_finance_mailbox(entity_id,address,receive_address,updated_by) VALUES(?,?,?,?) ON CONFLICT(entity_id) DO UPDATE SET address=excluded.address,receive_address=excluded.receive_address,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP",[entity,address,receiveAddress,viewer.id]);
   await audit(viewer.id,"finance.mailbox.configure","finance_mailbox",entity,{address,receiveAddress},entity);
   return ok({address,receiveAddress});
  }
  if(action==="party_assign"){
   const id=clean(body.id,80),row=await one<any>("SELECT created_by,status FROM oa_finance_party WHERE id=? AND entity_id=?",[id,entity]);
   if(!row||row.status!=="pending")throw new Error("Party proposal is not pending");
   const assignee=await adminAssignee(entity,clean(body.approver_id,80),row.created_by);
   await run("UPDATE oa_finance_party SET assigned_approver_user_id=? WHERE entity_id=? AND id=? AND status='pending'",[assignee,entity,id]);
   await audit(viewer.id,"finance.party.assign","finance_party",id,{assignee},entity);
   return ok({status:"pending",assignee});
  }
  if(action==="party_approve"||action==="party_reject"){
   const id=clean(body.id,80),row=await one<any>("SELECT * FROM oa_finance_party WHERE id=? AND entity_id=? AND status='pending'",[id,entity]);
   if(!row)throw new Error("Party proposal is no longer pending");
   if(row.created_by===viewer.id)throw new Error("Cannot approve or reject your own party proposal");
   if(row.assigned_approver_user_id&&row.assigned_approver_user_id!==viewer.id)return fail("Assigned administrator only",403);
   const note=clean(body.note,1000);
   const db=getOaEnv().db;
   const updates=[];
   if(action==="party_approve")updates.push(db.prepare("UPDATE oa_finance_party SET status='superseded' WHERE entity_id=? AND root_id=? AND status='approved'").bind(entity,row.root_id));
   updates.push(db.prepare("UPDATE oa_finance_party SET status=?,approved_by=?,approved_at=CURRENT_TIMESTAMP,decision_note=? WHERE id=? AND entity_id=? AND status='pending'").bind(action==="party_approve"?"approved":"rejected",viewer.id,note||null,id,entity));
   const result=await db.batch(updates);
   if(result[result.length-1].meta?.changes!==1)throw new Error("Party proposal was already processed");
   await audit(viewer.id,action==="party_approve"?"finance.party.approve":"finance.party.reject","finance_party",id,{root:row.root_id,note},entity);
   return ok({status:action==="party_approve"?"approved":"rejected"});
  }
  if(action==="invoice_import"){
   const documentId=clean(body.document_id,90);
   const doc=await one<any>("SELECT * FROM oa_finance_document WHERE id=? AND entity_id=? AND purpose='invoice'",[documentId,entity]);
   if(!doc)throw new Error("Invoice document not found");
   if(await one("SELECT id FROM oa_finance_invoice WHERE entity_id=? AND document_id=?",[entity,documentId]))throw new Error("Duplicate invoice document import");
   const object=await getOaEnv().uploads.get(doc.r2_key);if(!object)throw new Error("Invoice document bytes missing");
   const parsed=await extractInvoice({entityId:entity,bytes:new Uint8Array(await object.arrayBuffer()),type:doc.content_type,name:doc.original_name,subject:clean(body.subject,160),body:"",sender:""});
   const id=await createInvoice({entityId:entity,documentId,source:"manual",sender:"",parsed});
   await audit(viewer.id,"finance.invoice.import","finance_invoice",id,{documentId,extraction:parsed.extractionStatus},entity);
   return ok({id,status:"needs_review"},201);
  }
  if(action==="invoice_review"){
   const id=clean(body.id,80);
   const prev=await one<any>("SELECT * FROM oa_finance_invoice WHERE entity_id=? AND id=? AND status='needs_review'",[entity,id]);
   if(!prev)throw new Error("Invoice is not awaiting review");
   const direction=clean(body.direction,10);
   if(!["ar","ap"].includes(direction))throw new Error("Select AR or AP");
   const root=clean(body.party_root_id,80);
   const party=await one<any>("SELECT * FROM oa_finance_party WHERE entity_id=? AND root_id=? AND status='approved'",[entity,root]);
   if(!party||!(party.party_type==="both"||party.party_type===(direction==="ap"?"supplier":"customer")))throw new Error("Select an approved matching supplier/customer");
   const number=clean(body.invoice_number,100);if(!number)throw new Error("Missing invoice number");
   const currency=normalizeCurrency(body.currency);
   const amount=majorToMinor(body.amount,currency);if(amount<=0)throw new Error("Invalid invoice amount");
   const account=clean(body.invoice_bank_account,150);
   const bank=await bankCheck(entity,root,account);
   // For AP, the beneficiary account must match the currently approved supplier bank record.
   if(direction==="ap"&&bank!=="match")throw new Error("Bank account verification required before an AP invoice can be opened");
   const result=await run("UPDATE oa_finance_invoice SET direction=?,party_root_id=?,counterparty_name=?,invoice_number=?,invoice_date=?,due_date=?,currency=?,amount_minor=?,invoice_bank_account=?,invoice_bank_name=?,bank_check=?,status='open',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND entity_id=? AND status='needs_review'",
    [direction,root,party.company_name,number,validDate(body.invoice_date),validDate(body.due_date),currency,amount,account,clean(body.invoice_bank_name,160),bank,viewer.id,id,entity]);
   if(result.meta?.changes!==1)throw new Error("Invoice was already reviewed");
   await audit(viewer.id,"finance.invoice.review","finance_invoice",id,{direction,root,bankCheck:bank},entity);
   return ok({status:"open",bank_check:bank});
  }
  if(action==="invoice_reject"){
   const id=clean(body.id,80);
   const result=await run("UPDATE oa_finance_invoice SET status='rejected',updated_at=CURRENT_TIMESTAMP WHERE id=? AND entity_id=? AND status='needs_review'",[id,entity]);
   if(result.meta?.changes!==1)throw new Error("Invoice is not awaiting review");
   await audit(viewer.id,"finance.invoice.reject","finance_invoice",id,{note:clean(body.note,1000)},entity);
   return ok({status:"rejected"});
  }
  if(action==="settlement_submit"){
   const invoiceId=clean(body.invoice_id,80),documentId=clean(body.document_id,80);
   const invoice=await one<any>("SELECT * FROM oa_finance_invoice WHERE entity_id=? AND id=? AND status='open'",[entity,invoiceId]);
   const doc=await one<any>("SELECT id FROM oa_finance_document WHERE entity_id=? AND id=? AND purpose='settlement'",[entity,documentId]);
   if(!invoice||!doc)throw new Error("Invoice must be open and receipt/payment proof must be uploaded");
   if(invoice.direction==="ap"&&await bankCheck(entity,invoice.party_root_id,invoice.invoice_bank_account)!=="match")
     throw new Error("Bank account changed: supplier payment requires re-verification");
   const id=crypto.randomUUID(),db=getOaEnv().db,assignee=clean(body.approver_id,80);
   if(assignee)await adminAssignee(entity,assignee,viewer.id);
   const result=await db.batch([
    db.prepare("INSERT INTO oa_finance_settlement(id,entity_id,invoice_id,document_id,submitted_by,approver_user_id) VALUES(?,?,?,?,?,?)").bind(id,entity,invoiceId,documentId,viewer.id,assignee||null),
    db.prepare("UPDATE oa_finance_invoice SET status='settlement_pending',updated_at=CURRENT_TIMESTAMP WHERE id=? AND entity_id=? AND status='open'").bind(invoiceId,entity)
   ]);
   if(result[1].meta?.changes!==1)throw new Error("Invoice was changed during proof submission");
   await audit(viewer.id,"finance.settlement.submit","finance_settlement",id,{invoiceId,documentId,assignee:assignee||null},entity);
   return ok({id,status:"pending"},201);
  }
  if(action==="settlement_assign"){
   const id=clean(body.id,80),row=await one<any>("SELECT submitted_by FROM oa_finance_settlement WHERE id=? AND entity_id=? AND status='pending'",[id,entity]);
   if(!row)throw new Error("Settlement is not pending");
   const assignee=await adminAssignee(entity,clean(body.approver_id,80),row.submitted_by);
   await run("UPDATE oa_finance_settlement SET approver_user_id=? WHERE id=? AND entity_id=? AND status='pending'",[assignee,entity,id]);
   await audit(viewer.id,"finance.settlement.assign","finance_settlement",id,{assignee},entity);
   return ok({assignee});
  }
  if(action==="settlement_approve"||action==="settlement_reject"){
   const id=clean(body.id,80),row=await one<any>("SELECT s.*,i.direction,i.party_root_id,i.invoice_bank_account,i.status AS invoice_status FROM oa_finance_settlement s JOIN oa_finance_invoice i ON i.id=s.invoice_id AND i.entity_id=s.entity_id WHERE s.id=? AND s.entity_id=? AND s.status='pending'",[id,entity]);
   if(!row||row.invoice_status!=="settlement_pending")throw new Error("Settlement is no longer pending");
   if(row.submitted_by===viewer.id)throw new Error("Cannot approve or reject your own proof submission");
   if(row.approver_user_id&&row.approver_user_id!==viewer.id)return fail("Assigned administrator only",403);
   if(action==="settlement_approve"&&row.direction==="ap"&&await bankCheck(entity,row.party_root_id,row.invoice_bank_account)!=="match")
     throw new Error("Bank account mismatch: settlement approval blocked");
   const db=getOaEnv().db,note=clean(body.note,1000),approve=action==="settlement_approve";
   const result=await db.batch([
    db.prepare("UPDATE oa_finance_settlement SET status=?,decided_by=?,decided_at=CURRENT_TIMESTAMP,note=? WHERE id=? AND entity_id=? AND status='pending'").bind(approve?"approved":"rejected",viewer.id,note||null,id,entity),
    db.prepare("UPDATE oa_finance_invoice SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND entity_id=? AND status='settlement_pending'").bind(approve?"settled":"open",row.invoice_id,entity)
   ]);
   if(result[0].meta?.changes!==1||result[1].meta?.changes!==1)throw new Error("Settlement approval conflict");
   await audit(viewer.id,approve?"finance.settlement.approve":"finance.settlement.reject","finance_settlement",id,{invoiceId:row.invoice_id,note},entity);
   return ok({status:approve?"approved":"rejected",invoice_status:approve?"settled":"open"});
  }
  return fail("Unknown finance action",404);
 }catch(e){if(errorText(e)==="UNAUTHORIZED")return fail("Unauthorized",401);return withAccess(e);}
}