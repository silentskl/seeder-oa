import {FinanceConsole} from "@/components/oa/finance-console";
import {requireViewer} from "@/lib/auth-server";
import {listFinanceAdminEntities} from "@/lib/oa/finance-entity";
export const dynamic="force-dynamic";
export default async function Page(){
 const viewer=await requireViewer();
 if(!(await listFinanceAdminEntities(viewer.id)).length)return <div className="p-6" role="alert">Billing permission required / 需要应收应付账单管理权限</div>;
 return <FinanceConsole section="ledger"/>;
}
