import { getCloudflareContext } from "@opennextjs/cloudflare";

export function getOaEnv() {
  // Seeder upstream v2.1.0 already supports Node.js with local SQLite and uploads.
  // Do not invoke getCloudflareContext outside Workers (it throws on Ubuntu).
  const env = process.env.RUNTIME === "node"
    ? (()=>{
        // Match upstream lib/storage/index.ts lazy Node-only require pattern.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const adapters = require("./node-adapters") as typeof import("./node-adapters");
        return {
          PM_DB:adapters.nodeOaDb(),UPLOADS:adapters.nodeOaUploads(),
          OA_SETTINGS_MASTER_KEY:process.env.OA_SETTINGS_MASTER_KEY,
          BETTER_AUTH_URL:process.env.BETTER_AUTH_URL,
          OA_MULTI_ENTITY_BUSINESS_ENABLED:process.env.OA_MULTI_ENTITY_BUSINESS_ENABLED,
          OA_FINANCE_RESEND_API_KEY:process.env.OA_FINANCE_RESEND_API_KEY,
          OA_FINANCE_RESEND_WEBHOOK_SECRET:process.env.OA_FINANCE_RESEND_WEBHOOK_SECRET,
          OA_FINANCE_AI_API_KEY:process.env.OA_FINANCE_AI_API_KEY,
          OA_FINANCE_AI_MODEL:process.env.OA_FINANCE_AI_MODEL,
          OA_FINANCE_SYNC_TOKEN:process.env.OA_FINANCE_SYNC_TOKEN,
          OA_FINANCE_MULTI_ENTITY_ENABLED:process.env.OA_FINANCE_MULTI_ENTITY_ENABLED,
        } as unknown as ReturnType<typeof getCloudflareContext>["env"];
      })()
    : getCloudflareContext().env;
  const e = env as typeof env & {
    OA_SETTINGS_MASTER_KEY?: string;
    BETTER_AUTH_URL?: string;
    OA_MULTI_ENTITY_BUSINESS_ENABLED?: string;
    OA_FINANCE_RESEND_API_KEY?: string;
    OA_FINANCE_RESEND_WEBHOOK_SECRET?: string;
    OA_FINANCE_AI_API_KEY?: string;
    OA_FINANCE_AI_MODEL?: string;
    OA_FINANCE_SYNC_TOKEN?: string;
    OA_FINANCE_MULTI_ENTITY_ENABLED?: string;
  };
  return {
    db: e.PM_DB,
    uploads: e.UPLOADS,
    settingsMasterKey: e.OA_SETTINGS_MASTER_KEY || "",
    appUrl: e.BETTER_AUTH_URL || "",
    multiEntityBusinessEnabled: String(e.OA_MULTI_ENTITY_BUSINESS_ENABLED || "").toLowerCase() === "true",
    financeResendApiKey: e.OA_FINANCE_RESEND_API_KEY || "",
    financeResendWebhookSecret: e.OA_FINANCE_RESEND_WEBHOOK_SECRET || "",
    financeAiKey: e.OA_FINANCE_AI_API_KEY || "",
    financeAiModel: e.OA_FINANCE_AI_MODEL || "gpt-4.1-mini",
    financeSyncToken: e.OA_FINANCE_SYNC_TOKEN || "",
    financeMultiEntityEnabled: String(e.OA_FINANCE_MULTI_ENTITY_ENABLED || "").toLowerCase() === "true",
  };
}
