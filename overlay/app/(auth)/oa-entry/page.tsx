import { redirect } from "next/navigation";
import { isAdminTier, requireViewer } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

export default async function OaEntryPage() {
  const viewer = await requireViewer();
  redirect(isAdminTier(viewer.role) ? "/admin/oa" : "/oa");
}
