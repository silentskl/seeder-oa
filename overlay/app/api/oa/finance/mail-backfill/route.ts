import {NextRequest,NextResponse} from "next/server";
import {getViewer} from "@/lib/auth-server";
import {resolveFinanceEntityAccess} from "@/lib/oa/finance-entity";
import {EntityAccessError} from "@/lib/oa/entity";
import {listMailBackfills,startMailBackfill,updateMailBackfillStatus,processMailBackfill} from "@/lib/oa/finance-mail-backfill";

export const runtime="nodejs";
const ok=(data:unknown,status=200)=>NextResponse.json({ok:true,data},{status});
const fail=(error:string,status=400)=>NextResponse.json({ok:false,error},{status});
async function authorize(entity:unknown){
 const viewer=await getViewer();
 if(!viewer)return {error:fail("Unauthorized",401)};
 const access=await resolveFinanceEntityAccess(viewer.id,entity);
 if(access.role!=="admin")return {error:fail("Company finance administrator required",403)};
 return {entityId:access.entityId,userId:viewer.id};
}
function failure(e:unknown){
 if(e instanceof EntityAccessError)return fail(e.message,e.status);
 const message=e instanceof Error?e.message:"Historical synchronization error";
 if(/^(Invalid|Backfill|Mailbox|Historical|Company)/.test(message))return fail(message,409);
 console.error("Finance backfill request failed",{errorType:e instanceof Error?e.name:"unknown"});
 return fail("Historical synchronization request failed",500);
}
export async function GET(req:NextRequest){
 try{
  const a=await authorize(req.nextUrl.searchParams.get("entity_id"));
  if(a.error)return a.error;
  return ok(await listMailBackfills(a.entityId!));
 }catch(e){return failure(e);}
}
export async function POST(req:NextRequest){
 try{
  const body=await req.json() as Record<string,unknown>;
  const a=await authorize(body.entity_id);
  if(a.error)return a.error;
  const id=String(body.id??"").slice(0,100);
  const action=String(body.action??"").slice(0,30);
  if(action==="create"){
   const accountId=String(body.account_id??"").slice(0,100);
   if(!accountId)return fail("Mailbox ID required");
   const result=await startMailBackfill(a.entityId!,accountId,a.userId!,body.date_from,body.date_to);
   return ok(result,201);
  }
  if(action==="pause"||action==="resume"||action==="cancel"){
   if(!id)return fail("Historical sync task ID required");
   return ok(await updateMailBackfillStatus(a.entityId!,id,a.userId!,action));
  }
  // Admin may process a small batch immediately for interactive feedback.
  // Subsequent batches run via the scheduled background sync-job endpoint.
  if(action==="process"){
   if(!id)return fail("Historical sync task ID required");
   const row=(await listMailBackfills(a.entityId!)).find(x=>x.id===id);
   if(!row)return fail("Historical sync task not found",404);
   return ok(await processMailBackfill(id,a.entityId!));
  }
  return fail("Unknown backfill action",404);
 }catch(e){return failure(e);}
}
