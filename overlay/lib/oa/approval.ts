import { all, one, run, settings } from "./db";
import { LEGACY_ENTITY_ID } from "./entity";

export type ApprovalEntity = "leave" | "expense";
export type ApprovalFlow = "manager" | "manager_admin" | "admin";
export type ApprovalStep = {
  id: string;
  entity_type: ApprovalEntity;
  entity_id: string;
  step_no: number;
  approver_type: "manager" | "admin";
  assigned_user_id: string | null;
  status: "waiting" | "pending" | "approved" | "rejected" | "skipped";
  decided_at: string | null;
  decided_by: string | null;
  note: string | null;
  created_at: string;
};

export function normalizeApprovalFlow(value: unknown): ApprovalFlow {
  const flow = String(value ?? "manager_admin");
  if (flow === "manager" || flow === "manager_admin" || flow === "admin") return flow;
  throw new Error("Invalid approval flow");
}

export function approvalFlowLabel(flow: ApprovalFlow) {
  if (flow === "manager") return "Manager only";
  if (flow === "admin") return "Admin only";
  return "Manager → Admin";
}

async function employeeManager(userId: string, companyId = LEGACY_ENTITY_ID) {
  const row = await one<{ manager_user_id: string | null }>(
    `SELECT manager_user_id FROM oa_employee WHERE user_id=? AND entity_id=?`,
    [userId,companyId],
  );
  return row?.manager_user_id || null;
}

