import {NextRequest,NextResponse} from "next/server";
import {getViewer} from "@/lib/auth-server";
import {resolveBusinessEntityAccess,EntityAccessError} from "@/lib/oa/entity";
import {one} from "@/lib/oa/db";
import {getOaEnv} from "@/lib/oa/env";
import {safeFileName} from "@/lib/oa/finance";
export const runtime="nodejs";
const fail=(error:string,status=400)=>NextResponse.json({ok:false,error},{status});
export async function GET(request:NextRequest,context:{params:Promise<{id:string}>}){
 const viewer=await getViewer();if(!viewer)return fail("Unauthorized",401);
 try{
  const access=await resolveBusinessEntityAccess(viewer.id,request.nextUrl.searchParams.get("entity_id"));
  if(access.role!=="admin")return fail("Forbidden",403);
  const {id}=await context.params;
  const doc=await one<{r2_key:string;original_name:string;content_type:string}>("SELECT r2_key,original_name,content_type FROM oa_finance_document WHERE id=? AND entity_id=?",[id,access.entityId]);
  if(!doc)return fail("Document not found",404);
  const object=await getOaEnv().uploads.get(doc.r2_key);if(!object)return fail("Document no longer stored",404);
  const headers=new Headers({"cache-control":"private, no-store","content-type":doc.content_type,"x-content-type-options":"nosniff","content-disposition":'attachment; filename="'+safeFileName(doc.original_name)+'"'});
  return new Response(object.body,{headers});
 }catch(e){if(e instanceof EntityAccessError)return fail(e.message,e.status);console.error(e);return fail("Download failed",500);}
}