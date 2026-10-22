import { NextRequest, NextResponse } from "next/server";
import { getOaEnv } from "@/lib/oa/env";
import { getViewer, isAdminTier } from "@/lib/auth-server";
import { all, audit, one, run, settings } from "@/lib/oa/db";
import { getFxQuote } from "@/lib/oa/fx";
import { businessDays } from "@/lib/oa/leave";
import { COMMON_CURRENCIES, convertMinor, majorToMinor, normalizeCurrency } from "@/lib/oa/money";

export const runtime = "nodejs";

function ok(data: unknown, status = 200) { return NextResponse.json({ ok: true, data }, { status }); }
function fail(message: string, status = 400) { return NextResponse.json({ ok: false, error: message }, { status }); }
function text(value: unknown, max = 5000) { return String(value ?? "").trim().slice(0, max); }
function date(value: unknown) {
  const v = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("Invalid date");
  return v;
}

async function requireOaViewer() {
  const viewer = await getViewer();
  if (!viewer) throw new Error("UNAUTHORIZED");
  return viewer;
}

async function ensureEmployee(userId: string) {
  const s = await settings();
  await run(
    `INSERT OR IGNORE INTO oa_employee(user_id,annual_leave_days,payroll_currency,reimbursement_currency)
     VALUES(?,?,?,?)`,
    [userId, Number(s?.default_annual_leave_days ?? 14), s?.base_currency ?? "SGD", s?.base_currency ?? "SGD"],
  );
  return one<any>(`SELECT * FROM oa_employee WHERE user_id=?`, [userId]);
}

async function canManage(actorId: string, employeeId: string, admin: boolean) {
  if (admin) return true;
  const row = await one<{manager_user_id:string|null}>(`SELECT manager_user_id FROM oa_employee WHERE user_id=?`, [employeeId]);
  return row?.manager_user_id === actorId;
}

async function leaveSummary(userId: string) {
  const employee = await ensureEmployee(userId);
  const year = new Date().getUTCFullYear();
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const approved = await one<{days:number|null}>(
    `SELECT SUM(l.business_days) AS days FROM oa_leave_request l
     JOIN oa_leave_type t ON t.code=l.leave_type_code
     WHERE l.user_id=? AND l.status='approved' AND t.deducts_annual=1 AND l.start_date BETWEEN ? AND ?`,
    [userId, from, to],
  );
  const pending = await one<{days:number|null}>(
    `SELECT SUM(l.business_days) AS days FROM oa_leave_request l
     JOIN oa_leave_type t ON t.code=l.leave_type_code
     WHERE l.user_id=? AND l.status='submitted' AND t.deducts_annual=1 AND l.start_date BETWEEN ? AND ?`,
    [userId, from, to],
  );
  const entitlement = Number(employee?.annual_leave_days ?? 0);
  const used = Number(approved?.days ?? 0);
  const pendingDays = Number(pending?.days ?? 0);
  return { year, entitlement, used, pending: pendingDays, available: Math.max(0, entitlement - used - pendingDays) };
}

