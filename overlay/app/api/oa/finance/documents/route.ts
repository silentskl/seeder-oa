import {resolveFinanceEntityAccess} from "@/lib/oa/finance-entity";
import {NextRequest,NextResponse} from "next/server";
import {getViewer} from "@/lib/auth-server";
import {EntityAccessError} from "@/lib/oa/entity";
import {audit} from "@/lib/oa/db";
import {FINANCE_MAX_FILE,FINANCE_TYPES,storeFinanceDocument} from "@/lib/oa/finance";
export const runtime="nodejs";
const fail=(error:string,status=400)=>NextResponse.json({ok:false,error},{status});
export async function POST(request:NextRequest){
 const viewer=await getViewer();if(!viewer)return fail("Unauthorized",401);
 try{
  const form=await request.formData(),access=await resolveFinanceEntityAccess(viewer.id,form.get("entity_id"));
  if(access.role!=="admin")return fail("Forbidden",403);
  const purpose=String(form.get("purpose")||"");
  if(purpose!=="invoice"&&purpose!=="settlement")return fail("Invalid purpose",400);
  const file=form.get("file");
  if(!(file instanceof File))return fail("Missing file",400);
  if(file.size<1||file.size>FINANCE_MAX_FILE)return fail("Maximum upload size is 12MB",413);
  const type=file.type==="image/jpg"?"image/jpeg":file.type;
  if(!FINANCE_TYPES.has(type))return fail("Only PDF/JPG/PNG/WebP",415);
  const id=await storeFinanceDocument({entityId:access.entityId,purpose,type,name:file.name,bytes:new Uint8Array(await file.arrayBuffer()),uploadedBy:viewer.id});
  await audit(viewer.id,"finance.document.upload","finance_document",id,{purpose,name:file.name,size:file.size},access.entityId);
  return NextResponse.json({ok:true,data:{id,name:file.name,purpose}}, {status:201});
 }catch(e){
  if(e instanceof EntityAccessError)return fail(e.message,e.status);
  console.error("Finance attachment upload failed",e);
  return fail(e instanceof Error?e.message:"Upload failed",500);
 }
}