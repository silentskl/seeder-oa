#!/usr/bin/env node
// Read-only, black-box two-company API isolation smoke test.
// Run ONLY against a disposable staging environment with separate A-only/B-only users.
// Never prints cookies, response bodies or employee/private records.
const env=process.env;
const required=["PHASE4_BASE_URL","PHASE4_ENTITY_A","PHASE4_ENTITY_B","PHASE4_USER_A_COOKIE","PHASE4_USER_B_COOKIE","PHASE4_FILE_B","PHASE4_PAYSLIP_B"];
const missing=required.filter(k=>!env[k]);
if(missing.length){console.error("Missing fixture parameters: "+missing.join(", "));process.exit(2)}
const base=new URL(env.PHASE4_BASE_URL);
if(base.protocol!=="https:" || /^(oa\.smartenx\.com|www\.oa\.smartenx\.com)$/i.test(base.hostname)){
  console.error("Phase 4 checks require HTTPS staging, never production oa.smartenx.com");process.exit(2)
}
const [a,b]=[env.PHASE4_ENTITY_A,env.PHASE4_ENTITY_B];
if(a===b){console.error("Two distinct Entity IDs required");process.exit(2)}
let failures=0,checks=0;
async function fetchAs(cookie,path){
  const u=new URL(path,base);
  return fetch(u,{headers:{Cookie:cookie,Accept:"application/json"},redirect:"manual"});
}
async function assert(label,expected,fn){
  checks++;
  try{
    const status=await fn();
    const good=expected.includes(status);
    console.log((good?"PASS":"FAIL")+" "+label+" (HTTP "+status+")");
    if(!good)failures++;
  }catch(e){
    failures++;console.error("FAIL "+label+" (transport error: "+(e instanceof Error?e.message:"unknown")+")");
  }
}
const resource=["bootstrap","leave","expenses","payslips","approvals","expenseHistory","employees","admin-payslips","settings","expenseCategories"];
// An active A-only user MUST NOT be allowed to select B; vice versa.
// Resource responses may be 200/403 for legitimate own-company calls depending on role,
// but never unauthorized redirects or 500.
for(const resourceName of resource){
  const url=id=>'/api/oa?resource='+encodeURIComponent(resourceName)+'&entity_id='+encodeURIComponent(id);
  await assert("A-only denied B /"+resourceName,[403,404],async()=> (await fetchAs(env.PHASE4_USER_A_COOKIE,url(b))).status);
  await assert("B-only denied A /"+resourceName,[403,404],async()=> (await fetchAs(env.PHASE4_USER_B_COOKIE,url(a))).status);
}
await assert("A reads own bootstrap",[200],async()=> (await fetchAs(env.PHASE4_USER_A_COOKIE,'/api/oa?resource=bootstrap&entity_id='+encodeURIComponent(a))).status);
await assert("B reads own bootstrap",[200],async()=> (await fetchAs(env.PHASE4_USER_B_COOKIE,'/api/oa?resource=bootstrap&entity_id='+encodeURIComponent(b))).status);
await assert("A denied B PDF direct download",[403,404],async()=> (await fetchAs(env.PHASE4_USER_A_COOKIE,'/api/oa/payslips/'+encodeURIComponent(env.PHASE4_PAYSLIP_B)+'/pdf?entity_id='+encodeURIComponent(a))).status);
await assert("A denied B R2 attachment via guessed file ID",[403,404],async()=> (await fetchAs(env.PHASE4_USER_A_COOKIE,'/api/oa/files/'+encodeURIComponent(env.PHASE4_FILE_B)+'?entity_id='+encodeURIComponent(a))).status);
await assert("A cannot select B for PDF",[403,404],async()=> (await fetchAs(env.PHASE4_USER_A_COOKIE,'/api/oa/payslips/'+encodeURIComponent(env.PHASE4_PAYSLIP_B)+'/pdf?entity_id='+encodeURIComponent(b))).status);
await assert("A cannot select B for attachment",[403,404],async()=> (await fetchAs(env.PHASE4_USER_A_COOKIE,'/api/oa/files/'+encodeURIComponent(env.PHASE4_FILE_B)+'?entity_id='+encodeURIComponent(b))).status);
await assert("A cannot download PDF without authentication",[401],async()=> (await fetchAs("","/api/oa/payslips/"+encodeURIComponent(env.PHASE4_PAYSLIP_B)+"/pdf?entity_id="+encodeURIComponent(b))).status);
await assert("A cannot download attachment without authentication",[401],async()=> (await fetchAs("","/api/oa/files/"+encodeURIComponent(env.PHASE4_FILE_B)+"?entity_id="+encodeURIComponent(b))).status);
console.log("Phase4 read-only checks: "+(checks-failures)+"/"+checks+" passed.");
if(failures)process.exit(1);
console.log("Black-box read isolation passed; mutation, notifications, medical allowance and migration regression suites are separately required.");
