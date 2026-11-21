import {NextResponse} from "next/server";
import {getViewer} from "@/lib/auth-server";
import {listContractAccessEntities} from "@/lib/oa/admin-permissions";
export const runtime="nodejs";
export async function GET(){
 const viewer=await getViewer();
 if(!viewer)return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
 try{
  const entities=await listContractAccessEntities(viewer.id);
  return NextResponse.json({ok:true,data:{entities}},{headers:{"cache-control":"private, no-store"}});
 }catch(error){
  console.error("OA contract entities failed",error);
  return NextResponse.json({ok:false,error:"Contract access unavailable"},{status:500});
 }
}