export async function GET(request: NextRequest) {
  try {
    const viewer = await requireOaViewer();
    const admin = isAdminTier(viewer.role);
    const resource = request.nextUrl.searchParams.get("resource") || "bootstrap";
    await ensureEmployee(viewer.id);

    if (resource === "bootstrap") {
      const employee = await one<any>(
        `SELECT e.*, u.name, u.email, m.name AS manager_name
         FROM oa_employee e JOIN user u ON u.id=e.user_id
         LEFT JOIN user m ON m.id=e.manager_user_id WHERE e.user_id=?`, [viewer.id],
      );
      const s = await settings();
      const managed = await one<{n:number}>(`SELECT COUNT(*) AS n FROM oa_employee WHERE manager_user_id=? AND active=1`, [viewer.id]);
      return ok({ viewer, admin, isManager: Number(managed?.n ?? 0) > 0, employee, leaveSummary: await leaveSummary(viewer.id), settings: s, currencies: COMMON_CURRENCIES });
    }

    if (resource === "leave") {
      return ok({
        summary: await leaveSummary(viewer.id),
        types: await all(`SELECT * FROM oa_leave_type WHERE active=1 ORDER BY sort_order,name`),
        requests: await all(
          `SELECT l.*, t.name AS leave_type_name, f.original_name AS attachment_name
           FROM oa_leave_request l JOIN oa_leave_type t ON t.code=l.leave_type_code
           LEFT JOIN oa_file f ON f.id=l.attachment_file_id
           WHERE l.user_id=? ORDER BY l.submitted_at DESC LIMIT 100`, [viewer.id],
        ),
      });
    }

    if (resource === "expenses") {
      const claims = await all<any>(`SELECT e.*, f.original_name AS receipt_name FROM oa_expense_claim e
         LEFT JOIN oa_file f ON f.id=e.receipt_file_id
         WHERE e.user_id=? ORDER BY e.submitted_at DESC LIMIT 100`, [viewer.id]);
      const items = await all<any>(`SELECT i.*, f.id AS document_id, f.original_name AS document_name
         FROM oa_expense_item i LEFT JOIN oa_expense_item_document d ON d.item_id=i.id
         LEFT JOIN oa_file f ON f.id=d.file_id
         WHERE i.claim_id IN (SELECT id FROM oa_expense_claim WHERE user_id=?)
         ORDER BY i.sort_order, i.id`, [viewer.id]);
      return ok(claims.map(c=>({...c,items:items.filter(i=>i.claim_id===c.id)
        .reduce((acc:any[],i:any)=>{let row=acc.find(x=>x.id===i.id);
          if(!row){row={...i,documents:[]};acc.push(row);}
          if(i.document_id)row.documents.push({id:i.document_id,name:i.document_name});
          return acc;},[])})));
    }

    if (resource === "payslips") {
      return ok(await all(
        `SELECT p.*, f.original_name AS attachment_name FROM oa_payslip p
         LEFT JOIN oa_file f ON f.id=p.attachment_file_id
         WHERE p.user_id=? AND p.status='published' ORDER BY p.pay_date DESC LIMIT 100`, [viewer.id],
      ));
    }

    if (resource === "approvals") {
      const leaveSql = admin
        ? `SELECT l.*,u.name,u.email,t.name AS leave_type_name FROM oa_leave_request l JOIN user u ON u.id=l.user_id JOIN oa_leave_type t ON t.code=l.leave_type_code WHERE l.status='submitted' ORDER BY l.submitted_at`
        : `SELECT l.*,u.name,u.email,t.name AS leave_type_name FROM oa_leave_request l JOIN user u ON u.id=l.user_id JOIN oa_employee e ON e.user_id=l.user_id JOIN oa_leave_type t ON t.code=l.leave_type_code WHERE l.status='submitted' AND e.manager_user_id=? ORDER BY l.submitted_at`;
      const expenseSql = admin
        ? `SELECT x.*,u.name,u.email FROM oa_expense_claim x JOIN user u ON u.id=x.user_id WHERE x.status IN ('submitted','approved') ORDER BY x.submitted_at`
        : `SELECT x.*,u.name,u.email FROM oa_expense_claim x JOIN user u ON u.id=x.user_id JOIN oa_employee e ON e.user_id=x.user_id WHERE x.status='submitted' AND e.manager_user_id=? ORDER BY x.submitted_at`;
      return ok({
        leave: await all(leaveSql, admin ? [] : [viewer.id]),
        expenses: await Promise.all((await all<any>(expenseSql, admin ? [] : [viewer.id])).map(async claim=>({
          ...claim, items: await Promise.all((await all<any>(`SELECT * FROM oa_expense_item WHERE claim_id=? ORDER BY sort_order`,[claim.id])).map(async item=>({
            ...item,documents:await all<any>(`SELECT f.id,f.original_name AS name FROM oa_expense_item_document d JOIN oa_file f ON f.id=d.file_id WHERE d.item_id=?`,[item.id])
          })))
        }))),
      });
    }

    if (resource === "employees") {
      if (!admin) return fail("Forbidden", 403);
      return ok(await all(
        `SELECT u.id,u.name,u.email,u.role,e.employee_no,e.department,e.job_title,e.manager_user_id,
                e.join_date,e.annual_leave_days,e.payroll_currency,e.reimbursement_currency,e.active,
                m.name AS manager_name
         FROM user u LEFT JOIN oa_employee e ON e.user_id=u.id LEFT JOIN user m ON m.id=e.manager_user_id
         ORDER BY COALESCE(e.active,1) DESC,u.name,u.email`,
      ));
    }

    if (resource === "admin-payslips") {
      if (!admin) return fail("Forbidden", 403);
      return ok(await all(
        `SELECT p.*,u.name,u.email,f.original_name AS attachment_name FROM oa_payslip p
         JOIN user u ON u.id=p.user_id LEFT JOIN oa_file f ON f.id=p.attachment_file_id
         ORDER BY p.pay_date DESC,p.created_at DESC LIMIT 200`,
      ));
    }

    if (resource === "settings") {
      if (!admin) return fail("Forbidden", 403);
      return ok({ settings: await settings(), holidays: await all(`SELECT * FROM oa_holiday ORDER BY holiday_date DESC LIMIT 300`), fxCache: await all(`SELECT * FROM oa_fx_rate ORDER BY fetched_at DESC LIMIT 30`) });
    }

    return fail("Unknown resource", 404);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return fail("Unauthorized", 401);
    console.error("OA GET failed", error);
    return fail(error instanceof Error ? error.message : "OA request failed", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const viewer = await requireOaViewer();
    const admin = isAdminTier(viewer.role);
    const body = await request.json() as Record<string, any>;
    const action = text(body.action, 80);
    await ensureEmployee(viewer.id);

    if (action === "syncEmployees") {
      if (!admin) return fail("Forbidden", 403);
      const s = await settings();
      await run(
        `INSERT OR IGNORE INTO oa_employee(user_id,annual_leave_days,payroll_currency,reimbursement_currency)
         SELECT id,?,?,? FROM user`,
        [Number(s?.default_annual_leave_days ?? 14), s?.base_currency ?? "SGD", s?.base_currency ?? "SGD"],
      );
      await audit(viewer.id, action, "employee", null);
      return ok({ synced: true });
    }

    if (action === "updateEmployee") {
      if (!admin) return fail("Forbidden", 403);
      const userId = text(body.userId, 200); if (!userId) return fail("userId is required");
      await ensureEmployee(userId);
      const payrollCurrency = normalizeCurrency(body.payrollCurrency || "SGD");
      const reimbursementCurrency = normalizeCurrency(body.reimbursementCurrency || payrollCurrency);
      const leaveDays = Number(body.annualLeaveDays);
      if (!Number.isFinite(leaveDays) || leaveDays < 0 || leaveDays > 365) return fail("Invalid annual leave entitlement");
      const managerId = text(body.managerUserId, 200) || null;
      if (managerId === userId) return fail("Employee cannot be their own manager");
      await run(
        `UPDATE oa_employee SET employee_no=?,department=?,job_title=?,manager_user_id=?,join_date=?,annual_leave_days=?,payroll_currency=?,reimbursement_currency=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?`,
        [text(body.employeeNo,100)||null,text(body.department,200)||null,text(body.jobTitle,200)||null,managerId,date(body.joinDate || new Date().toISOString().slice(0,10)),leaveDays,payrollCurrency,reimbursementCurrency,body.active === false ? 0 : 1,userId],
      );
      await audit(viewer.id, action, "employee", userId, { payrollCurrency, reimbursementCurrency, leaveDays });
      return ok({ updated: true });
    }

    if (action === "createLeave") {
      const typeCode = text(body.leaveTypeCode, 50);
      const type = await one<{code:string}>(`SELECT code FROM oa_leave_type WHERE code=? AND active=1`, [typeCode]);
      if (!type) return fail("Invalid leave type");
      const startDate = date(body.startDate), endDate = date(body.endDate);
      const dayPart = ["full","am","pm"].includes(body.dayPart) ? body.dayPart : "full";
      const days = await businessDays(startDate, endDate, dayPart);
      const fileId = text(body.attachmentFileId, 100) || null;
      if (fileId) {
        const file = await one<{owner_user_id:string}>(`SELECT owner_user_id FROM oa_file WHERE id=?`,[fileId]);
        if (!file || file.owner_user_id !== viewer.id) return fail("Invalid attachment");
      }
      const id = crypto.randomUUID();
      await run(
        `INSERT INTO oa_leave_request(id,user_id,leave_type_code,start_date,end_date,day_part,business_days,reason,attachment_file_id)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        [id,viewer.id,typeCode,startDate,endDate,dayPart,days,text(body.reason,2000)||null,fileId],
      );
      await audit(viewer.id, action, "leave", id, { days, typeCode });
      return ok({ id, businessDays: days }, 201);
    }

    if (action === "cancelLeave") {
      const id = text(body.id,100);
      const result = await run(`UPDATE oa_leave_request SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND status='submitted'`,[id,viewer.id]);
      if (!result.meta?.changes) return fail("Leave request cannot be cancelled",409);
      await audit(viewer.id, action, "leave", id); return ok({ cancelled:true });
    }

    if (action === "createExpenseClaim") {
      if (!Array.isArray(body.items) || body.items.length<1 || body.items.length>50) return fail("A claim requires 1–50 items");
      const employee=await ensureEmployee(viewer.id);
      const reimbursementCurrency=normalizeCurrency(body.reimbursementCurrency||employee?.reimbursement_currency||"SGD");
      const prepared:any[]=[];let total=0;
      for(const [index,item] of body.items.entries()){
        const expenseDate=date(item.expenseDate);
        const originalCurrency=normalizeCurrency(item.originalCurrency);
        const originalMinor=majorToMinor(item.amount,originalCurrency);
        if(!Number.isSafeInteger(originalMinor)||originalMinor<=0) return fail("Invalid amount for item "+(index+1));
        const description=text(item.description,2000);
        if(!description) return fail("Description is required for item "+(index+1));
        const ids=item.documentIds??[];
        if(!Array.isArray(ids)||ids.length>20||ids.some((id:unknown)=>typeof id!=="string"||!id)) return fail("Invalid documents");
        if(new Set(ids).size!==ids.length) return fail("Duplicate documents");
        for(const fileId of ids){
          const file=await one<{owner_user_id:string}>(`SELECT owner_user_id FROM oa_file WHERE id=?`,[fileId]);
          if(!file||file.owner_user_id!==viewer.id) return fail("Invalid document",403);
        }
        const fx=await getFxQuote(originalCurrency,reimbursementCurrency,expenseDate);
        const reimbursementMinor=convertMinor(originalMinor,originalCurrency,reimbursementCurrency,fx.rate);
        if(!Number.isSafeInteger(reimbursementMinor)||reimbursementMinor<0||!Number.isSafeInteger(total+reimbursementMinor)) return fail("Claim total out of range");
        total+=reimbursementMinor;
        prepared.push({id:crypto.randomUUID(),expenseDate,originalCurrency,originalMinor,reimbursementMinor,fx,
          category:text(item.category,100)||"Other",description,ids});
      }
      const id=crypto.randomUUID(),first=prepared[0];
      const {db}=getOaEnv();
      const statements=[
        db.prepare(`INSERT INTO oa_expense_claim(id,user_id,expense_date,category,description,original_amount_minor,original_currency,reimbursement_currency,fx_rate,fx_rate_date,fx_source,reimbursement_amount_minor,receipt_file_id)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL)`).bind(id,viewer.id,first.expenseDate,prepared.length===1?first.category:"Multiple items",
          prepared.length===1?first.description:prepared.length+" expense items",prepared.length===1?first.originalMinor:total,prepared.length===1?first.originalCurrency:reimbursementCurrency,
          reimbursementCurrency,first.fx.rate,first.fx.providerDate,first.fx.source,total),
        ...prepared.map((i,index)=>db.prepare(`INSERT INTO oa_expense_item(id,claim_id,sort_order,expense_date,category,description,original_amount_minor,original_currency,reimbursement_amount_minor,fx_rate,fx_rate_date,fx_source)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(i.id,id,index,i.expenseDate,i.category,i.description,i.originalMinor,i.originalCurrency,i.reimbursementMinor,i.fx.rate,i.fx.providerDate,i.fx.source)),
        ...prepared.flatMap(i=>i.ids.map((fileId:string)=>db.prepare(`INSERT INTO oa_expense_item_document(item_id,file_id) VALUES(?,?)`).bind(i.id,fileId)))
      ];
      await db.batch(statements);
      await audit(viewer.id,action,"expense",id,{itemCount:prepared.length,reimbursementCurrency,total});
      return ok({id,itemCount:prepared.length,reimbursementMinor:total},201);
    }

    if (action === "createExpense") {
      const expenseDate = date(body.expenseDate);
      const originalCurrency = normalizeCurrency(body.originalCurrency);
      const employee = await ensureEmployee(viewer.id);
      const reimbursementCurrency = normalizeCurrency(body.reimbursementCurrency || employee?.reimbursement_currency || "SGD");
      const originalMinor = majorToMinor(body.amount, originalCurrency);
      if (originalMinor <= 0) return fail("Amount must be greater than zero");
      const fx = await getFxQuote(originalCurrency,reimbursementCurrency,expenseDate);
      const reimbursementMinor = convertMinor(originalMinor,originalCurrency,reimbursementCurrency,fx.rate);
      const fileId = text(body.receiptFileId,100)||null;
      if (fileId) {
        const file=await one<{owner_user_id:string}>(`SELECT owner_user_id FROM oa_file WHERE id=?`,[fileId]);
        if (!file || file.owner_user_id!==viewer.id) return fail("Invalid receipt");
      }
      const id=crypto.randomUUID();
      await run(
        `INSERT INTO oa_expense_claim(id,user_id,expense_date,category,description,original_amount_minor,original_currency,reimbursement_currency,fx_rate,fx_rate_date,fx_source,reimbursement_amount_minor,receipt_file_id)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id,viewer.id,expenseDate,text(body.category,100)||"Other",text(body.description,2000),originalMinor,originalCurrency,reimbursementCurrency,fx.rate,fx.providerDate,fx.source,reimbursementMinor,fileId],
      );
      await audit(viewer.id,action,"expense",id,{originalCurrency,reimbursementCurrency,fx});
      return ok({id,originalMinor,reimbursementMinor,fx},201);
    }

    if (action === "cancelExpense") {
      const id=text(body.id,100);
      const result=await run(`UPDATE oa_expense_claim SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND status='submitted'`,[id,viewer.id]);
      if (!result.meta?.changes) return fail("Expense cannot be cancelled",409);
      await audit(viewer.id,action,"expense",id); return ok({cancelled:true});
    }

    if (["approveLeave","rejectLeave"].includes(action)) {
      const id=text(body.id,100);
      const row=await one<{user_id:string;status:string}>(`SELECT user_id,status FROM oa_leave_request WHERE id=?`,[id]);
      if (!row) return fail("Leave request not found",404);
      if (!(await canManage(viewer.id,row.user_id,admin))) return fail("Forbidden",403);
      if (row.status!=="submitted") return fail("Leave request is no longer pending",409);
      const status=action==="approveLeave"?"approved":"rejected";
      await run(`UPDATE oa_leave_request SET status=?,decided_at=CURRENT_TIMESTAMP,decided_by=?,decision_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,[status,viewer.id,text(body.note,1000)||null,id]);
      await audit(viewer.id,action,"leave",id); return ok({status});
    }

    if (["approveExpense","rejectExpense"].includes(action)) {
      const id=text(body.id,100);
      const row=await one<{user_id:string;status:string}>(`SELECT user_id,status FROM oa_expense_claim WHERE id=?`,[id]);
      if (!row) return fail("Expense not found",404);
      if (!(await canManage(viewer.id,row.user_id,admin))) return fail("Forbidden",403);
      if (row.status!=="submitted") return fail("Expense is no longer pending",409);
      const status=action==="approveExpense"?"approved":"rejected";
      await run(`UPDATE oa_expense_claim SET status=?,decided_at=CURRENT_TIMESTAMP,decided_by=?,decision_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,[status,viewer.id,text(body.note,1000)||null,id]);
      await audit(viewer.id,action,"expense",id); return ok({status});
    }

    if (action === "markExpensePaid") {
      if (!admin) return fail("Forbidden",403);
      const id=text(body.id,100);
      const result=await run(`UPDATE oa_expense_claim SET status='paid',paid_at=CURRENT_TIMESTAMP,paid_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='approved'`,[viewer.id,id]);
      if (!result.meta?.changes) return fail("Only approved expenses can be paid",409);
      await audit(viewer.id,action,"expense",id); return ok({status:"paid"});
    }

    if (action === "createPayslip") {
      if (!admin) return fail("Forbidden",403);
      const userId=text(body.userId,200); if (!userId) return fail("Employee is required");
      await ensureEmployee(userId);
      const currency=normalizeCurrency(body.currency);
      const s=await settings(); const reportingCurrency=normalizeCurrency(s?.base_currency||"SGD");
      const payDate=date(body.payDate);
      const baseSalary=majorToMinor(body.baseSalary||0,currency);
      const allowances=majorToMinor(body.allowances||0,currency);
      const bonus=majorToMinor(body.bonus||0,currency);
      const commission=majorToMinor(body.commission||0,currency);
      const employeeContribution=majorToMinor(body.employeeContribution||0,currency);
      const employerContribution=majorToMinor(body.employerContribution||0,currency);
      const tax=majorToMinor(body.tax||0,currency);
      const otherDeductions=majorToMinor(body.otherDeductions||0,currency);
      const gross=baseSalary+allowances+bonus+commission;
      const net=gross-employeeContribution-tax-otherDeductions;
      if (net<0) return fail("Net salary cannot be negative");
      const fx=await getFxQuote(currency,reportingCurrency,payDate);
      const netReporting=convertMinor(net,currency,reportingCurrency,fx.rate);
      const attachmentId=text(body.attachmentFileId,100)||null;
      if (attachmentId) {
        const file=await one<{owner_user_id:string}>(`SELECT owner_user_id FROM oa_file WHERE id=?`,[attachmentId]);
        if (!file || file.owner_user_id!==userId) return fail("Payslip attachment must belong to the employee");
      }
      const id=crypto.randomUUID();
      await run(
        `INSERT INTO oa_payslip(id,user_id,period_start,period_end,pay_date,currency,base_salary_minor,allowances_minor,bonus_minor,commission_minor,employee_contribution_minor,employer_contribution_minor,tax_minor,other_deductions_minor,gross_minor,net_minor,reporting_currency,fx_rate_to_reporting,fx_rate_date,fx_source,net_reporting_minor,note,attachment_file_id,created_by)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id,userId,date(body.periodStart),date(body.periodEnd),payDate,currency,baseSalary,allowances,bonus,commission,employeeContribution,employerContribution,tax,otherDeductions,gross,net,reportingCurrency,fx.rate,fx.providerDate,fx.source,netReporting,text(body.note,2000)||null,attachmentId,viewer.id],
      );
      await audit(viewer.id,action,"payslip",id,{currency,reportingCurrency,fx});
      return ok({id,gross,net,netReporting,fx},201);
    }

    if (action === "publishPayslip") {
      if (!admin) return fail("Forbidden",403);
      const id=text(body.id,100);
      const result=await run(`UPDATE oa_payslip SET status='published',published_at=CURRENT_TIMESTAMP,published_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='draft'`,[viewer.id,id]);
      if (!result.meta?.changes) return fail("Only draft payslips can be published",409);
      await audit(viewer.id,action,"payslip",id); return ok({status:"published"});
    }

    if (action === "voidPayslip") {
      if (!admin) return fail("Forbidden",403);
      const id=text(body.id,100);
      await run(`UPDATE oa_payslip SET status='void',updated_at=CURRENT_TIMESTAMP WHERE id=?`,[id]);
      await audit(viewer.id,action,"payslip",id); return ok({status:"void"});
    }

    if (action === "updateSettings") {
      if (!admin) return fail("Forbidden",403);
      const baseCurrency=normalizeCurrency(body.baseCurrency||"SGD");
      const defaultLeave=Number(body.defaultAnnualLeaveDays);
      if (!Number.isFinite(defaultLeave)||defaultLeave<0||defaultLeave>365) return fail("Invalid default annual leave entitlement");
      await run(`UPDATE oa_settings SET company_name=?,base_currency=?,default_annual_leave_days=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`,[text(body.companyName,200)||"Company",baseCurrency,defaultLeave]);
      await audit(viewer.id,action,"settings","1",{baseCurrency,defaultLeave}); return ok({updated:true});
    }

    if (action === "addHoliday") {
      if (!admin) return fail("Forbidden",403);
      const holidayDate=date(body.holidayDate), name=text(body.name,200); if (!name) return fail("Holiday name is required");
      const id=crypto.randomUUID();
      await run(`INSERT INTO oa_holiday(id,holiday_date,name,created_by) VALUES(?,?,?,?) ON CONFLICT(holiday_date) DO UPDATE SET name=excluded.name,created_by=excluded.created_by`,[id,holidayDate,name,viewer.id]);
      await audit(viewer.id,action,"holiday",id,{holidayDate,name}); return ok({id});
    }

    if (action === "deleteHoliday") {
      if (!admin) return fail("Forbidden",403);
      const id=text(body.id,100); await run(`DELETE FROM oa_holiday WHERE id=?`,[id]); await audit(viewer.id,action,"holiday",id); return ok({deleted:true});
    }

    if (action === "fxQuote") {
      const fx=await getFxQuote(normalizeCurrency(body.base),normalizeCurrency(body.quote),date(body.date));
      return ok(fx);
    }

    return fail("Unknown action",404);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return fail("Unauthorized",401);
    console.error("OA POST failed",error);
    return fail(error instanceof Error ? error.message : "OA request failed",500);
  }
}
