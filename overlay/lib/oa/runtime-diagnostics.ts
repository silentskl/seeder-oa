// Server-only diagnostics: never log SQL bind values, cookies, headers or financial records.
type ErrorInfo={name:string;category:string;digest?:string;schemaObject?:string;frames:string[]};
export function describeOaError(error:unknown):ErrorInfo{
 const e=error instanceof Error?error:null;
 const message=e?.message||"";
 const cause=e?.cause instanceof Error?e.cause.message:"";
 const text=message+"\n"+cause;
 const schema=text.match(/(?:no such table|no such column|has no column named)\s*:?\s*([a-zA-Z_][a-zA-Z0-9_.]{0,100})/i);
 let category="unknown";
 if(/promise was created by a request|handle_cross_request_promise_resolution/i.test(text))category="cross_request_promise";
 else if(/Cannot perform I\/O on behalf of a different request/i.test(text))category="cross_request_io";
 else if(schema)category="schema_missing";
 else if(/SQLITE_BUSY|database is locked/i.test(text))category="database_busy";
 else if(/D1_ERROR|D1_EXEC_ERROR|SQLITE_/i.test(text))category="database_error";
 else if(/timeout|timed out|deadline exceeded/i.test(text))category="timeout";
 else if(/getCloudflareContext|outside a request scope/i.test(text))category="request_context";
 const rawDigest=e?(e as Error & {digest?:unknown}).digest:undefined;
 const digest=typeof rawDigest==="string"&&/^\d{1,30}$/.test(rawDigest)?rawDigest:undefined;
 const name=e&&/^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(e.name)?e.name:"Error";
 // Stack frames only; strip message lines (which may contain SQL or parameters).
 const frames=(e?.stack||"").split("\n").filter(x=>/^\s+at\s/.test(x)).slice(0,10).map(x=>x.trim().replace(/\?[^ )]*/g,"?[redacted]").slice(0,350));
 return {name,category,digest,schemaObject:schema?.[1],frames};
}
export function logOaFailure(stage:string,error:unknown,context:Record<string,string|number|undefined>={}){
 console.error("[OA_RUNTIME]",JSON.stringify({event:"failure",stage,...context,...describeOaError(error)}));
}
export async function navigationCheck<T>(stage:string,task:()=>Promise<T>,fallback:T,reference:string):Promise<{value:T;failed:boolean}>{
 try{return {value:await task(),failed:false};}
 catch(error){logOaFailure(stage,error,{reference});return {value:fallback,failed:true};}
}
export function queryTarget(sql:string){
 const match=sql.match(/\b(?:FROM|INTO|UPDATE)\s+([a-zA-Z_][a-zA-Z0-9_]{0,90})/i);
 return match?.[1]||"unknown";
}
