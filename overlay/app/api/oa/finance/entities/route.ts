import {NextRequest,NextResponse} from "next/server";
import {getViewer} from "@/lib/auth-server";
import {listFinanceAdminEntities,financeMultiEntityActive} from "@/lib/oa/finance-entity";
import {listPartyManagementEntities} from "@/lib/oa/admin-permissions";
import {logOaFailure} from "@/lib/oa/runtime-diagnostics";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
export async function GET(request:NextRequest){
 const reference=crypto.randomUUID();
 let stage="finance.entities.session";
 try{
  const viewer=await getViewer();
  if(!viewer)return NextResponse.json({ok:false,error:"Unauthorized"},{status:401,headers});
  const scope=request.nextUrl.searchParams.get("scope");
  if(scope!==null&&scope!=="ledger"&&scope!=="parties")return NextResponse.json({ok:false,error:"Invalid scope"},{status:400,headers});
  stage="finance.entities."+ (scope||"both");
  const [financeEntities,entities]=await Promise.all([
   scope==="parties"?Promise.resolve([]):listFinanceAdminEntities(viewer.id),
   scope==="ledger"?Promise.resolve([]):listPartyManagementEntities(viewer.id)
  ]);
  if((scope==="ledger"&&!financeEntities.length)||(scope==="parties"&&!entities.length))
    return NextResponse.json({ok:false,error:"Forbidden"},{status:403,headers});
  return NextResponse.json({ok:true,data:{entities,financeEntities,multiEntityEnabled:financeMultiEntityActive()}},{headers});
 }catch(error){
  logOaFailure(stage,error,{reference});
  return NextResponse.json({ok:false,error:"Finance permissions temporarily unavailable",reference},{status:503,headers});
 }
}
