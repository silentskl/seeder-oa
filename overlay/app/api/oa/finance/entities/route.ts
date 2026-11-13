import {NextResponse} from "next/server";
import {getViewer} from "@/lib/auth-server";
import {listFinanceAdminEntities,financeMultiEntityActive} from "@/lib/oa/finance-entity";
export const runtime="nodejs";
export async function GET(){
 const viewer=await getViewer();
 if(!viewer)return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
 const entities=await listFinanceAdminEntities(viewer.id);
 return NextResponse.json({ok:true,data:{entities,multiEntityEnabled:financeMultiEntityActive()}});
}
