import { requireViewer } from "@/lib/auth-server";
import { OaConsole } from "@/components/oa/oa-console";

export default async function OfficePage() {
  await requireViewer();
  return <OaConsole />;
}
