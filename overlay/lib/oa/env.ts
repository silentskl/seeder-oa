import { getCloudflareContext } from "@opennextjs/cloudflare";

export function getOaEnv() {
  const { env } = getCloudflareContext();
  const e = env as typeof env & {
    OA_SETTINGS_MASTER_KEY?: string;
    BETTER_AUTH_URL?: string;
    OA_MULTI_ENTITY_BUSINESS_ENABLED?: string;
  };
  return {
    db: e.PM_DB,
    uploads: e.UPLOADS,
    settingsMasterKey: e.OA_SETTINGS_MASTER_KEY || "",
    appUrl: e.BETTER_AUTH_URL || "",
    multiEntityBusinessEnabled: String(e.OA_MULTI_ENTITY_BUSINESS_ENABLED || "").toLowerCase() === "true",
  };
}
