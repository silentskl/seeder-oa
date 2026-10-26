import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/auth-server";
import { EntityAccessError, resolveBusinessEntityAccess } from "@/lib/oa/entity";
import { one, settings } from "@/lib/oa/db";
import { buildPayslipPdf } from "@/lib/oa/payslip-pdf";

export const runtime = "nodejs";

function fail(message:string,status=400){ return NextResponse.json({ok:false,error:message},{status}); }
function safe(value:unknown){ return String(value??"").replace(/[^A-Za-z0-9._-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80)||"payslip"; }
function customFields(value:unknown){
  try{
    const raw=typeof value==="string"?JSON.parse(value):value;
    if(!Array.isArray(raw)) return [];
    return raw.slice(0,20).map((x:any)=>{
      const name=String(x?.name||"").trim()||"Custom payroll item";
      if(x?.type==="contribution"||x?.type==="deduction"){
        const amount=Number(x?.amount_minor);
        return {name,type:x.type,amountMinor:Number.isSafeInteger(amount)&&amount>=0?amount:0};
      }
      return {name,type:"legacy" as const,value:String(x?.value||"").trim()};
    });
  }catch{return [];}
}

export async function GET(request:NextRequest,context:{params:Promise<{id:string}>}){
  const viewer=await getViewer(); if(!viewer) return fail("Unauthorized",401);
  let access;
  try{access=await resolveBusinessEntityAccess(viewer.id,request.nextUrl.searchParams.get("entity_id"))}
  catch(e){if(e instanceof EntityAccessError)return fail("Forbidden",e.status);throw e}
  const companyId=access.entityId;
  const {id}=await context.params;
  const row=await one<any>(
    `SELECT p.*,u.name AS current_name,u.email,
            e.employee_no AS current_employee_no,e.join_date AS current_join_date,
            e.job_title AS current_job_title,e.department AS current_department,e.salary_period AS current_salary_period
     FROM oa_payslip p JOIN user u ON u.id=p.user_id
     LEFT JOIN oa_entity_employee e ON e.user_id=p.user_id AND e.entity_id=p.entity_id
     WHERE p.id=? AND p.entity_id=?`,[id,companyId],
  );
  if(!row) return fail("Payslip not found",404);
  const admin=access.role==="admin";
  if(row.user_id!==viewer.id&&!admin) return fail("Forbidden",403);
  if(!admin&&row.status!=="published") return fail("Payslip is not published",404);
  const s=await settings(companyId);
  const employeeName=row.employee_name_snapshot||row.current_name||row.email;
  const employeeNo=row.employee_no_snapshot||row.current_employee_no||"";
  const period=String(row.period_start||"").slice(0,7);
  const pdf=buildPayslipPdf({
    companyName:String(s?.company_name||"Company"),status:String(row.status||"draft"),
    employeeName:String(employeeName||""),employeeEmail:String(row.email||""),employeeNo:String(employeeNo||""),
    joinDate:String(row.join_date_snapshot||row.current_join_date||""),jobTitle:String(row.job_title_snapshot||row.current_job_title||""),
    department:String(row.department_snapshot||row.current_department||""),salaryPeriod:String(row.salary_period_snapshot||row.current_salary_period||"monthly"),
    periodStart:String(row.period_start||""),periodEnd:String(row.period_end||""),payDate:String(row.pay_date||""),currency:String(row.currency||"SGD"),
    baseSalaryMinor:Number(row.base_salary_minor||0),allowancesMinor:Number(row.allowances_minor||0),bonusMinor:Number(row.bonus_minor||0),commissionMinor:Number(row.commission_minor||0),
    employeeContributionMinor:Number(row.employee_contribution_minor||0),employerContributionMinor:Number(row.employer_contribution_minor||0),taxMinor:Number(row.tax_minor||0),otherDeductionsMinor:Number(row.other_deductions_minor||0),
    grossMinor:Number(row.gross_minor||0),netMinor:Number(row.net_minor||0),reportingCurrency:String(row.reporting_currency||row.currency||"SGD"),netReportingMinor:Number(row.net_reporting_minor||0),
    fxRate:Number(row.fx_rate_to_reporting||1),fxRateDate:String(row.fx_rate_date||""),fxSource:String(row.fx_source||""),note:String(row.note||""),customItems:customFields(row.custom_fields_json),
  });
  const filename=`payslip-${safe(employeeNo||employeeName)}-${safe(period||row.pay_date)}.pdf`;
  const body=pdf.buffer.slice(pdf.byteOffset,pdf.byteOffset+pdf.byteLength) as ArrayBuffer;
  return new Response(body,{headers:{"content-type":"application/pdf","content-disposition":`attachment; filename="${filename}"`,"cache-control":"private, no-store"}});
}
