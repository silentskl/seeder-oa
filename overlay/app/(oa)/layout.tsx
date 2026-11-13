import type { ReactNode } from "react";
import { OaShell } from "@/components/oa/oa-shell";
import { isAdminTier, requireViewer } from "@/lib/auth-server";
import { one } from "@/lib/oa/db";
import {listFinanceAdminEntities} from "@/lib/oa/finance-entity";

export const dynamic = "force-dynamic";

export default async function OfficeLayout({children}:{children:ReactNode}) {
  const viewer = await requireViewer();
  const admin = isAdminTier(viewer.role);
  const managed = admin ? null : await one<{n:number}>(
    `SELECT COUNT(*) AS n FROM oa_employee WHERE manager_user_id=? AND active=1`,
    [viewer.id],
  );
  const isManager = Number(managed?.n ?? 0) > 0;
  const isFinanceAdmin=(await listFinanceAdminEntities(viewer.id)).length>0;
  return <OaShell userName={viewer.name} userEmail={viewer.email} isAdmin={admin} isManager={isManager} isFinanceAdmin={isFinanceAdmin}>{children}</OaShell>;
}
