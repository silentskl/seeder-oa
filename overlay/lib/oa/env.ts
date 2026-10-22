import { getCloudflareContext } from "@opennextjs/cloudflare";

export function getOaEnv() {
  const { env } = getCloudflareContext();
  return { db: env.PM_DB, uploads: env.UPLOADS };
}
