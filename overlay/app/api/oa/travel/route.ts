import {NextRequest,NextResponse} from "next/server";
import {getViewer} from "@/lib/auth-server";
import {all,one,run,settings,audit} from "@/lib/oa/db";
import {EntityAccessError,resolveBusinessEntityAccess} from "@/lib/oa/entity";
import {getOaEnv} from "@/lib/oa/env";
import {majorToMinor,normalizeCurrency} from "@/lib/oa/money";
import {normalizeApprovalFlow} from "@/lib/oa/approval";
export const runtime="nodejs";
const ok=(data:unknown,status=200)=>NextResponse.json({ok:true,data},{status});
const fail=(error:string,status=400)=>NextResponse.json({ok:false,error},{status});
const str=(v:unknown,max=255)=>String(v??"").trim().slice(0,max);
function datetime(v:unknown,label:string){
  const x=str(v,20);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(x)||Number.isNaN(Date.parse(x)))throw new Error(label+" needs a valid date and time");
  return x;
}
function nightsBetween(a:string,b:string){
  return Math.round((Date.parse(b.slice(0,10)+"T00:00:00Z")-Date.parse(a.slice(0,10)+"T00:00:00Z"))/86400000);
}
function parseItems(input:unknown,currency:string){
  if(!Array.isArray(input)||input.length<1||input.length>50)throw new Error("Add 1 to 50 budget items");
  return input.map((x:any,i:number)=>{
    const type=str(x?.type,10);
    if(!["flight","hotel","other"].includes(type))throw new Error("Invalid item type");
    const name=str(x?.itemName,200),description=str(x?.description,1000);
    if(!name)throw new Error(`Row ${i+1}: flight number, hotel name or project name required`);
    if(type==="other"&&!description)throw new Error(`Row ${i+1}: description required`);
    if(x?.amount==null||str(x.amount,100)==="")throw new Error(`Row ${i+1}: amount required`);
    const amount=majorToMinor(x.amount,currency);
    if(amount<=0)throw new Error(`Row ${i+1}: amount must be positive`);
    const depart=type==="flight"?datetime(x.departureAt,`Row ${i+1} departure`):null;
    const arrive=type==="flight"?datetime(x.arrivalAt,`Row ${i+1} arrival`):null;
    const checkin=type==="hotel"?datetime(x.checkInAt,`Row ${i+1} check-in`):null;
    const checkout=type==="hotel"?datetime(x.checkOutAt,`Row ${i+1} check-out`):null;
    let nights:number|null=null;
    if(checkin&&checkout){
      const expected=nightsBetween(checkin,checkout);
      nights=Number(x.nights);
      if(checkout<=checkin||expected<1||!Number.isInteger(nights)||nights!==expected)
        throw new Error(`Row ${i+1}: hotel nights must match check-in/out dates (${expected})`);
    }
    // Arrival and departure are local times at different airports; timezone ordering is not comparable.
    return {id:crypto.randomUUID(),type,name,description,depart,arrive,checkin,checkout,nights,amount};
  });
}
async function withItems<T extends {id:string}>(records:T[],entity:string){
  if(!records.length)return [];
  const sql=`SELECT * FROM oa_travel_budget_item WHERE entity_id=? AND application_id IN (${records.map(()=>"?").join(",")}) ORDER BY application_id,sort_order`;
  const items=await all<any>(sql,[entity,...records.map(x=>x.id)]);
  return records.map(r=>({...r,items:items.filter(i=>i.application_id===r.id)}));
}
export async function GET(request:NextRequest){
  try{
    const viewer=await getViewer();if(!viewer)return fail("Unauthorized",401);
    const access=await resolveBusinessEntityAccess(viewer.id,request.nextUrl.searchParams.get("entity_id"));
    const entity=access.entityId,scope=request.nextUrl.searchParams.get("scope")||"mine";
    if(scope==="mine"){
      const rows=await all<any>(`SELECT a.*,u.name,u.email,e.employee_no,e.department,e.job_title
        FROM oa_travel_application a JOIN user u ON u.id=a.user_id
        LEFT JOIN oa_entity_employee e ON e.entity_id=a.entity_id AND e.user_id=a.user_id
        WHERE a.entity_id=? AND a.user_id=? ORDER BY a.submitted_at DESC,a.id DESC LIMIT 100`,[entity,viewer.id]);
      return ok(await withItems(rows,entity));
    }
    if(scope==="approvals"){
      const rows=await all<any>(`SELECT a.*,u.name,u.email,e.employee_no,e.department,e.job_title,
          s.step_no,s.approver_type
        FROM oa_travel_approval_step s
        JOIN oa_travel_application a ON a.id=s.application_id AND a.entity_id=s.entity_id
        JOIN user u ON u.id=a.user_id
        LEFT JOIN oa_entity_employee e ON e.entity_id=a.entity_id AND e.user_id=a.user_id
        WHERE a.entity_id=? AND a.status='submitted' AND s.status='pending'
          AND (?=1 OR (s.approver_type='manager' AND s.assigned_user_id=?))
        ORDER BY a.submitted_at LIMIT 100`,[entity,access.role==="admin"?1:0,viewer.id]);
      return ok(await withItems(rows,entity));
    }
    return fail("Unknown travel resource",404);
  }catch(e){if(e instanceof EntityAccessError)return fail(e.message,e.status);console.error("Travel GET failed",e);return fail("Travel request unavailable",500);}
}
export async function POST(request:NextRequest){
  try{
    const viewer=await getViewer();if(!viewer)return fail("Unauthorized",401);
    const body=await request.json() as Record<string,any>;
    const access=await resolveBusinessEntityAccess(viewer.id,body.entity_id);
    const entity=access.entityId,action=str(body.action,40);
    if(action==="create"){
      const destination=str(body.destination,200),purpose=str(body.purpose,2000);
      if(!destination||!purpose)return fail("Destination and business purpose are required");
      const currency=normalizeCurrency(body.currency||"SGD"),items=parseItems(body.items,currency);
      const total=items.reduce((s,x)=>s+x.amount,0);
      if(!Number.isSafeInteger(total)||total<=0)return fail("Invalid total budget");
      const employee=await one<{manager_user_id:string|null}>(`SELECT manager_user_id FROM oa_entity_employee WHERE entity_id=? AND user_id=? AND active=1`,[entity,viewer.id]);
      if(!employee)return fail("Active employee profile not found",403);
      const flow=normalizeApprovalFlow((await settings(entity))?.expense_approval_flow);
      const manager=employee.manager_user_id&&employee.manager_user_id!==viewer.id
        ?await one<{user_id:string}>(`SELECT user_id FROM oa_entity_member WHERE entity_id=? AND user_id=? AND active=1`,[entity,employee.manager_user_id]):null;
      const steps:Array<{type:"manager"|"admin";user:string|null}>=[];
      if(flow==="admin")steps.push({type:"admin",user:null});
      else if(flow==="manager")steps.push(manager?{type:"manager",user:manager.user_id}:{type:"admin",user:null});
      else{if(manager)steps.push({type:"manager",user:manager.user_id});steps.push({type:"admin",user:null});}
      const id=crypto.randomUUID(),db=getOaEnv().db;
      await db.batch([
        db.prepare(`INSERT INTO oa_travel_application(id,entity_id,user_id,destination,purpose,currency,total_amount_minor) VALUES(?,?,?,?,?,?,?)`)
          .bind(id,entity,viewer.id,destination,purpose,currency,total),
        ...items.map((x,i)=>db.prepare(`INSERT INTO oa_travel_budget_item(id,entity_id,application_id,sort_order,type,item_name,description,departure_at,arrival_at,check_in_at,check_out_at,nights,amount_minor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(x.id,entity,id,i,x.type,x.name,x.description||null,x.depart,x.arrive,x.checkin,x.checkout,x.nights,x.amount)),
        ...steps.map((step,i)=>db.prepare(`INSERT INTO oa_travel_approval_step(id,entity_id,application_id,step_no,approver_type,assigned_user_id,status) VALUES(?,?,?,?,?,?,?)`)
          .bind(crypto.randomUUID(),entity,id,i+1,step.type,step.user,i===0?"pending":"waiting"))
      ]);
      await audit(viewer.id,"createTravelApplication","travel",id,{itemCount:items.length,total,currency},entity);
      return ok({id,total,currency},201);
    }
    const id=str(body.id,100);if(!id)return fail("Application ID required");
    if(action==="cancel"){
      const r=await run(`UPDATE oa_travel_application SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND entity_id=? AND user_id=? AND status='submitted'`,[id,entity,viewer.id]);
      if(!r.meta?.changes)return fail("Only your pending travel application can be cancelled",409);
      await run(`UPDATE oa_travel_approval_step SET status='skipped' WHERE application_id=? AND entity_id=? AND status IN ('pending','waiting')`,[id,entity]);
      await audit(viewer.id,"cancelTravelApplication","travel",id,null,entity);
      return ok({status:"cancelled"});
    }
    if(action==="approve"||action==="reject"){
      const row=await one<{status:string}>(`SELECT status FROM oa_travel_application WHERE id=? AND entity_id=?`,[id,entity]);
      if(!row)return fail("Application not found",404);
      if(row.status!=="submitted")return fail("Application is no longer pending",409);
      const step=await one<{id:string;step_no:number;approver_type:string;assigned_user_id:string|null}>(`SELECT id,step_no,approver_type,assigned_user_id FROM oa_travel_approval_step WHERE application_id=? AND entity_id=? AND status='pending' ORDER BY step_no LIMIT 1`,[id,entity]);
      if(!step)return fail("No pending approval step",409);
      if(access.role!=="admin"&&(step.approver_type!=="manager"||step.assigned_user_id!==viewer.id))return fail("Forbidden",403);
      const note=str(body.note,1000)||null;
      const r=await run(`UPDATE oa_travel_approval_step SET status=?,decided_at=CURRENT_TIMESTAMP,decided_by=?,note=? WHERE id=? AND entity_id=? AND status='pending'`,[action==="reject"?"rejected":"approved",viewer.id,note,step.id,entity]);
      if(!r.meta?.changes)return fail("Approval step already changed",409);
      if(action==="reject"){
        await run(`UPDATE oa_travel_approval_step SET status='skipped' WHERE application_id=? AND entity_id=? AND status='waiting'`,[id,entity]);
        await run(`UPDATE oa_travel_application SET status='rejected',decided_at=CURRENT_TIMESTAMP,decided_by=?,decision_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND entity_id=? AND status='submitted'`,[viewer.id,note,id,entity]);
        await audit(viewer.id,"rejectTravelApplication","travel",id,{step:step.step_no},entity);
        return ok({status:"rejected",complete:true});
      }
      const next=await one<{id:string}>(`SELECT id FROM oa_travel_approval_step WHERE application_id=? AND entity_id=? AND status='waiting' ORDER BY step_no LIMIT 1`,[id,entity]);
      if(next)await run(`UPDATE oa_travel_approval_step SET status='pending' WHERE id=? AND entity_id=? AND status='waiting'`,[next.id,entity]);
      else await run(`UPDATE oa_travel_application SET status='approved',decided_at=CURRENT_TIMESTAMP,decided_by=?,decision_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND entity_id=? AND status='submitted'`,[viewer.id,note,id,entity]);
      await audit(viewer.id,"approveTravelApplication","travel",id,{step:step.step_no,complete:!next},entity);
      return ok({status:next?"submitted":"approved",complete:!next});
    }
    return fail("Unknown travel action",404);
  }catch(e){
    if(e instanceof EntityAccessError)return fail(e.message,e.status);
    const msg=e instanceof Error?e.message:"Travel request failed";
    if(/^(Invalid|Add 1|Row |Amount is|Destination)/.test(msg))return fail(msg);
    console.error("Travel POST failed",e);
    return fail(msg,500);
  }
}
