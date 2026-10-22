import { PasswordResetPanel } from "@/components/auth/password-reset-panel";
import { brandingUrl, getSystemSettings } from "@/lib/system-settings";

type ResetPasswordPageProps = {
  searchParams: Promise<{
    token?: string | string[];
    error?: string | string[];
  }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = first(params.token) ?? null;
  const error = first(params.error);
  const settings = await getSystemSettings();

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8 sm:px-6 lg:px-10">
      <PasswordResetPanel
        mode="reset"
        token={token}
        invalidToken={error === "INVALID_TOKEN"}
        systemName={settings.systemName}
        logoDarkUrl={brandingUrl(settings.logoDarkKey, settings.updatedAt)}
        logoLightUrl={brandingUrl(settings.logoLightKey, settings.updatedAt)}
      />
    </main>
  );
}
