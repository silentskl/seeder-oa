import {FinanceConsole} from "@/components/oa/finance-console";
import {requireViewer} from "@/lib/auth-server";
export const dynamic="force-dynamic";
export default async function Page(){
 // This shell contains no financial data. The scoped entities API determines
 // whether the authenticated viewer may load the ledger; all data and mutation
 // APIs independently require billing authorization. Avoid duplicate SSR D1 ACL.
 await requireViewer();
 return <FinanceConsole section="ledger"/>;
}
