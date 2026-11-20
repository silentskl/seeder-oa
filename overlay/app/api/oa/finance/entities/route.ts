import {NextResponse} from "next/server";
import {getViewer} from "@/lib/auth-server";
import {listFinanceAdminEntities,financeMultiEntityActive} from "@/lib/oa/finance-entity";
import {listPartyManagementEntities} from "@/lib/oa/admin-permissions";
export const runtime="nodejs";
export async function GET(){
 const viewer=await getViewer();
 if(!viewer)return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
 const [financeEntities,entities]=await Promise.all([listFinanceAdminEntities(viewer.id),listPartyManagementEntities(viewer.id)]);
 return NextResponse.json({ok:true,data:{entities,financeEntities,multiEntityEnabled:financeMultiEntityActive()}});
}
