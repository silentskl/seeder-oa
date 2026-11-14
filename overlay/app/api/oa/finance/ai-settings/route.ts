import {NextRequest,NextResponse} from "next/server";
import {getViewer} from "@/lib/auth-server";
import {resolveFinanceEntityAccess} from "@/lib/oa/finance-entity";
import {EntityAccessError} from "@/lib/oa/entity";
import {one,run,audit} from "@/lib/oa/db";
import {encryptEmailSecret} from "@/lib/oa/email";
import {getOaEnv} from "@/lib/oa/env";
import {
 financeAiSettings,publicFinanceAiSettings,testFinanceAiConnection,recentFinanceAiCalls,FinanceAiError,
 validateFinanceAiBaseUrl,validateFinanceAiModel,validateFinanceAiProtocol,validateFinanceAiEffort
} from "@/lib/oa/finance-ai";

export const runtime="nodejs";
const fail=(message:string,status=400)=>NextResponse.json({ok:false,error:message},{status});
async function authorize(entityId:unknown){
 const viewer=await getViewer();
 if(!viewer)return {error:fail("Unauthorized",401)};
 const access=await resolveFinanceEntityAccess(viewer.id,entityId);
 if(access.role!=="admin")return {error:fail("Company finance administrator required",403)};
 return {userId:viewer.id,entityId:access.entityId};
}
function safeFailure(error:unknown){
 if(error instanceof EntityAccessError)return fail(error.message,error.status);
 const message=error instanceof Error?error.message:"AI configuration failed";
 if(error instanceof FinanceAiError)return NextResponse.json({ok:false,error:message,diagnostic:error.diagnostic},{status:422});
 if(/^(Invalid|Base URL|AI Base|AI gateway|AI API|Enable|PDF invoice|Missing|Model)/.test(message))
  return fail(message,400);
 console.error("Company finance AI settings operation failed",message);
 return fail("AI configuration or connection failed",500);
}
export async function GET(request:NextRequest){
 try{
  const a=await authorize(request.nextUrl.searchParams.get("entity_id"));
  if(a.error)return a.error;
  const [settings,calls]=await Promise.all([publicFinanceAiSettings(a.entityId!),recentFinanceAiCalls(a.entityId!,null,8)]);
  return NextResponse.json({ok:true,data:{...settings,calls}});
 }catch(error){return safeFailure(error);}
}
export async function POST(request:NextRequest){
 try{
  const body=await request.json() as Record<string,unknown>;
  const a=await authorize(body.entity_id);
  if(a.error)return a.error;
  const entityId=a.entityId!,userId=a.userId!,action=String(body.action||"");
  if(action==="test"){
   return NextResponse.json({ok:true,data:await testFinanceAiConnection(entityId)});
  }
  if(action!=="save")return fail("Unknown AI configuration action",404);
  if(!getOaEnv().settingsMasterKey)return fail("OA_SETTINGS_MASTER_KEY is required to encrypt the AI API Key",503);
  const base=validateFinanceAiBaseUrl(body.base_url);
  const model=validateFinanceAiModel(body.model_name);
  const protocol=validateFinanceAiProtocol(body.protocol);
  const effort=validateFinanceAiEffort(body.reasoning_effort??"auto");
  const enabled=body.enabled===true?1:0;
  const key=typeof body.api_key==="string"?body.api_key.trim():"";
  if(key.length>4096)throw new Error("AI API Key is too long");
  const previous=await financeAiSettings(entityId);
  if(!key&&!previous?.api_key_encrypted)return fail("AI API Key is required on first save");
  const encrypted=key?await encryptEmailSecret(key):previous!.api_key_encrypted;
  await run(
   "INSERT INTO oa_finance_ai_settings(entity_id,base_url,model_name,protocol,reasoning_effort,api_key_encrypted,enabled,updated_by) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(entity_id) DO UPDATE SET base_url=excluded.base_url,model_name=excluded.model_name,protocol=excluded.protocol,reasoning_effort=excluded.reasoning_effort,api_key_encrypted=excluded.api_key_encrypted,enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP",
   [entityId,base,model,protocol,effort,encrypted,enabled,userId]
  );
  await audit(userId,"finance.ai.settings.update","finance_ai_settings",entityId,
   {baseUrl:base,model,protocol,effort,enabled:!!enabled,keyRotated:!!key},entityId);
  return NextResponse.json({ok:true,data:await publicFinanceAiSettings(entityId)});
 }catch(error){return safeFailure(error);}
}
