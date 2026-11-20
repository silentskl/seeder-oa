import type { ReactNode } from "react";
import { OaShell } from "@/components/oa/oa-shell";
import { isAdminTier, requireViewer } from "@/lib/auth-server";
import { one } from "@/lib/oa/db";
import {listFinanceAdminEntities} from "@/lib/oa/finance-entity";
import {isOaSuperAdmin,listPartyManagementEntities} from "@/lib/oa/admin-permissions";

export const dynamic = "force-dynamic";

export default async function OfficeLayout({children}:{children:ReactNode}) {
  const viewer = await requireViewer();
  const superAdmin=await isOaSuperAdmin(viewer.id);
  const admin = isAdminTier(viewer.role)||superAdmin;
  const managed = admin ? null : await one<{n:number}>(
    `SELECT COUNT(*) AS n FROM oa_employee WHERE manager_user_id=? AND active=1`,
    [viewer.id],
  );
  const isManager = Number(managed?.n ?? 0) > 0;
  const [financeEntities,partyEntities]=await Promise.all([listFinanceAdminEntities(viewer.id),listPartyManagementEntities(viewer.id)]);
  const isFinanceAdmin=financeEntities.length>0;
  const isPartyAdmin=partyEntities.length>0;
  return <OaShell userName={viewer.name} userEmail={viewer.email} isAdmin={admin} isManager={isManager} isFinanceAdmin={isFinanceAdmin} isPartyAdmin={isPartyAdmin} isSuperAdmin={superAdmin}>{children}</OaShell>;
}
