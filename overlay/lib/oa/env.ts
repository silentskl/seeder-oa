import {getCloudflareContext} from "@opennextjs/cloudflare";

/**
 * In node mode Seeder's own getDb()/getStorage() already use a local SQLite
 * file and filesystem. Expose a minimal D1/R2-compatible facade to the OA
 * overlay so every existing OA route continues to work without Cloudflare.
 *
 * Do not request a CloudflareContext when RUNTIME=node: it is unavailable
 * outside Workers. The Cloudflare branch remains unchanged.
 */
function bindings(){
 if(process.env.RUNTIME==="node"){
  // Lazy import keeps @libsql/client, node:fs and native modules out of the
  // Cloudflare bundle. Next/Webpack resolves this local module in node mode.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {getNodeBindings}=require("./node-bindings") as typeof import("./node-bindings");
  const native=getNodeBindings();
  return {
   ...process.env,
   PM_DB:native.db as unknown as CloudflareEnv["PM_DB"],
   UPLOADS:native.uploads as unknown as CloudflareEnv["UPLOADS"]
  };
 }
 return getCloudflareContext().env;
}
export function getOaEnv(){
 const e=bindings() as CloudflareEnv & NodeJS.ProcessEnv & {
  OA_SETTINGS_MASTER_KEY?:string;
  BETTER_AUTH_URL?:string;
  OA_MULTI_ENTITY_BUSINESS_ENABLED?:string;
  OA_FINANCE_RESEND_API_KEY?:string;
  OA_FINANCE_RESEND_WEBHOOK_SECRET?:string;
  OA_FINANCE_AI_API_KEY?:string;
  OA_FINANCE_AI_MODEL?:string;
  OA_FINANCE_SYNC_TOKEN?:string;
  OA_FINANCE_MULTI_ENTITY_ENABLED?:string;
 };
 return {
  db:e.PM_DB,
  uploads:e.UPLOADS,
  settingsMasterKey:e.OA_SETTINGS_MASTER_KEY||"",
  appUrl:e.BETTER_AUTH_URL||"",
  multiEntityBusinessEnabled:String(e.OA_MULTI_ENTITY_BUSINESS_ENABLED||"").toLowerCase()==="true",
  financeResendApiKey:e.OA_FINANCE_RESEND_API_KEY||"",
  financeResendWebhookSecret:e.OA_FINANCE_RESEND_WEBHOOK_SECRET||"",
  financeAiKey:e.OA_FINANCE_AI_API_KEY||"",
  financeAiModel:e.OA_FINANCE_AI_MODEL||"gpt-4.1-mini",
  financeSyncToken:e.OA_FINANCE_SYNC_TOKEN||"",
  financeMultiEntityEnabled:String(e.OA_FINANCE_MULTI_ENTITY_ENABLED||"").toLowerCase()==="true"
 };
}
