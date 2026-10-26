import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/auth-server";
import { audit, one, run } from "@/lib/oa/db";
import { getOaEnv } from "@/lib/oa/env";
import { EntityAccessError, LEGACY_ENTITY_ID, requireLegacyOaAccess } from "@/lib/oa/entity";

export const runtime = "nodejs";
const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_KINDS = new Set(["receipt","leave_attachment","payslip","other"]);
const ALLOWED_TYPES = new Set(["application/pdf","image/jpeg","image/png","image/webp"]);

function fail(message:string,status=400){ return NextResponse.json({ok:false,error:message},{status}); }
function safeName(name:string){ return name.replace(/[\r\n"\\/]/g,"_").slice(0,180) || "file"; }

export async function POST(request:NextRequest, context:{params:Promise<{id:string}>}) {
  const viewer=await getViewer(); if(!viewer) return fail("Unauthorized",401);
  let access;
  try { access=await requireLegacyOaAccess(viewer.id); } catch(e) { if(e instanceof EntityAccessError) return fail("Forbidden",e.status); throw e; }
  const {id}=await context.params; if(id!=="upload") return fail("Not found",404);
  try {
    const form=await request.formData();
    const file=form.get("file");
    if(!(file instanceof File)) return fail("file is required");
    if(file.size<=0 || file.size>MAX_BYTES) return fail("File must be between 1 byte and 15 MB");
    const type=file.type || "application/octet-stream";
    if(!ALLOWED_TYPES.has(type)) return fail("Only PDF, JPG, PNG and WebP files are accepted");
    const kind=String(form.get("kind")||"other");
    if(!ALLOWED_KINDS.has(kind)) return fail("Invalid file kind");
    let ownerUserId=String(form.get("ownerUserId")||viewer.id);
    if(ownerUserId!==viewer.id && access.role!=="admin") return fail("Forbidden",403);
    const ownerAccess=await one<{user_id:string}>(`SELECT user_id FROM oa_entity_member WHERE entity_id=? AND user_id=? AND active=1`,[LEGACY_ENTITY_ID,ownerUserId]);
    if(!ownerAccess) return fail("Employee not found",404);
    const owner=await one<{id:string}>(`SELECT id FROM user WHERE id=?`,[ownerUserId]);
    if(!owner) return fail("Employee not found",404);

    const fileId=crypto.randomUUID();
    const name=safeName(file.name);
    const r2Key=`oa/${LEGACY_ENTITY_ID}/${ownerUserId}/${kind}/${fileId}-${name}`;
    const {uploads}=getOaEnv();
    await uploads.put(r2Key,await file.arrayBuffer(),{httpMetadata:{contentType:type}});
    try {
      await run(`INSERT INTO oa_file(id,owner_user_id,kind,r2_key,original_name,content_type,size_bytes,entity_id) VALUES(?,?,?,?,?,?,?,?)`,[fileId,ownerUserId,kind,r2Key,name,type,file.size,LEGACY_ENTITY_ID]);
    } catch (error) {
      await uploads.delete(r2Key);
      throw error;
    }
    await audit(viewer.id,"uploadFile","file",fileId,{kind,ownerUserId,size:file.size});
    return NextResponse.json({ok:true,data:{id:fileId,name,type,size:file.size}});
  } catch(error) {
    console.error("OA file upload failed",error);
    return fail(error instanceof Error?error.message:"Upload failed",500);
  }
}

export async function GET(_request:NextRequest, context:{params:Promise<{id:string}>}) {
  const viewer=await getViewer(); if(!viewer) return fail("Unauthorized",401);
  const {id}=await context.params;
  const file=await one<{id:string;owner_user_id:string;kind:string;r2_key:string;original_name:string;content_type:string}>(`SELECT * FROM oa_file WHERE id=? AND entity_id=?`,[id,LEGACY_ENTITY_ID]);
  if(!file) return fail("File not found",404);

  let allowed=file.owner_user_id===viewer.id || access.role==="admin";
  if(!allowed && (file.kind==="receipt" || file.kind==="leave_attachment")) {
    const employee=await one<{manager_user_id:string|null}>(`SELECT manager_user_id FROM oa_entity_employee WHERE user_id=? AND entity_id=?`,[file.owner_user_id,LEGACY_ENTITY_ID]);
    allowed=employee?.manager_user_id===viewer.id;
  }
  if(!allowed) return fail("Forbidden",403);

  const {uploads}=getOaEnv();
  const object=await uploads.get(file.r2_key); if(!object) return fail("Object not found",404);
  const headers=new Headers();
  headers.set("content-type",file.content_type||"application/octet-stream");
  headers.set("content-disposition",`attachment; filename="${safeName(file.original_name)}"`);
  headers.set("cache-control","private, no-store");
  if(object.size!=null) headers.set("content-length",String(object.size));
  return new Response(object.body,{headers});
}
