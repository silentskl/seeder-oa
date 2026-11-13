import {NextRequest,NextResponse} from "next/server";
import {getOaEnv} from "@/lib/oa/env";
import {dueMailAccounts,syncMailAccount} from "@/lib/oa/finance-mail-sync";
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
 return NextResponse.json({ok:true,processedAccounts:results.length,results});
}
