import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/auth-server";
import { all, audit, one, run, settings } from "@/lib/oa/db";
import { getFxQuote } from "@/lib/oa/fx";
import { getOaEnv } from "@/lib/oa/env";
import { EntityAccessError, LEGACY_ENTITY_ID, requireLegacyOaAccess } from "@/lib/oa/entity";
import { businessDays } from "@/lib/oa/leave";
import { COMMON_CURRENCIES, convertMinor, formatMoney, majorToMinor, normalizeCurrency } from "@/lib/oa/money";
import { approveCurrentStep, cancelApprovalWorkflow, canActOnStep, createApprovalWorkflow, ensureSubmittedWorkflows, getApprovalSteps, getPendingStep, normalizeApprovalFlow, rejectCurrentStep } from "@/lib/oa/approval";
import { encryptEmailSecret, notifyDecision, notifySubmitted, publicEmailSettings, sendTestEmail } from "@/lib/oa/email";

export const runtime = "nodejs";

function ok(data: unknown, status = 200) { return NextResponse.json({ ok: true, data }, { status }); }
function fail(message: string, status = 400) { return NextResponse.json({ ok: false, error: message }, { status }); }
function text(value: unknown, max = 5000) { return String(value ?? "").trim().slice(0, max); }
function date(value: unknown) {
  const v = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("Invalid date");
  return v;
}
function optionalDate(value: unknown) {
  const v = text(value, 10);
  return v ? date(v) : null;
}
function emailAddress(value: unknown, required = false) {
  const v = text(value, 320);
  if (!v) { if (required) throw new Error("Email address is required"); return null; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error("Invalid email address");
  return v;
}

const MEDICAL_INSURANCE_CATEGORY = "Medical Insurance";
const EXPENSE_CATEGORIES = ["Travel","Meals","Transport","Accommodation","Office","Telecom","Client entertainment",MEDICAL_INSURANCE_CATEGORY,"Other"] as const;

async function activeExpenseCategories():Promise<string[]> {
  try {
    const rows=await all<{name:string}>(`SELECT name FROM oa_entity_expense_category WHERE entity_id='legacy-primary' AND active=1 ORDER BY sort_order,name`);
    return rows.map(r=>r.name);
  } catch(error) {
    // Older production D1 may not yet have migration 9009. Keep OA accessible until migration succeeds.
    const message=error instanceof Error?error.message:String(error);
    if (/no such table:\\s*oa_entity_expense_category/i.test(message)) return [...EXPENSE_CATEGORIES];
    throw error;
  }
}
async function expenseCategory(value: unknown) {
  const raw=text(value,100);
  const categories=await activeExpenseCategories();
  const match=categories.find(x=>x.toLowerCase()===raw.toLowerCase());
  if(!match)throw new Error("Invalid or inactive expense category");
  return match;
}

function expenseYear(value: string) {
  const year = Number(value.slice(0, 4));
  if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new Error("Invalid expense year");
  return year;
}

async function requireOaViewer() {
  const viewer = await getViewer();
  if (!viewer) throw new Error("UNAUTHORIZED");
  return viewer;
}

async function ensureEmployee(userId: string) {
  const s = await settings();
  await run(
    `INSERT OR IGNORE INTO oa_employee(user_id,annual_leave_days,payroll_currency,reimbursement_currency,entity_id)
     VALUES(?,?,?,?,?)`,
    [userId, Number(s?.default_annual_leave_days ?? 14), s?.base_currency ?? "SGD", s?.base_currency ?? "SGD",LEGACY_ENTITY_ID],
  );
  return one<any>(`SELECT * FROM oa_entity_employee WHERE user_id=? AND entity_id=?`, [userId,LEGACY_ENTITY_ID]);
}

async function leaveSummary(userId: string) {
  const employee = await ensureEmployee(userId);
  const year = new Date().getUTCFullYear();
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const approved = await one<{days:number|null}>(
    `SELECT SUM(l.business_days) AS days FROM oa_leave_request l
     JOIN oa_entity_leave_type t ON t.code=l.leave_type_code AND t.entity_id=l.entity_id
     WHERE l.entity_id='legacy-primary' AND l.user_id=? AND l.status='approved' AND t.deducts_annual=1 AND l.start_date BETWEEN ? AND ?`,
    [userId, from, to],
  );
  const pending = await one<{days:number|null}>(
    `SELECT SUM(l.business_days) AS days FROM oa_leave_request l
     JOIN oa_entity_leave_type t ON t.code=l.leave_type_code AND t.entity_id=l.entity_id
     WHERE l.entity_id='legacy-primary' AND l.user_id=? AND l.status='submitted' AND t.deducts_annual=1 AND l.start_date BETWEEN ? AND ?`,
    [userId, from, to],
  );
  const entitlement = Number(employee?.annual_leave_days ?? 0);
  const used = Number(approved?.days ?? 0);
  const pendingDays = Number(pending?.days ?? 0);
  return { year, entitlement, used, pending: pendingDays, available: Math.max(0, entitlement - used - pendingDays) };
}

async function medicalClaimAmountInCurrency(row: any, currency: string) {
  const target = normalizeCurrency(currency);
  const snapCurrency = row.medical_insurance_currency ? normalizeCurrency(row.medical_insurance_currency) : null;
  const snapMinor = row.medical_insurance_amount_minor == null ? null : Number(row.medical_insurance_amount_minor);
  if (snapCurrency === target && snapMinor != null && Number.isSafeInteger(snapMinor) && snapMinor >= 0) return snapMinor;
  const originalCurrency = normalizeCurrency(row.original_currency);
  const originalMinor = Number(row.original_amount_minor || 0);
  if (originalCurrency === target) return originalMinor;
  const fx = await getFxQuote(originalCurrency, target, row.expense_date);
  return convertMinor(originalMinor, originalCurrency, target, fx.rate);
}

async function medicalInsuranceSummary(userId: string, yearInput?: number) {
  const employee = await ensureEmployee(userId);
  const year = yearInput ?? new Date().getUTCFullYear();
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const currency = normalizeCurrency(employee?.payroll_currency || "SGD");
  const rows = await all<any>(
    `SELECT id,expense_date,status,original_amount_minor,original_currency,
            medical_insurance_amount_minor,medical_insurance_currency
     FROM oa_expense_claim
     WHERE entity_id='legacy-primary' AND user_id=? AND category=? AND expense_date BETWEEN ? AND ?
       AND status IN ('submitted','approved','paid')`,
    [userId, MEDICAL_INSURANCE_CATEGORY, from, to],
  );
  let reimbursedMinor = 0;
  let pendingMinor = 0;
  for (const row of rows) {
    const amountMinor = await medicalClaimAmountInCurrency(row, currency);
    if (row.status === "paid") reimbursedMinor += amountMinor;
    else pendingMinor += amountMinor;
  }
  const entitlementMinor = Math.max(0, Number(employee?.medical_insurance_limit_minor ?? 0));
  const committedMinor = reimbursedMinor + pendingMinor;
  return {
    year,
    currency,
    entitlementMinor,
    reimbursedMinor,
    pendingMinor,
    availableMinor: Math.max(0, entitlementMinor - committedMinor),
    overLimitMinor: Math.max(0, committedMinor - entitlementMinor),
  };
}

async function expenseCategorySummary(userId: string, yearInput?: number) {
  const employee = await ensureEmployee(userId);
  const payrollCurrency = normalizeCurrency(employee?.payroll_currency || "SGD");
  const year = yearInput ?? new Date().getUTCFullYear();
  const from = `${year}-01-01`, to = `${year}-12-31`;
  // Group at item granularity, not at the claim header. This preserves accurate
  // category reporting for a claim containing multiple expense categories.
  const claims = await all<any>(
    `SELECT c.id,c.category,c.status,c.expense_date,c.original_amount_minor,c.original_currency,
            c.reimbursement_amount_minor,c.reimbursement_currency,
            c.medical_insurance_amount_minor,c.medical_insurance_currency,
            i.id AS item_id,i.category AS item_category,i.expense_date AS item_date,
            i.reimbursement_amount_minor AS item_amount_minor
     FROM oa_expense_claim c
     LEFT JOIN oa_expense_item i ON i.claim_id=c.id
     WHERE c.entity_id='legacy-primary' AND c.user_id=? AND c.status IN ('submitted','approved','paid')
       AND (i.expense_date BETWEEN ? AND ? OR (i.id IS NULL AND c.expense_date BETWEEN ? AND ?))
     ORDER BY c.id,i.sort_order`,
    [userId, from, to, from, to],
  );
  const grouped = new Map<string,{category:string;reimbursement_currency:string;reimbursed_minor:number;pending_minor:number;claim_count:number}>();
  const seen = new Set<string>();
  for (const claim of claims) {
    const category = String(claim.item_category || claim.category || "Other");
    const currency = category === MEDICAL_INSURANCE_CATEGORY ? payrollCurrency : normalizeCurrency(claim.reimbursement_currency);
    const amountMinor = claim.item_id != null
      ? Number(claim.item_amount_minor || 0)
      : category === MEDICAL_INSURANCE_CATEGORY
        ? await medicalClaimAmountInCurrency(claim, payrollCurrency)
        : Number(claim.reimbursement_amount_minor || 0);
    const key = `${category}::${currency}`;
    const row = grouped.get(key) || { category, reimbursement_currency: currency, reimbursed_minor: 0, pending_minor: 0, claim_count: 0 };
    if (claim.status === "paid") row.reimbursed_minor += amountMinor;
    else row.pending_minor += amountMinor;
    const unique = `${key}::${claim.id}`;
    if (!seen.has(unique)) { row.claim_count += 1; seen.add(unique); }
    grouped.set(key, row);
  }
  return { year, rows: Array.from(grouped.values()).sort((a,b)=>a.category.localeCompare(b.category)||a.reimbursement_currency.localeCompare(b.reimbursement_currency)) };
}

async function withExpenseItems<T extends Record<string,unknown>>(claims:T[]):Promise<(T & {items:any[]})[]> {
  if (!claims.length) return [];
  const ids=claims.map(c=>String(c.id));
  const placeholders=ids.map(()=>"?").join(",");
  const items=await all<any>(`SELECT i.*,d.file_id,f.original_name AS document_name
    FROM oa_expense_item i
    LEFT JOIN oa_expense_item_document d ON d.item_id=i.id
    LEFT JOIN oa_file f ON f.id=d.file_id
    WHERE i.entity_id='legacy-primary' AND i.claim_id IN (${placeholders}) ORDER BY i.claim_id,i.sort_order,i.id`,ids);
  const grouped=new Map<string,any[]>();
  for(const row of items){
    const bucket=grouped.get(row.claim_id)||[];
    let item=bucket.find(x=>x.id===row.id);
    if(!item){item={...row,documents:[]};delete item.file_id;delete item.document_name;bucket.push(item);}
    if(row.file_id && !item.documents.some((d:any)=>d.id===row.file_id)) item.documents.push({id:row.file_id,name:row.document_name});
    grouped.set(row.claim_id,bucket);
  }
  return claims.map(c=>({...c,items:grouped.get(String(c.id))||[]}));
}

export async function GET(request: NextRequest) {
  try {
    const viewer = await requireOaViewer();
    const access=await requireLegacyOaAccess(viewer.id, request.nextUrl.searchParams.get("entity_id"));
    const admin = access.role==="admin";
    const resource = request.nextUrl.searchParams.get("resource") || "bootstrap";
    await ensureEmployee(viewer.id);

    if (resource === "bootstrap") {
      const employee = await one<any>(
        `SELECT e.*, u.name, u.email, m.name AS manager_name
         FROM oa_entity_employee e JOIN user u ON u.id=e.user_id
         LEFT JOIN user m ON m.id=e.manager_user_id WHERE e.user_id=? AND e.entity_id=?`, [viewer.id,LEGACY_ENTITY_ID],
      );
      const s = await settings();
      const managed = await one<{n:number}>(`SELECT COUNT(*) AS n FROM oa_employee WHERE manager_user_id=? AND entity_id=? AND active=1`, [viewer.id,LEGACY_ENTITY_ID]);
      return ok({ viewer, admin, isManager: Number(managed?.n ?? 0) > 0, employee, leaveSummary: await leaveSummary(viewer.id), medicalInsuranceSummary: await medicalInsuranceSummary(viewer.id), settings: s, currencies: COMMON_CURRENCIES, expenseCategories: await activeExpenseCategories() });
    }

    if (resource === "leave") {
      return ok({
        summary: await leaveSummary(viewer.id),
        types: await all(`SELECT * FROM oa_entity_leave_type WHERE entity_id='legacy-primary' AND active=1 ORDER BY sort_order,name`),
        requests: await all(
          `SELECT l.*, t.name AS leave_type_name, f.original_name AS attachment_name
           FROM oa_leave_request l JOIN oa_entity_leave_type t ON t.code=l.leave_type_code AND t.entity_id=l.entity_id
           LEFT JOIN oa_file f ON f.id=l.attachment_file_id
           WHERE l.entity_id='legacy-primary' AND l.user_id=? ORDER BY l.submitted_at DESC LIMIT 100`, [viewer.id],
        ),
        approvalSteps: await all(
          `SELECT s.*,du.name AS decided_by_name,au.name AS assigned_user_name
           FROM oa_approval_step s
           LEFT JOIN user du ON du.id=s.decided_by
           LEFT JOIN user au ON au.id=s.assigned_user_id
           WHERE s.company_entity_id='legacy-primary' AND s.entity_type='leave' AND s.entity_id IN (SELECT id FROM oa_leave_request WHERE entity_id='legacy-primary' AND user_id=?)
           ORDER BY s.entity_id,s.step_no`, [viewer.id],
        ),
      });
    }

    if (resource === "expenseCategories") {
      if (!admin) return fail("Forbidden",403);
      return ok(await all<{name:string;active:number;sort_order:number}>(`SELECT name,active,sort_order FROM oa_entity_expense_category WHERE entity_id='legacy-primary' ORDER BY sort_order,name`));
    }

    if (resource === "expenses") {
      return ok({
        claims: await withExpenseItems(await all(
          `SELECT e.*, f.original_name AS receipt_name FROM oa_expense_claim e
           LEFT JOIN oa_file f ON f.id=e.receipt_file_id
           WHERE e.entity_id='legacy-primary' AND e.user_id=? ORDER BY e.submitted_at DESC LIMIT 100`, [viewer.id],
        )),
        approvalSteps: await all(
          `SELECT s.*,du.name AS decided_by_name,au.name AS assigned_user_name
           FROM oa_approval_step s
           LEFT JOIN user du ON du.id=s.decided_by
           LEFT JOIN user au ON au.id=s.assigned_user_id
           WHERE s.company_entity_id='legacy-primary' AND s.entity_type='expense' AND s.entity_id IN (SELECT id FROM oa_expense_claim WHERE entity_id='legacy-primary' AND user_id=?)
           ORDER BY s.entity_id,s.step_no`, [viewer.id],
        ),
        medicalInsuranceSummary: await medicalInsuranceSummary(viewer.id),
        categorySummary: await expenseCategorySummary(viewer.id),
        categories: await activeExpenseCategories(),
      });
    }

    if (resource === "payslips") {
      return ok(await all(
        `SELECT p.*, f.original_name AS attachment_name,u.name AS current_name,
                e.employee_no AS current_employee_no,e.join_date AS current_join_date
         FROM oa_payslip p JOIN user u ON u.id=p.user_id
         LEFT JOIN oa_employee e ON e.user_id=p.user_id
         LEFT JOIN oa_file f ON f.id=p.attachment_file_id
         WHERE p.entity_id='legacy-primary' AND p.user_id=? AND p.status='published' ORDER BY p.pay_date DESC LIMIT 100`, [viewer.id],
      ));
    }

    if (resource === "approvals") {
      await ensureSubmittedWorkflows();
      const stepFilter = admin
        ? `s.status='pending'`
        : `s.status='pending' AND s.approver_type='manager' AND s.assigned_user_id=?`;
      const params = admin ? [] : [viewer.id];
      return ok({
        leave: await all(
          `SELECT l.*,u.name,u.email,t.name AS leave_type_name,s.step_no,s.approver_type,s.assigned_user_id
           FROM oa_approval_step s
           JOIN oa_leave_request l ON l.id=s.entity_id AND s.entity_type='leave'
           JOIN user u ON u.id=l.user_id JOIN oa_entity_leave_type t ON t.code=l.leave_type_code AND t.entity_id=l.entity_id
           WHERE ${stepFilter} AND s.company_entity_id='legacy-primary' AND l.entity_id='legacy-primary' AND l.status='submitted' ORDER BY l.submitted_at`, params),
        expenses: await withExpenseItems(await all(
          `SELECT x.*,u.name,u.email,s.step_no,s.approver_type,s.assigned_user_id
           FROM oa_approval_step s
           JOIN oa_expense_claim x ON x.id=s.entity_id AND s.entity_type='expense'
           JOIN user u ON u.id=x.user_id
           WHERE ${stepFilter} AND s.company_entity_id='legacy-primary' AND x.entity_id='legacy-primary' AND x.status='submitted' ORDER BY x.submitted_at`, params)),
        approvedExpenses: admin ? await withExpenseItems(await all(
          `SELECT x.*,u.name,u.email FROM oa_expense_claim x JOIN user u ON u.id=x.user_id
           WHERE x.entity_id='legacy-primary' AND x.status='approved' ORDER BY x.decided_at,x.submitted_at`)) : [],
        expenseCategories: await activeExpenseCategories(),
        settings: await settings(),
      });
    }

    if (resource === "expenseHistory") {
      if (!admin) return fail("Forbidden",403);
      const query=request.nextUrl.searchParams;
      const page=Math.max(1,Math.min(100000,Number(query.get("page")||1)||1));
      const pageSize=25;
      const userId=text(query.get("userId")||"",100);
      const from=text(query.get("from")||"",10);
      const to=text(query.get("to")||"",10);
      if ((from&&!/^\d{4}-\d{2}-\d{2}$/.test(from))||(to&&!/^\d{4}-\d{2}-\d{2}$/.test(to)))return fail("Invalid date",400);
      const where=["x.entity_id='legacy-primary'"],params:any[]=[];
      if(userId&&userId!=="ALL"){where.push("x.user_id=?");params.push(userId);}
      if(from){where.push("x.expense_date>=?");params.push(from);}
      if(to){where.push("x.expense_date<=?");params.push(to);}
      const filter=where.join(" AND ");
      const totals=await all<{category:string;currency:string;minor:number;count:number}>(`
        SELECT COALESCE(NULLIF(x.category,''),'Uncategorized') AS category,
               COALESCE(NULLIF(x.reimbursement_currency,''),'SGD') AS currency,
               SUM(COALESCE(x.reimbursement_amount_minor,0)) AS minor,
               COUNT(*) AS count
        FROM oa_expense_claim x WHERE ${filter}
        GROUP BY category,currency ORDER BY category,currency`,params);
      const count=await one<{total:number}>(`SELECT COUNT(*) AS total FROM oa_expense_claim x WHERE ${filter}`,params);
      const records=await all(`SELECT x.id,x.user_id,x.category,x.status,x.expense_date,x.description,
         x.reimbursement_amount_minor,x.reimbursement_currency,u.name,u.email
         FROM oa_expense_claim x JOIN user u ON u.id=x.user_id
         WHERE ${filter} ORDER BY x.expense_date DESC,x.id DESC LIMIT ? OFFSET ?`,
         [...params,pageSize,(page-1)*pageSize]);
      return ok({records,totals,total:Number(count?.total||0),page,pageSize});
    }

    if (resource === "employees") {
      if (!admin) return fail("Forbidden", 403);
      return ok(await all(
        `SELECT u.id,u.name,u.email,u.role,e.employee_no,e.department,e.job_title,e.manager_user_id,
                e.join_date,e.annual_leave_days,e.medical_insurance_limit_minor,e.payroll_currency,e.reimbursement_currency,e.active,
                e.legal_name,e.personal_email,e.phone,e.address,e.nationality,e.date_of_birth,
                e.employment_type,e.work_location,e.base_salary_minor,e.salary_period,e.salary_effective_date,
                m.name AS manager_name
         FROM oa_entity_member em JOIN user u ON u.id=em.user_id LEFT JOIN oa_entity_employee e ON e.user_id=u.id AND e.entity_id=em.entity_id LEFT JOIN user m ON m.id=e.manager_user_id
         WHERE u.id <> 'vcs-bot' AND em.entity_id='legacy-primary' AND em.active=1
         ORDER BY COALESCE(e.active,1) DESC,u.name,u.email`,
      ));
    }

    if (resource === "admin-payslips") {
      if (!admin) return fail("Forbidden", 403);
      return ok(await all(
        `SELECT p.*,u.name,u.email,e.employee_no AS current_employee_no,e.join_date AS current_join_date,f.original_name AS attachment_name FROM oa_payslip p
         JOIN user u ON u.id=p.user_id LEFT JOIN oa_entity_employee e ON e.user_id=p.user_id AND e.entity_id=p.entity_id LEFT JOIN oa_file f ON f.id=p.attachment_file_id
         WHERE p.entity_id='legacy-primary' ORDER BY p.pay_date DESC,p.created_at DESC LIMIT 200`,
      ));
    }

    if (resource === "settings") {
      if (!admin) return fail("Forbidden", 403);
      return ok({
        settings: await settings(),
        email: await publicEmailSettings(),
        holidays: await all(`SELECT * FROM oa_entity_holiday WHERE entity_id='legacy-primary' ORDER BY holiday_date DESC LIMIT 300`),
        fxCache: await all(`SELECT * FROM oa_fx_rate ORDER BY fetched_at DESC LIMIT 30`),
        emailLog: await all(`SELECT id,event_key,entity_type,entity_id,recipient_email,subject,provider,status,error,created_at FROM oa_email_log WHERE company_entity_id='legacy-primary' ORDER BY created_at DESC LIMIT 50`),
      });
    }

    return fail("Unknown resource", 404);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return fail("Unauthorized", 401);
    if (error instanceof EntityAccessError) return fail(error.message,error.status);
    console.error("OA GET failed", error);
    return fail(error instanceof Error ? error.message : "OA request failed", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const viewer = await requireOaViewer();
    const body = await request.json() as Record<string, any>;
    const access=await requireLegacyOaAccess(viewer.id, body.entity_id ?? body.entityId);
    const admin = access.role==="admin";
    const action = text(body.action, 80);
    await ensureEmployee(viewer.id);

    if (action === "manageExpenseCategory") {
      if (!admin) return fail("Forbidden",403);
      const operation=text(body.operation,20);
      const name=text(body.name,100);
      if(!name || name.length>100) return fail("Category name is required");
      if(operation==="add"){
        if(!/^[\p{L}\p{N}][\p{L}\p{N} &()'.,/_-]*$/u.test(name))return fail("Invalid category name");
        const existing=await one<{name:string}>(`SELECT name FROM oa_entity_expense_category WHERE entity_id=? AND name=? COLLATE NOCASE`,[LEGACY_ENTITY_ID,name]);
        if(existing)return fail("Category already exists; reactivate it instead",409);
        await run(`INSERT INTO oa_entity_expense_category(entity_id,name,sort_order) VALUES(?,?,COALESCE((SELECT MAX(sort_order)+10 FROM oa_entity_expense_category WHERE entity_id=?),10))`,[LEGACY_ENTITY_ID,name,LEGACY_ENTITY_ID]);
      } else if(operation==="activate"||operation==="deactivate"){
        if(name===MEDICAL_INSURANCE_CATEGORY && operation==="deactivate")return fail("Medical Insurance is a protected category",409);
        const result=await run(`UPDATE oa_entity_expense_category SET active=? WHERE entity_id=? AND name=?`,[operation==="activate"?1:0,LEGACY_ENTITY_ID,name]);
        if(!result.meta?.changes)return fail("Category not found",404);
      } else return fail("Unsupported category operation");
      await audit(viewer.id,action,"expense_category",name,{operation});
      return ok({updated:true});
    }

    if (action === "syncEmployees") {
      if (!admin) return fail("Forbidden", 403);
      const s = await settings();
      await run(
        `INSERT OR IGNORE INTO oa_employee(user_id,annual_leave_days,payroll_currency,reimbursement_currency,entity_id)
         SELECT id,?,?,?,'legacy-primary' FROM user WHERE id <> 'vcs-bot'`,
        [Number(s?.default_annual_leave_days ?? 14), s?.base_currency ?? "SGD", s?.base_currency ?? "SGD"],
      );
      await run(`INSERT OR IGNORE INTO oa_entity_member(entity_id,user_id,role)
        SELECT ?,e.user_id,'employee' FROM oa_employee e
        JOIN user u ON u.id=e.user_id`,[LEGACY_ENTITY_ID]);
      await audit(viewer.id, action, "employee", null);
      return ok({ synced: true });
    }

    if (action === "updateEmployee") {
      if (!admin) return fail("Forbidden", 403);
      const userId = text(body.userId, 200); if (!userId) return fail("userId is required");
      await ensureEmployee(userId);
      // Explicit primary-entity enrollment for an administrator-added employee.
      await run(`INSERT OR IGNORE INTO oa_entity_member(entity_id,user_id,role)
                 SELECT ?,id,'employee' FROM user WHERE id=?`,[LEGACY_ENTITY_ID,userId]);
      const payrollCurrency = normalizeCurrency(body.payrollCurrency || "SGD");
      const reimbursementCurrency = normalizeCurrency(body.reimbursementCurrency || payrollCurrency);
      const leaveDays = Number(body.annualLeaveDays);
      if (!Number.isFinite(leaveDays) || leaveDays < 0 || leaveDays > 365) return fail("Invalid annual leave entitlement");
      const medicalInsuranceLimitMinor = majorToMinor(body.medicalInsuranceLimit || 0, payrollCurrency);
      const managerId = text(body.managerUserId, 200) || null;
      if (managerId && !(await one(`SELECT user_id FROM oa_entity_member WHERE entity_id=? AND user_id=? AND active=1`,[LEGACY_ENTITY_ID,managerId]))) return fail("Manager must belong to the same Entity",403);
      if (managerId === userId) return fail("Employee cannot be their own manager");
      const baseSalaryMinor = majorToMinor(body.baseSalary || 0, payrollCurrency);
      const salaryPeriod = text(body.salaryPeriod || "monthly", 20);
      if (!['monthly','annual'].includes(salaryPeriod)) return fail("Invalid salary period");
      await run(
        `UPDATE oa_employee SET employee_no=?,department=?,job_title=?,manager_user_id=?,join_date=?,annual_leave_days=?,medical_insurance_limit_minor=?,payroll_currency=?,reimbursement_currency=?,active=?,
         legal_name=?,personal_email=?,phone=?,address=?,nationality=?,date_of_birth=?,employment_type=?,work_location=?,base_salary_minor=?,salary_period=?,salary_effective_date=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND entity_id='legacy-primary'`,
        [
          text(body.employeeNo,100)||null,text(body.department,200)||null,text(body.jobTitle,200)||null,managerId,
          date(body.joinDate || new Date().toISOString().slice(0,10)),leaveDays,medicalInsuranceLimitMinor,payrollCurrency,reimbursementCurrency,body.active === false ? 0 : 1,
          text(body.legalName,200)||null,text(body.personalEmail,320)||null,text(body.phone,80)||null,text(body.address,1000)||null,
          text(body.nationality,120)||null,optionalDate(body.dateOfBirth),text(body.employmentType,80)||null,text(body.workLocation,200)||null,
          baseSalaryMinor,salaryPeriod,optionalDate(body.salaryEffectiveDate),userId
        ],
      );
      await audit(viewer.id, action, "employee", userId, { payrollCurrency, reimbursementCurrency, leaveDays, medicalInsuranceLimitMinor, salaryChanged: true });
      return ok({ updated: true });
    }

    if (action === "createLeave") {
      const typeCode = text(body.leaveTypeCode, 50);
      const type = await one<{code:string}>(`SELECT code FROM oa_entity_leave_type WHERE entity_id=? AND code=? AND active=1`, [LEGACY_ENTITY_ID,typeCode]);
      if (!type) return fail("Invalid leave type");
      const startDate = date(body.startDate), endDate = date(body.endDate);
      const dayPart = ["full","am","pm"].includes(body.dayPart) ? body.dayPart : "full";
      const days = await businessDays(startDate, endDate, dayPart);
      const fileId = text(body.attachmentFileId, 100) || null;
      if (fileId) {
        const file = await one<{owner_user_id:string}>(`SELECT owner_user_id FROM oa_file WHERE id=? AND entity_id=?`,[fileId,LEGACY_ENTITY_ID]);
        if (!file || file.owner_user_id !== viewer.id) return fail("Invalid attachment");
      }
      const id = crypto.randomUUID();
      await run(
        `INSERT INTO oa_leave_request(id,user_id,leave_type_code,start_date,end_date,day_part,business_days,reason,attachment_file_id,entity_id)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [id,viewer.id,typeCode,startDate,endDate,dayPart,days,text(body.reason,2000)||null,fileId,LEGACY_ENTITY_ID],
      );
      await createApprovalWorkflow("leave", id, viewer.id);
      await audit(viewer.id, action, "leave", id, { days, typeCode });
      await notifySubmitted("leave", id);
      return ok({ id, businessDays: days, approvalSteps: await getApprovalSteps("leave", id) }, 201);
    }

    if (action === "cancelLeave") {
      const id = text(body.id,100);
      const result = await run(`UPDATE oa_leave_request SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND entity_id='legacy-primary' AND status='submitted'`,[id,viewer.id]);
      if (!result.meta?.changes) return fail("Leave request cannot be cancelled",409);
      await cancelApprovalWorkflow("leave", id);
      await audit(viewer.id, action, "leave", id); return ok({ cancelled:true });
    }

    if (action === "createExpenseClaim") {
      const inputs=body.items;
      if(!Array.isArray(inputs)||inputs.length<1||inputs.length>50) return fail("Claim requires 1–50 items");
      const employee=await ensureEmployee(viewer.id);
      const payrollCurrency=normalizeCurrency(employee?.payroll_currency||"SGD");
      const reimbursementCurrency=normalizeCurrency(body.reimbursementCurrency||employee?.reimbursement_currency||payrollCurrency);
      const prepared=[] as any[];
      let total=0,medicalTotal=0;
      const medicalByYear=new Map<number,number>();
      for(let i=0;i<inputs.length;i++){
        const item=inputs[i];
        const expenseDate=date(item.expenseDate);
        const category=await expenseCategory(item.category);
        if(category===MEDICAL_INSURANCE_CATEGORY && reimbursementCurrency!==payrollCurrency)
          return fail(`Medical Insurance requires payroll currency ${payrollCurrency}`);
        const description=text(item.description,2000);
        if(!description) return fail("Item description is required");
        const originalCurrency=normalizeCurrency(item.originalCurrency);
        const originalMinor=majorToMinor(item.amount,originalCurrency);
        if(originalMinor<=0) return fail("Item amount must be positive");
        const docs=item.documentIds??[];
        if(!Array.isArray(docs)||docs.length>20||new Set(docs).size!==docs.length) return fail("Invalid item documents");
        for(const fileId of docs){
          if(typeof fileId!=="string"||!fileId||fileId.length>100) return fail("Invalid file ID");
          const file=await one<{owner_user_id:string;kind:string}>(`SELECT owner_user_id,kind FROM oa_file WHERE id=? AND entity_id=?`,[fileId,LEGACY_ENTITY_ID]);
          if(!file||file.owner_user_id!==viewer.id||file.kind!=="receipt") return fail("Invalid receipt document",403);
        }
        const fx=await getFxQuote(originalCurrency,reimbursementCurrency,expenseDate);
        const minor=convertMinor(originalMinor,originalCurrency,reimbursementCurrency,fx.rate);
        if(!Number.isSafeInteger(minor)||!Number.isSafeInteger(total+minor)) return fail("Amount exceeds supported range");
        total+=minor;
        if(category===MEDICAL_INSURANCE_CATEGORY){
          medicalTotal+=minor;
          const year=expenseYear(expenseDate);
          medicalByYear.set(year,(medicalByYear.get(year)||0)+minor);
        }
        prepared.push({id:crypto.randomUUID(),expenseDate,category,description,originalCurrency,originalMinor,minor,fx,docs});
      }
      if(medicalTotal>0 && (medicalTotal!==total || medicalByYear.size!==1)) return fail("Medical Insurance items must be submitted in a separate claim for one calendar year");
      for(const [year,amount] of medicalByYear){
        const summary=await medicalInsuranceSummary(viewer.id,year);
        if(amount>summary.availableMinor) return fail(`Medical Insurance annual limit exceeded for ${year}. Available: ${formatMoney(summary.availableMinor,summary.currency)}`,409);
      }
      const first=prepared[0],id=crypto.randomUUID();
      const {db}=getOaEnv();
      const statements=[db.prepare(`INSERT INTO oa_expense_claim(id,user_id,expense_date,category,description,original_amount_minor,original_currency,reimbursement_currency,fx_rate,fx_rate_date,fx_source,reimbursement_amount_minor,receipt_file_id,medical_insurance_amount_minor,medical_insurance_currency,entity_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        id,viewer.id,first.expenseDate,medicalTotal>0?MEDICAL_INSURANCE_CATEGORY:(prepared.length===1?first.category:"Other"),prepared.length===1?first.description:`${prepared.length} expense items`,
        prepared.length===1?first.originalMinor:total,prepared.length===1?first.originalCurrency:reimbursementCurrency,
        reimbursementCurrency,prepared.length===1?first.fx.rate:1,first.fx.providerDate,first.fx.source,total,
        first.docs[0]||null,medicalTotal||null,medicalTotal?payrollCurrency:null,LEGACY_ENTITY_ID)];
      for(let i=0;i<prepared.length;i++){
        const x=prepared[i];
        statements.push(db.prepare(`INSERT INTO oa_expense_item(id,claim_id,sort_order,expense_date,category,description,original_amount_minor,original_currency,reimbursement_amount_minor,fx_rate,fx_rate_date,fx_source,entity_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
          x.id,id,i,x.expenseDate,x.category,x.description,x.originalMinor,x.originalCurrency,x.minor,x.fx.rate,x.fx.providerDate,x.fx.source,LEGACY_ENTITY_ID));
        for(const fileId of x.docs) statements.push(db.prepare(`INSERT INTO oa_expense_item_document(item_id,file_id) VALUES(?,?)`).bind(x.id,fileId));
      }
      await db.batch(statements);
      await createApprovalWorkflow("expense",id,viewer.id);
      await audit(viewer.id,action,"expense",id,{itemCount:prepared.length,total,medicalTotal});
      await notifySubmitted("expense",id);
      return ok({id,total,itemCount:prepared.length,approvalSteps:await getApprovalSteps("expense",id)},201);
    }

    if (action === "createExpense") {
      const expenseDate = date(body.expenseDate);
      const category = await expenseCategory(body.category || "Other");
      const originalCurrency = normalizeCurrency(body.originalCurrency);
      const employee = await ensureEmployee(viewer.id);
      const payrollCurrency = normalizeCurrency(employee?.payroll_currency || "SGD");
      const reimbursementCurrency = category === MEDICAL_INSURANCE_CATEGORY
        ? payrollCurrency
        : normalizeCurrency(body.reimbursementCurrency || employee?.reimbursement_currency || payrollCurrency);
      const originalMinor = majorToMinor(body.amount, originalCurrency);
      if (originalMinor <= 0) return fail("Amount must be greater than zero");
      const fx = await getFxQuote(originalCurrency,reimbursementCurrency,expenseDate);
      const reimbursementMinor = convertMinor(originalMinor,originalCurrency,reimbursementCurrency,fx.rate);
      let medicalInsuranceAmountMinor: number | null = null;
      let medicalInsuranceCurrency: string | null = null;
      if (category === MEDICAL_INSURANCE_CATEGORY) {
        medicalInsuranceAmountMinor = reimbursementMinor;
        medicalInsuranceCurrency = payrollCurrency;
        const summary = await medicalInsuranceSummary(viewer.id, expenseYear(expenseDate));
        const projectedMinor = summary.reimbursedMinor + summary.pendingMinor + reimbursementMinor;
        if (projectedMinor > summary.entitlementMinor) {
          return fail(`Medical Insurance annual claim limit exceeded. Available: ${formatMoney(summary.availableMinor, summary.currency)}; this claim: ${formatMoney(reimbursementMinor, summary.currency)}.`, 409);
        }
      }
      const fileId = text(body.receiptFileId,100)||null;
      if (fileId) {
        const file=await one<{owner_user_id:string}>(`SELECT owner_user_id FROM oa_file WHERE id=? AND entity_id=?`,[fileId,LEGACY_ENTITY_ID]);
        if (!file || file.owner_user_id!==viewer.id) return fail("Invalid receipt");
      }
      const id=crypto.randomUUID();
      const itemId = crypto.randomUUID();
      const {db} = getOaEnv();
      const statements = [
        db.prepare(`INSERT INTO oa_expense_claim(id,user_id,expense_date,category,description,original_amount_minor,original_currency,reimbursement_currency,fx_rate,fx_rate_date,fx_source,reimbursement_amount_minor,receipt_file_id,medical_insurance_amount_minor,medical_insurance_currency,entity_id)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,viewer.id,expenseDate,category,text(body.description,2000),originalMinor,originalCurrency,reimbursementCurrency,fx.rate,fx.providerDate,fx.source,reimbursementMinor,fileId,medicalInsuranceAmountMinor,medicalInsuranceCurrency,LEGACY_ENTITY_ID),
        db.prepare(`INSERT INTO oa_expense_item(id,claim_id,sort_order,expense_date,category,description,original_amount_minor,original_currency,reimbursement_amount_minor,fx_rate,fx_rate_date,fx_source,entity_id)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(itemId,id,0,expenseDate,category,text(body.description,2000),originalMinor,originalCurrency,reimbursementMinor,fx.rate,fx.providerDate,fx.source,LEGACY_ENTITY_ID),
      ];
      if (fileId) statements.push(db.prepare(`INSERT INTO oa_expense_item_document(item_id,file_id) VALUES(?,?)`).bind(itemId,fileId));
      await db.batch(statements);
      await createApprovalWorkflow("expense", id, viewer.id);
      await audit(viewer.id,action,"expense",id,{category,originalCurrency,reimbursementCurrency,fx,medicalInsuranceAmountMinor,medicalInsuranceCurrency});
      await notifySubmitted("expense", id);
      return ok({id,category,originalMinor,reimbursementMinor,fx,medicalInsuranceSummary: category===MEDICAL_INSURANCE_CATEGORY?await medicalInsuranceSummary(viewer.id,expenseYear(expenseDate)):null,approvalSteps:await getApprovalSteps("expense",id)},201);
    }

    if (action === "cancelExpense") {
      const id=text(body.id,100);
      const result=await run(`UPDATE oa_expense_claim SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND entity_id='legacy-primary' AND status='submitted'`,[id,viewer.id]);
      if (!result.meta?.changes) return fail("Expense cannot be cancelled",409);
      await cancelApprovalWorkflow("expense", id);
      await audit(viewer.id,action,"expense",id); return ok({cancelled:true});
    }

    if (action === "updateExpenseCategory") {
      if (!admin) return fail("Forbidden",403);
      const id=text(body.id,100);
      const category=await expenseCategory(body.category);
      const claim=await one<any>(
        `SELECT x.*,e.payroll_currency FROM oa_expense_claim x
         LEFT JOIN oa_entity_employee e ON e.user_id=x.user_id AND e.entity_id=x.entity_id WHERE x.id=? AND x.entity_id=?`,
        [id,LEGACY_ENTITY_ID],
      );
      if (!claim) return fail("Expense not found",404);
      // Header-only category corrections would desynchronise item-level reports.
      const itemCount = await one<{n:number}>(`SELECT COUNT(*) AS n FROM oa_expense_item WHERE claim_id=? AND entity_id=?`,[id,LEGACY_ENTITY_ID]);
      if (Number(itemCount?.n || 0) > 1) return fail("Multi-item claims require item-level category correction",409);
      let medicalInsuranceAmountMinor:number|null=null;
      let medicalInsuranceCurrency:string|null=null;
      if (category===MEDICAL_INSURANCE_CATEGORY) {
        const employee=await ensureEmployee(claim.user_id);
        const payrollCurrency=normalizeCurrency(employee?.payroll_currency||claim.payroll_currency||claim.reimbursement_currency||"SGD");
        const originalCurrency=normalizeCurrency(claim.original_currency);
        const fx=await getFxQuote(originalCurrency,payrollCurrency,claim.expense_date);
        medicalInsuranceAmountMinor=convertMinor(Number(claim.original_amount_minor||0),originalCurrency,payrollCurrency,fx.rate);
        medicalInsuranceCurrency=payrollCurrency;
      }
      await run(
        `UPDATE oa_expense_claim
         SET category=?,medical_insurance_amount_minor=?,medical_insurance_currency=?,category_updated_at=CURRENT_TIMESTAMP,category_updated_by=?,updated_at=CURRENT_TIMESTAMP
         WHERE id=? AND entity_id=?`,
        [category,medicalInsuranceAmountMinor,medicalInsuranceCurrency,viewer.id,id,LEGACY_ENTITY_ID],
      );
      await run(`UPDATE oa_expense_item SET category=? WHERE claim_id=? AND entity_id=?`,[category,id,LEGACY_ENTITY_ID]);
      await audit(viewer.id,action,"expense",id,{oldCategory:claim.category,newCategory:category,medicalInsuranceAmountMinor,medicalInsuranceCurrency});
      return ok({updated:true,category});
    }

    if (["approveLeave","rejectLeave"].includes(action)) {
      const id=text(body.id,100);
      const row=await one<{user_id:string;status:string}>(`SELECT user_id,status FROM oa_leave_request WHERE id=? AND entity_id=?`,[id,LEGACY_ENTITY_ID]);
      if (!row) return fail("Leave request not found",404);
      if (row.status!=="submitted") return fail("Leave request is no longer pending",409);
      await createApprovalWorkflow("leave", id, row.user_id);
      const step=await getPendingStep("leave",id);
      if (!step) return fail("No pending approval step",409);
      if (!canActOnStep(step,viewer.id,admin)) return fail("Forbidden",403);
      const note=text(body.note,1000)||null;
      if (action==="rejectLeave") {
        await rejectCurrentStep("leave",id,viewer.id,note);
        await run(`UPDATE oa_leave_request SET status='rejected',decided_at=CURRENT_TIMESTAMP,decided_by=?,decision_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND entity_id=?`,[viewer.id,note,id,LEGACY_ENTITY_ID]);
        await audit(viewer.id,action,"leave",id,{stepNo:step.step_no});
        await notifyDecision("leave",id,viewer.id,"rejected",true);
        return ok({status:"rejected",complete:true});
      }
      const result=await approveCurrentStep("leave",id,viewer.id,note);
      if (result.complete) {
        await run(`UPDATE oa_leave_request SET status='approved',decided_at=CURRENT_TIMESTAMP,decided_by=?,decision_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND entity_id=?`,[viewer.id,note,id,LEGACY_ENTITY_ID]);
      }
      await audit(viewer.id,action,"leave",id,{stepNo:step.step_no,complete:result.complete});
      await notifyDecision("leave",id,viewer.id,"approved",result.complete);
      return ok({status:result.complete?"approved":"submitted",complete:result.complete,nextStep:result.nextStep});
    }

    if (["approveExpense","rejectExpense"].includes(action)) {
      const id=text(body.id,100);
      const row=await one<{user_id:string;status:string}>(`SELECT user_id,status FROM oa_expense_claim WHERE id=? AND entity_id=?`,[id,LEGACY_ENTITY_ID]);
      if (!row) return fail("Expense not found",404);
      if (row.status!=="submitted") return fail("Expense is no longer pending",409);
      await createApprovalWorkflow("expense", id, row.user_id);
      const step=await getPendingStep("expense",id);
      if (!step) return fail("No pending approval step",409);
      if (!canActOnStep(step,viewer.id,admin)) return fail("Forbidden",403);
      const note=text(body.note,1000)||null;
      if (action==="rejectExpense") {
        await rejectCurrentStep("expense",id,viewer.id,note);
        await run(`UPDATE oa_expense_claim SET status='rejected',decided_at=CURRENT_TIMESTAMP,decided_by=?,decision_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND entity_id=?`,[viewer.id,note,id,LEGACY_ENTITY_ID]);
        await audit(viewer.id,action,"expense",id,{stepNo:step.step_no});
        await notifyDecision("expense",id,viewer.id,"rejected",true);
        return ok({status:"rejected",complete:true});
      }
      const result=await approveCurrentStep("expense",id,viewer.id,note);
      if (result.complete) {
        await run(`UPDATE oa_expense_claim SET status='approved',decided_at=CURRENT_TIMESTAMP,decided_by=?,decision_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND entity_id=?`,[viewer.id,note,id,LEGACY_ENTITY_ID]);
      }
      await audit(viewer.id,action,"expense",id,{stepNo:step.step_no,complete:result.complete});
      await notifyDecision("expense",id,viewer.id,"approved",result.complete);
      return ok({status:result.complete?"approved":"submitted",complete:result.complete,nextStep:result.nextStep});
    }

    if (action === "markExpensePaid") {
      if (!admin) return fail("Forbidden",403);
      const id=text(body.id,100);
      const result=await run(`UPDATE oa_expense_claim SET status='paid',paid_at=CURRENT_TIMESTAMP,paid_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND entity_id=? AND status='approved'`,[viewer.id,id,LEGACY_ENTITY_ID]);
      if (!result.meta?.changes) return fail("Only approved expenses can be paid",409);
      await audit(viewer.id,action,"expense",id); return ok({status:"paid"});
    }

    if (action === "createPayslip") {
      if (!admin) return fail("Forbidden",403);
      const userId=text(body.userId,200); if (!userId) return fail("Employee is required");
      await ensureEmployee(userId);
      const employeeProfile=await one<any>(
        `SELECT e.*,u.name,u.email FROM oa_entity_employee e JOIN user u ON u.id=e.user_id WHERE e.user_id=? AND e.entity_id='legacy-primary'`,
        [userId],
      );
      if (!employeeProfile) return fail("Employee profile not found",404);
      const currency=normalizeCurrency(body.currency||employeeProfile.payroll_currency||"SGD");
      const s=await settings(); const reportingCurrency=normalizeCurrency(s?.base_currency||"SGD");
      const payDate=date(body.payDate);
      const baseSalaryInput=text(body.baseSalary,100);
      const baseSalary=baseSalaryInput
        ? majorToMinor(baseSalaryInput,currency)
        : currency===normalizeCurrency(employeeProfile.payroll_currency||currency)
          ? Number(employeeProfile.base_salary_minor||0)
          : 0;
      const allowances=majorToMinor(body.allowances||0,currency);
      const bonus=majorToMinor(body.bonus||0,currency);
      const commission=majorToMinor(body.commission||0,currency);
      const employeeContribution=majorToMinor(body.employeeContribution||0,currency);
      const employerContribution=majorToMinor(body.employerContribution||0,currency);
      const tax=majorToMinor(body.tax||0,currency);
      const otherDeductions=majorToMinor(body.otherDeductions||0,currency);
      const customFields:{name:string;type:"contribution"|"deduction";amount_minor:number}[]=[];
      if (Array.isArray(body.customFields)) {
        for (const item of body.customFields.slice(0,20)) {
          const name=text(item?.name,100);
          const amountText=text(item?.amount,100);
          if (!name && !amountText) continue;
          if (!name) return fail("Custom payroll item name is required");
          if (!amountText) return fail(`Amount is required for custom payroll item: ${name}`);
          const type=text(item?.type,20);
          if (type!=="contribution" && type!=="deduction") return fail(`Invalid type for custom payroll item: ${name}`);
          const amountMinor=majorToMinor(amountText,currency);
          customFields.push({name,type,amount_minor:amountMinor});
        }
      }
      const customContributions=customFields.filter(x=>x.type==="contribution").reduce((sum,x)=>sum+x.amount_minor,0);
      const customDeductions=customFields.filter(x=>x.type==="deduction").reduce((sum,x)=>sum+x.amount_minor,0);
      if (!Number.isSafeInteger(customContributions) || !Number.isSafeInteger(customDeductions)) return fail("Custom payroll total is too large");
      const gross=baseSalary+allowances+bonus+commission+customContributions;
      const net=gross-employeeContribution-tax-otherDeductions-customDeductions;
      if (net<0) return fail("Net salary cannot be negative");
      const fx=await getFxQuote(currency,reportingCurrency,payDate);
      const netReporting=convertMinor(net,currency,reportingCurrency,fx.rate);
      const attachmentId=text(body.attachmentFileId,100)||null;
      if (attachmentId) {
        const file=await one<{owner_user_id:string}>(`SELECT owner_user_id FROM oa_file WHERE id=? AND entity_id=?`,[attachmentId,LEGACY_ENTITY_ID]);
        if (!file || file.owner_user_id!==userId) return fail("Payslip attachment must belong to the employee");
      }
      const id=crypto.randomUUID();
      await run(
        `INSERT INTO oa_payslip(id,user_id,period_start,period_end,pay_date,currency,base_salary_minor,allowances_minor,bonus_minor,commission_minor,employee_contribution_minor,employer_contribution_minor,tax_minor,other_deductions_minor,gross_minor,net_minor,reporting_currency,fx_rate_to_reporting,fx_rate_date,fx_source,net_reporting_minor,custom_fields_json,note,attachment_file_id,created_by,employee_name_snapshot,employee_no_snapshot,join_date_snapshot,job_title_snapshot,department_snapshot,salary_period_snapshot,entity_id)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id,userId,date(body.periodStart),date(body.periodEnd),payDate,currency,baseSalary,allowances,bonus,commission,employeeContribution,employerContribution,tax,otherDeductions,gross,net,reportingCurrency,fx.rate,fx.providerDate,fx.source,netReporting,JSON.stringify(customFields),text(body.note,2000)||null,attachmentId,viewer.id,
         text(employeeProfile.legal_name||employeeProfile.name||employeeProfile.email,200)||null,text(employeeProfile.employee_no,100)||null,employeeProfile.join_date||null,text(employeeProfile.job_title,200)||null,text(employeeProfile.department,200)||null,text(employeeProfile.salary_period||"monthly",20),LEGACY_ENTITY_ID],
      );
      await audit(viewer.id,action,"payslip",id,{currency,reportingCurrency,fx,customFieldCount:customFields.length,customContributions,customDeductions,employeeNo:employeeProfile.employee_no||null,joinDate:employeeProfile.join_date||null});
      return ok({id,gross,net,netReporting,fx,customContributions,customDeductions},201);
    }

    if (action === "publishPayslip") {
      if (!admin) return fail("Forbidden",403);
      const id=text(body.id,100);
      const result=await run(`UPDATE oa_payslip SET status='published',published_at=CURRENT_TIMESTAMP,published_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND entity_id=? AND status='draft'`,[viewer.id,id,LEGACY_ENTITY_ID]);
      if (!result.meta?.changes) return fail("Only draft payslips can be published",409);
      await audit(viewer.id,action,"payslip",id); return ok({status:"published"});
    }

    if (action === "voidPayslip") {
      if (!admin) return fail("Forbidden",403);
      const id=text(body.id,100);
      await run(`UPDATE oa_payslip SET status='void',updated_at=CURRENT_TIMESTAMP WHERE id=? AND entity_id=?`,[id,LEGACY_ENTITY_ID]);
      await audit(viewer.id,action,"payslip",id); return ok({status:"void"});
    }

    if (action === "updateSettings") {
      if (!admin) return fail("Forbidden",403);
      const baseCurrency=normalizeCurrency(body.baseCurrency||"SGD");
      const defaultLeave=Number(body.defaultAnnualLeaveDays);
      if (!Number.isFinite(defaultLeave)||defaultLeave<0||defaultLeave>365) return fail("Invalid default annual leave entitlement");
      const leaveApprovalFlow = normalizeApprovalFlow(body.leaveApprovalFlow);
      const expenseApprovalFlow = normalizeApprovalFlow(body.expenseApprovalFlow);
      await run(`UPDATE oa_settings SET company_name=?,base_currency=?,default_annual_leave_days=?,leave_approval_flow=?,expense_approval_flow=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`,[text(body.companyName,200)||"Company",baseCurrency,defaultLeave,leaveApprovalFlow,expenseApprovalFlow]);
      await audit(viewer.id,action,"settings","1",{baseCurrency,defaultLeave}); return ok({updated:true});
    }

    if (action === "updateEmailSettings") {
      if (!admin) return fail("Forbidden",403);
      const enabled = body.emailEnabled === true ? 1 : 0;
      const provider = text(body.emailProvider || "resend",40);
      if (provider !== "resend") return fail("Only Resend is supported in this release");
      const fromName = text(body.emailFromName,120) || "OA Notifications";
      const fromAddress = emailAddress(body.emailFromAddress);
      const replyTo = emailAddress(body.emailReplyTo);
      const newApiKey = text(body.emailApiKey,1000);
      const clearApiKey = body.clearEmailApiKey === true;
      const existing = await one<{email_api_key_encrypted:string|null}>(`SELECT email_api_key_encrypted FROM oa_settings WHERE id=1`);
      let encrypted = clearApiKey ? null : existing?.email_api_key_encrypted ?? null;
      if (newApiKey) encrypted = await encryptEmailSecret(newApiKey);
      if (enabled && !fromAddress) return fail("From email address is required when email notifications are enabled");
      if (enabled && !encrypted) return fail("Resend API key is required when email notifications are enabled");
      await run(`UPDATE oa_settings SET email_enabled=?,email_provider=?,email_from_name=?,email_from_address=?,email_reply_to=?,email_api_key_encrypted=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`,[enabled,provider,fromName,fromAddress,replyTo,encrypted]);
      await audit(viewer.id,action,"settings","1",{enabled:Boolean(enabled),provider,fromAddress,replyTo,apiKeyChanged:Boolean(newApiKey),apiKeyCleared:clearApiKey});
      return ok({updated:true,email:await publicEmailSettings()});
    }

    if (action === "testEmail") {
      if (!admin) return fail("Forbidden",403);
      const to = emailAddress(body.to || viewer.email, true)!;
      const result = await sendTestEmail(to,{id:viewer.id,name:viewer.name??null,email:viewer.email});
      await audit(viewer.id,action,"email",null,{to});
      return ok({sent:true,result});
    }

    if (action === "addHoliday") {
      if (!admin) return fail("Forbidden",403);
      const holidayDate=date(body.holidayDate), name=text(body.name,200); if (!name) return fail("Holiday name is required");
      const id=crypto.randomUUID();
      await run(`INSERT INTO oa_entity_holiday(id,entity_id,holiday_date,name,created_by) VALUES(?,?,?,?,?) ON CONFLICT(entity_id,holiday_date) DO UPDATE SET name=excluded.name,created_by=excluded.created_by`,[id,LEGACY_ENTITY_ID,holidayDate,name,viewer.id]);
      await audit(viewer.id,action,"holiday",id,{holidayDate,name}); return ok({id});
    }

    if (action === "deleteHoliday") {
      if (!admin) return fail("Forbidden",403);
      const id=text(body.id,100); await run(`DELETE FROM oa_entity_holiday WHERE id=? AND entity_id=?`,[id,LEGACY_ENTITY_ID]); await audit(viewer.id,action,"holiday",id); return ok({deleted:true});
    }

    if (action === "fxQuote") {
      const fx=await getFxQuote(normalizeCurrency(body.base),normalizeCurrency(body.quote),date(body.date));
      return ok(fx);
    }

    return fail("Unknown action",404);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return fail("Unauthorized",401);
    if (error instanceof EntityAccessError) return fail(error.message,error.status);
    if (error instanceof Error && error.message.includes("medical allowance:")) return fail("Medical Insurance annual allowance exceeded or invalid. Refresh your balance and retry.",409);
    console.error("OA POST failed",error);
    return fail(error instanceof Error ? error.message : "OA request failed",500);
  }
}
