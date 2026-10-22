import type { ReactNode } from "react";
import { OaShell } from "@/components/oa/oa-shell";
import { isAdminTier, requireViewer } from "@/lib/auth-server";
import { one } from "@/lib/oa/db";

export const dynamic = "force-dynamic";

export default async function OfficeLayout({children}:{children:ReactNode}) {
  const viewer = await requireViewer();
  const admin = isAdminTier(viewer.role);
  const managed = admin ? null : await one<{n:number}>(
    `SELECT COUNT(*) AS n FROM oa_employee WHERE manager_user_id=? AND active=1`,
    [viewer.id],
  );
  const isManager = Number(managed?.n ?? 0) > 0;
  return <OaShell userName={viewer.name} userEmail={viewer.email} isAdmin={admin} isManager={isManager}>{children}</OaShell>;
}
