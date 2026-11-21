import {NextRequest,NextResponse} from "next/server";
import {getViewer} from "@/lib/auth-server";
import {audit,all,one,run} from "@/lib/oa/db";
import {getOaEnv} from "@/lib/oa/env";
import {EntityAccessError} from "@/lib/oa/entity";
import {resolveFinanceEntityAccess} from "@/lib/oa/finance-entity";
import {canManageParties} from "@/lib/oa/admin-permissions";
import {FINANCE_MAX_FILE,FINANCE_TYPES,isFinanceDocumentType,safeFileName} from "@/lib/oa/finance";

export const runtime="nodejs";
const ok=(data:unknown,status=200)=>NextResponse.json({ok:true,data},{status,headers:{"cache-control":"no-store"}});
const fail=(error:string,status=400)=>NextResponse.json({ok:false,error},{status,headers:{"cache-control":"no-store"}});
const clean=(v:unknown,max:number)=>String(v??"").trim().slice(0,max);
function date(v:unknown){
 const text=clean(v,20);
 if(!text)return null;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text+"T00:00:00Z"))
   || new Date(text+"T00:00:00Z").toISOString().slice(0,10)!==text)
  throw new Error("Invalid contract date");
 return text;
}
async function authorize(userId:string,requested:unknown){
 const access=await resolveFinanceEntityAccess(userId,requested);
 if(!await canManageParties(userId,access.entityId,access.role==="admin"))
   throw new EntityAccessError(403,"Forbidden");
 return access.entityId;
}
function handleError(error:unknown,operation:string){
 if(error instanceof EntityAccessError)return fail(error.message,error.status);
 if(error instanceof Error && /^(Invalid contract date|Contract dates out of order)$/.test(error.message))
   return fail(error.message);
 console.error("OA contracts "+operation+" failed",error);
 return fail("Contract "+operation+" failed",500);
}
export async function GET(request:NextRequest){
 const viewer=await getViewer();if(!viewer)return fail("Unauthorized",401);
 try{
  const entity=await authorize(viewer.id,request.nextUrl.searchParams.get("entity_id"));
  const offset=Number(request.nextUrl.searchParams.get("offset")||0);
  if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)return fail("Invalid offset");
  const [parties,rows]=await Promise.all([
   all<{root_id:string;party_type:string;company_name:string}>(`SELECT root_id,party_type,company_name FROM oa_finance_party
    WHERE entity_id=? AND status='approved' ORDER BY company_name,root_id`,[entity]),
   all(`SELECT c.id,c.entity_id,c.party_root_id,c.party_role,c.title,c.contract_number,
    c.effective_date,c.expiry_date,c.notes,c.original_name,c.content_type,c.size_bytes,
    c.uploaded_by,c.created_at,COALESCE(p.company_name,c.party_name_at_upload) AS party_name
    FROM oa_contract c LEFT JOIN oa_finance_party p
     ON p.entity_id=c.entity_id AND p.root_id=c.party_root_id AND p.status='approved'
    WHERE c.entity_id=? ORDER BY c.created_at DESC,c.id DESC LIMIT 101 OFFSET ?`,[entity,offset])
  ]);
  return ok({parties,contracts:rows.slice(0,100),nextOffset:rows.length>100?offset+100:null});
 }catch(error){return handleError(error,"list");}
}
export async function POST(request:NextRequest){
 const viewer=await getViewer();if(!viewer)return fail("Unauthorized",401);
 try{
  const form=await request.formData();
  const entity=await authorize(viewer.id,form.get("entity_id"));
  const partyRootId=clean(form.get("party_root_id"),100);
  const partyRole=clean(form.get("party_role"),12);
  if(!partyRootId||!(partyRole==="supplier"||partyRole==="customer"))
    return fail("Select a supplier or customer");
  const party=await one<{company_name:string}>(`SELECT company_name FROM oa_finance_party
   WHERE entity_id=? AND root_id=? AND status='approved'
    AND (party_type=? OR party_type='both')`,[entity,partyRootId,partyRole]);
  if(!party)return fail("Approved supplier/customer not found in this Entity",404);
  const title=clean(form.get("title"),200);
  if(!title)return fail("Contract title is required");
  const contractNumber=clean(form.get("contract_number"),120);
  const notes=clean(form.get("notes"),1000);
  const effectiveDate=date(form.get("effective_date"));
  const expiryDate=date(form.get("expiry_date"));
  if(effectiveDate&&expiryDate&&effectiveDate>expiryDate)throw new Error("Contract dates out of order");
  const file=form.get("file");
  if(!(file instanceof File))return fail("Choose a contract file");
  if(file.size<1||file.size>FINANCE_MAX_FILE)return fail("Maximum file size is 12 MB",413);
  const type=file.type==="image/jpg"?"image/jpeg":file.type;
  if(!FINANCE_TYPES.has(type))return fail("Only PDF/JPG/PNG/WebP files are accepted",415);
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(!isFinanceDocumentType(type,bytes))return fail("File content does not match its declared type",415);
  const id=crypto.randomUUID(),name=safeFileName(file.name);
  const key="oa/"+entity+"/contracts/"+id+"-"+name;
  await getOaEnv().uploads.put(key,bytes,{httpMetadata:{contentType:type}});
  try{
   await run(`INSERT INTO oa_contract(id,entity_id,party_root_id,party_role,party_name_at_upload,title,
    contract_number,effective_date,expiry_date,notes,r2_key,original_name,content_type,size_bytes,uploaded_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,entity,partyRootId,partyRole,party.company_name,title,contractNumber,
     effectiveDate,expiryDate,notes,key,name,type,file.size,viewer.id]);
  }catch(error){await getOaEnv().uploads.delete(key);throw error;}
  await audit(viewer.id,"oa.contract.upload","oa_contract",id,{partyRootId,partyRole,title,contractNumber,size:file.size},entity);
  return ok({id},201);
 }catch(error){return handleError(error,"upload");}
}
