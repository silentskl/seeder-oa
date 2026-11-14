// Replaces the independent Cloudflare cron Worker. No public scheduler port.
const url=process.env.OA_FINANCE_SYNC_URL||"http://app:3000/api/oa/finance/sync-job";
const token=process.env.OA_FINANCE_SYNC_TOKEN||"";
const seconds=Number(process.env.OA_FINANCE_SYNC_INTERVAL_SECONDS||300);
if(token.length<32)throw new Error("OA_FINANCE_SYNC_TOKEN must be >=32 characters");
if(!Number.isInteger(seconds)||seconds<60)throw new Error("Invalid scheduler interval");
const parsed=new URL(url);
if(!["http:","https:"].includes(parsed.protocol)||!parsed.pathname.endsWith("/api/oa/finance/sync-job"))throw new Error("Invalid scheduler endpoint");
let stop=false;
process.once("SIGTERM",()=>{stop=true;});
process.once("SIGINT",()=>{stop=true;});
async function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function poll(){
 const response=await fetch(url,{
  method:"POST",headers:{"x-oa-finance-sync-token":token},
  redirect:"manual",signal:AbortSignal.timeout(240000)
 });
 if(!response.ok)throw new Error("Finance sync HTTP "+response.status);
 const body=await response.json();
 if(body.ok!==true)throw new Error("Finance sync returned failure");
 console.log(new Date().toISOString(),"mail sync",JSON.stringify({
  processedAccounts:body.processedAccounts,processedBackfills:body.processedBackfills?.length
 }));
}
while(!stop){
 const started=Date.now();
 try{await poll();}catch(error){console.error(new Date().toISOString(),"mail sync failed",String(error));}
 while(!stop&&Date.now()-started<seconds*1000)await sleep(Math.min(1000,seconds*1000-(Date.now()-started)));
}
