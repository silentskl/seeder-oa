import type { ReactNode } from "react";
import { OaShell } from "@/components/oa/oa-shell";
import { isAdminTier, requireViewer } from "@/lib/auth-server";
import { one } from "@/lib/oa/db";
import {listFinanceAdminEntities} from "@/lib/oa/finance-entity";
import {isOaSuperAdmin,listPartyManagementEntities,listContractAccessEntities} from "@/lib/oa/admin-permissions";
import {navigationCheck} from "@/lib/oa/runtime-diagnostics";

export const dynamic = "force-dynamic";

export default async function OfficeLayout({children}:{children:ReactNode}) {
  // Authentication stays mandatory. Do not catch redirects or turn an auth
  // infrastructure error into an anonymous or privileged session.
  const viewer = await requireViewer();
  const reference=crypto.randomUUID();
  const superResult=await navigationCheck("layout.superadmin",()=>isOaSuperAdmin(viewer.id),false,reference);
  const superAdmin=superResult.value;
  const admin=isAdminTier(viewer.role)||superAdmin;
  // These checks control presentation only. Independent page/API authorization
  // remains authoritative and must never use a fallback as a grant.
  const [managed,finance,party,contract]=await Promise.all([
    navigationCheck("layout.manager",async()=>admin?false:Number((await one<{n:number}>(
      "SELECT COUNT(*) AS n FROM oa_employee WHERE manager_user_id=? AND active=1",[viewer.id]))?.n??0)>0,false,reference),
    navigationCheck("layout.billing",async()=>(await listFinanceAdminEntities(viewer.id)).length>0,false,reference),
    navigationCheck("layout.parties",async()=>(await listPartyManagementEntities(viewer.id)).length>0,false,reference),
    navigationCheck("layout.contracts",async()=>(await listContractAccessEntities(viewer.id)).length>0,false,reference),
  ]);
  const navigationWarning=[superResult,managed,finance,party,contract].some(result=>result.failed)?reference:undefined;
  return <OaShell userName={viewer.name} userEmail={viewer.email} isAdmin={admin} isManager={managed.value} isFinanceAdmin={finance.value} isPartyAdmin={party.value} isContractAdmin={contract.value} isSuperAdmin={superAdmin} navigationWarning={navigationWarning}>{children}</OaShell>;
}
