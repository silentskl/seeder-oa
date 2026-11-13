import { getCloudflareContext } from "@opennextjs/cloudflare";

export function getOaEnv() {
  const { env } = getCloudflareContext();
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
