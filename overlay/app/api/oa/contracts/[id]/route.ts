import {NextRequest,NextResponse} from "next/server";
import {getViewer} from "@/lib/auth-server";
import {one} from "@/lib/oa/db";
import {getOaEnv} from "@/lib/oa/env";
import {EntityAccessError} from "@/lib/oa/entity";
import {resolveFinanceEntityAccess} from "@/lib/oa/finance-entity";
import {canManageParties} from "@/lib/oa/admin-permissions";
import {safeFileName} from "@/lib/oa/finance";

export const runtime="nodejs";
const fail=(error:string,status=400)=>NextResponse.json({ok:false,error},{status,headers:{"cache-control":"private, no-store"}});
export async function GET(request:NextRequest,context:{params:Promise<{id:string}>}){
 const viewer=await getViewer();if(!viewer)return fail("Unauthorized",401);
 try{
  const access=await resolveFinanceEntityAccess(viewer.id,request.nextUrl.searchParams.get("entity_id"));
  if(!await canManageParties(viewer.id,access.entityId,access.role==="admin"))
   return fail("Forbidden",403);
  const {id}=await context.params;
  const contract=await one<{r2_key:string;original_name:string;content_type:string;size_bytes:number}>(`
   SELECT r2_key,original_name,content_type,size_bytes FROM oa_contract WHERE id=? AND entity_id=?`,[id,access.entityId]);
  if(!contract)return fail("Contract not found",404);
  const object=await getOaEnv().uploads.get(contract.r2_key);
  if(!object)return fail("Contract file missing",404);
  const attachment=request.nextUrl.searchParams.get("download")==="1";
  const name=safeFileName(contract.original_name);
  const asciiName=name.replace(/[^\x20-\x7e]/g,"_").replace(/["\\]/g,"_")||"contract";
  const disposition=(attachment?"attachment":"inline")+"; filename=\""+asciiName+"\"; filename*=UTF-8''"+encodeURIComponent(name);
  const headers=new Headers({
   "content-type":contract.content_type,
   "content-disposition":disposition,
   "cache-control":"private, no-store",
   "x-content-type-options":"nosniff",
   "referrer-policy":"no-referrer",
  });
  return new Response(object.body,{headers});
 }catch(error){
  if(error instanceof EntityAccessError)return fail(error.message,error.status);
  console.error("OA contract view failed",error);
  return fail("Contract download failed",500);
 }
}
