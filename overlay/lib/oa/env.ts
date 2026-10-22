import { getCloudflareContext } from "@opennextjs/cloudflare";

export function getOaEnv() {
  const { env } = getCloudflareContext();
  const e = env as typeof env & {
    OA_SETTINGS_MASTER_KEY?: string;
    BETTER_AUTH_URL?: string;
  };
  return {
    db: e.PM_DB,
    uploads: e.UPLOADS,
    settingsMasterKey: e.OA_SETTINGS_MASTER_KEY || "",
    appUrl: e.BETTER_AUTH_URL || "",
  };
}
