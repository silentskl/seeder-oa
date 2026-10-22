import { getOaEnv } from "./env";

export async function one<T = Record<string, unknown>>(sql: string, binds: unknown[] = []): Promise<T | null> {
  const { db } = getOaEnv();
  const stmt = db.prepare(sql).bind(...binds);
  const row = await stmt.first<T>();
  return row ?? null;
}

export async function all<T = Record<string, unknown>>(sql: string, binds: unknown[] = []): Promise<T[]> {
  const { db } = getOaEnv();
  const result = await db.prepare(sql).bind(...binds).all<T>();
  return result.results ?? [];
}

export async function run(sql: string, binds: unknown[] = []) {
  const { db } = getOaEnv();
  return db.prepare(sql).bind(...binds).run();
}

export async function audit(actorUserId: string | null, action: string, entityType: string, entityId: string | null, details?: unknown) {
  await run(
    `INSERT INTO oa_audit_log (id, actor_user_id, action, entity_type, entity_id, details_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), actorUserId, action, entityType, entityId, details == null ? null : JSON.stringify(details)],
  );
}

export async function settings() {
  return one<{company_name:string;base_currency:string;fx_provider:string;default_annual_leave_days:number}>(
    `SELECT company_name, base_currency, fx_provider, default_annual_leave_days FROM oa_settings WHERE id=1`,
  );
}
