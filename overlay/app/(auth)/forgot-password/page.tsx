import { redirect } from "next/navigation";

import { PasswordResetPanel } from "@/components/auth/password-reset-panel";
import { getViewer } from "@/lib/auth-server";
import { brandingUrl, getSystemSettings } from "@/lib/system-settings";

export default async function ForgotPasswordPage() {
  const viewer = await getViewer();
  if (viewer) redirect("/oa-entry");

  const settings = await getSystemSettings();

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8 sm:px-6 lg:px-10">
      <PasswordResetPanel
        mode="request"
        systemName={settings.systemName}
        logoDarkUrl={brandingUrl(settings.logoDarkKey, settings.updatedAt)}
        logoLightUrl={brandingUrl(settings.logoLightKey, settings.updatedAt)}
      />
    </main>
  );
}