export async function createApprovalWorkflow(entityType: ApprovalEntity, entityId: string, employeeUserId: string, companyId = LEGACY_ENTITY_ID) {
  const sourceTable = entityType === "leave" ? "oa_leave_request" : "oa_expense_claim";
  const owned=await one<{user_id:string}>(`SELECT user_id FROM ${sourceTable} WHERE id=? AND entity_id=?`,[entityId,companyId]);
  if(!owned || owned.user_id!==employeeUserId) throw new Error("Approval source not found in Entity");
  const existing = await one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM oa_approval_step WHERE entity_type=? AND entity_id=? AND company_entity_id=?`,
    [entityType, entityId,companyId],
  );
  if (Number(existing?.n ?? 0) > 0) return getApprovalSteps(entityType, entityId,companyId);

  const s = await settings();
  const flow = normalizeApprovalFlow(
    entityType === "leave" ? s?.leave_approval_flow : s?.expense_approval_flow,
  );
  const managerId = await employeeManager(employeeUserId,companyId);

  const spec: Array<{ approverType: "manager" | "admin"; assignedUserId: string | null }> = [];
  if (flow === "admin") {
    spec.push({ approverType: "admin", assignedUserId: null });
  } else if (flow === "manager") {
    // Employees without a configured manager fall back to Admin so requests
    // never become permanently unapprovable.
    spec.push(managerId
      ? { approverType: "manager", assignedUserId: managerId }
      : { approverType: "admin", assignedUserId: null });
  } else {
    if (managerId) spec.push({ approverType: "manager", assignedUserId: managerId });
    spec.push({ approverType: "admin", assignedUserId: null });
  }

  for (let i = 0; i < spec.length; i += 1) {
    const step = spec[i];
    await run(
      `INSERT OR IGNORE INTO oa_approval_step
       (id,entity_type,entity_id,step_no,approver_type,assigned_user_id,status,company_entity_id)
       VALUES(?,?,?,?,?,?,?,?)`,
      [
        crypto.randomUUID(), entityType, entityId, i + 1, step.approverType,
        step.assignedUserId, i === 0 ? "pending" : "waiting",companyId,
      ],
    );
  }
  return getApprovalSteps(entityType, entityId,companyId);
}

export async function ensureSubmittedWorkflows(companyId = LEGACY_ENTITY_ID) {
  const leaves = await all<{ id: string; user_id: string }>(
    `SELECT l.id,l.user_id FROM oa_leave_request l
     LEFT JOIN oa_approval_step s ON s.entity_type='leave' AND s.entity_id=l.id AND s.company_entity_id=l.entity_id
     WHERE l.status='submitted' AND l.entity_id=?
     GROUP BY l.id,l.user_id HAVING COUNT(s.id)=0`,[companyId],
  );
  for (const row of leaves) await createApprovalWorkflow("leave", row.id, row.user_id,companyId);

  const expenses = await all<{ id: string; user_id: string }>(
    `SELECT x.id,x.user_id FROM oa_expense_claim x
     LEFT JOIN oa_approval_step s ON s.entity_type='expense' AND s.entity_id=x.id AND s.company_entity_id=x.entity_id
     WHERE x.status='submitted' AND x.entity_id=?
     GROUP BY x.id,x.user_id HAVING COUNT(s.id)=0`,[companyId],
  );
  for (const row of expenses) await createApprovalWorkflow("expense", row.id, row.user_id,companyId);
}

export async function getApprovalSteps(entityType: ApprovalEntity, entityId: string, companyId = LEGACY_ENTITY_ID) {
  return all<ApprovalStep>(
    `SELECT * FROM oa_approval_step WHERE entity_type=? AND entity_id=? AND company_entity_id=? ORDER BY step_no`,
    [entityType, entityId,companyId],
  );
}

export async function getPendingStep(entityType: ApprovalEntity, entityId: string, companyId = LEGACY_ENTITY_ID) {
  return one<ApprovalStep>(
    `SELECT * FROM oa_approval_step
     WHERE entity_type=? AND entity_id=? AND company_entity_id=? AND status='pending'
     ORDER BY step_no LIMIT 1`,
    [entityType, entityId,companyId],
  );
}

export function canActOnStep(step: ApprovalStep, actorUserId: string, isAdmin: boolean) {
  if (step.approver_type === "admin") return isAdmin;
  // Admins retain an override ability for manager steps. The audit trail and
  // step history make such overrides explicit.
  return step.assigned_user_id === actorUserId || isAdmin;
}

export async function approveCurrentStep(entityType: ApprovalEntity, entityId: string, actorUserId: string, note?: string | null, companyId = LEGACY_ENTITY_ID) {
  const step = await getPendingStep(entityType, entityId,companyId);
  if (!step) throw new Error("NO_PENDING_STEP");
  await run(
    `UPDATE oa_approval_step
     SET status='approved',decided_at=CURRENT_TIMESTAMP,decided_by=?,note=?
     WHERE id=? AND company_entity_id=? AND status='pending'`,
    [actorUserId, note || null, step.id,companyId],
  );
  const next = await one<ApprovalStep>(
    `SELECT * FROM oa_approval_step
     WHERE entity_type=? AND entity_id=? AND company_entity_id=? AND status='waiting'
     ORDER BY step_no LIMIT 1`,
    [entityType, entityId,companyId],
  );
  if (next) {
    await run(`UPDATE oa_approval_step SET status='pending' WHERE id=? AND company_entity_id=? AND status='waiting'`, [next.id,companyId]);
    return { complete: false, approvedStep: step, nextStep: { ...next, status: "pending" as const } };
  }
  return { complete: true, approvedStep: step, nextStep: null };
}

export async function rejectCurrentStep(entityType: ApprovalEntity, entityId: string, actorUserId: string, note?: string | null, companyId = LEGACY_ENTITY_ID) {
  const step = await getPendingStep(entityType, entityId,companyId);
  if (!step) throw new Error("NO_PENDING_STEP");
  await run(
    `UPDATE oa_approval_step
     SET status='rejected',decided_at=CURRENT_TIMESTAMP,decided_by=?,note=?
     WHERE id=? AND company_entity_id=? AND status='pending'`,
    [actorUserId, note || null, step.id,companyId],
  );
  await run(
    `UPDATE oa_approval_step SET status='skipped'
     WHERE entity_type=? AND entity_id=? AND company_entity_id=? AND status='waiting'`,
    [entityType, entityId,companyId],
  );
  return step;
}

export async function cancelApprovalWorkflow(entityType: ApprovalEntity, entityId: string, companyId = LEGACY_ENTITY_ID) {
  await run(
    `UPDATE oa_approval_step SET status='skipped'
     WHERE entity_type=? AND entity_id=? AND company_entity_id=? AND status IN ('waiting','pending')`,
    [entityType, entityId,companyId],
  );
}
