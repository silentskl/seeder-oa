import {NextRequest,NextResponse} from "next/server";
import {getOaEnv} from "@/lib/oa/env";
import {dueMailAccounts,syncMailAccount} from "@/lib/oa/finance-mail-sync";
import {dueMailBackfills,processMailBackfill} from "@/lib/oa/finance-mail-backfill";
export const runtime="nodejs";
function failure(status:number){return NextResponse.json({ok:false,error:status===401?"Unauthorized":"Finance sync not configured"},{status});}
async function equalKey(a:string,b:string){
 const encoder=new TextEncoder();
 const [x,y]=await Promise.all([crypto.subtle.digest("SHA-256",encoder.encode(a)),crypto.subtle.digest("SHA-256",encoder.encode(b))]);
 const left=new Uint8Array(x),right=new Uint8Array(y);
 let different=0;for(let i=0;i<left.length;i++)different|=left[i]^right[i];
 return different===0;
}
export async function POST(request:NextRequest){
 const secret=getOaEnv().financeSyncToken;
 if(!secret||secret.length<32)return failure(503);
 const provided=request.headers.get("x-oa-finance-sync-token")||"";
 if(!provided||!await equalKey(provided,secret))return failure(401);
 const accounts=await dueMailAccounts(6);
 const results:Array<{accountId:string;entityId:string;status:"success"|"error";imported?:number}>=[];
 for(const account of accounts){
  try{
   const result=await syncMailAccount(account);
   results.push({accountId:account.id,entityId:account.entity_id,status:"success",imported:result.imported});
  }catch(error){
   console.error("Finance scheduled mailbox sync failed",{accountId:account.id,error:error instanceof Error?error.message:"unknown"});
   results.push({accountId:account.id,entityId:account.entity_id,status:"error"});
  }
 }
 // One durable history batch per invocation. Each run saves a continuation
 // checkpoint; incremental sync remains separate and keeps its last_success_at.
 const backfills=await dueMailBackfills(1);
 const historyResults:Array<{id:string;status:string;processed:number}>=[];
 for(const job of backfills){
  try{
   const result=await processMailBackfill(job.id,job.entity_id);
   historyResults.push({id:job.id,status:result.status,processed:result.processed});
  }catch(error){
   console.error("Finance backfill scheduler failed",{jobId:job.id,error:error instanceof Error?error.name:"unknown"});
   historyResults.push({id:job.id,status:"error",processed:0});
  }
 }
 return NextResponse.json({ok:true,processedAccounts:results.length,results,processedBackfills:historyResults});
}
