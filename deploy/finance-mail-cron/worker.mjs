/**
 * A standalone Cloudflare Worker: it does not change the existing smarten-oa Worker.
 * Set OA_FINANCE_SYNC_TOKEN on BOTH workers to exactly the same 32+ character secret.
 */
export default {
 async scheduled(_event,env,ctx){
  ctx.waitUntil((async()=>{
   const address=env.OA_FINANCE_SYNC_URL||"https://oa.smartenx.com/api/oa/finance/sync-job";
   const url=new URL(address);
   if(url.protocol!=="https:"||!url.pathname.endsWith("/api/oa/finance/sync-job"))
    throw new Error("Invalid finance sync endpoint");
   if(!env.OA_FINANCE_SYNC_TOKEN||env.OA_FINANCE_SYNC_TOKEN.length<32)
    throw new Error("OA_FINANCE_SYNC_TOKEN is missing/too short");
   const response=await fetch(url.toString(),{
    method:"POST",headers:{"x-oa-finance-sync-token":env.OA_FINANCE_SYNC_TOKEN},
    // Cloudflare Workers only accepts redirect:"manual" or "follow".
    // Do not forward the scheduler secret to any redirect destination.
    redirect:"manual",signal:AbortSignal.timeout(240000)
   });
   if(response.status>=300&&response.status<400)throw new Error("Finance mail sync endpoint returned an unexpected redirect HTTP "+response.status);
   if(!response.ok)throw new Error("Finance mail sync job HTTP "+response.status);
   const result=await response.json();
   console.log("Finance mailbox job",JSON.stringify({processedAccounts:result.processedAccounts,ok:result.ok}));
  })());
 }
};
