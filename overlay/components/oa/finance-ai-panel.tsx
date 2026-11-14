"use client";

import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";

type AiSettings={
 base_url:string;model_name:string;protocol:"responses"|"chat_completions";reasoning_effort:"auto"|"none"|"low"|"medium"|"high";
 enabled:boolean;api_key_configured:boolean;legacy_environment_configured:boolean;
 settings_master_key_configured:boolean;updated_at:string|null;
};
type AiCall={id:string;operation:string;model:string;protocol:string;outcome:string;http_status:number|null;response_status:string;finish_reason:string;output_types:string;duration_ms:number;input_tokens:number|null;output_tokens:number|null;reasoning_tokens:number|null;output_chars:number;request_id:string;error_code:string;created_at:string};
const fields="w-full rounded-md border border-neutral-300 bg-white p-2 text-sm dark:border-neutral-700 dark:bg-neutral-950";
const button="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium disabled:opacity-40 dark:border-neutral-700";
const empty:AiSettings={base_url:"",model_name:"",protocol:"responses",reasoning_effort:"auto",enabled:false,api_key_configured:false,legacy_environment_configured:false,settings_master_key_configured:false,updated_at:null};

export function FinanceAiPanel({entityId}:{entityId:string}){
 const [settings,setSettings]=useState<AiSettings>({...empty});
 const [apiKey,setApiKey]=useState("");
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [phase,setPhase]=useState<"idle"|"saving"|"testing">("idle");
 const [calls,setCalls]=useState<AiCall[]>([]);
 const [error,setError]=useState(""),[notice,setNotice]=useState("");
 const version=useRef(0);
 const load=useCallback(async()=>{
  const seq=++version.current;
  const r=await fetch("/api/oa/finance/ai-settings?entity_id="+encodeURIComponent(entityId),{cache:"no-store"});
  const result=await r.json().catch(()=>null);
  if(!r.ok||!result?.ok)throw new Error(result?.error||"Cannot load invoice AI settings");
  if(seq!==version.current)return;
  setSettings(result.data);setCalls(result.data.calls||[]);
 },[entityId]);
 useEffect(()=>{
  let active=true;
  const refreshCalls=()=>{
   void (async()=>{
    const response=await fetch("/api/oa/finance/ai-settings?entity_id="+encodeURIComponent(entityId),{cache:"no-store"});
    const result=await response.json().catch(()=>null);
    if(active&&response.ok&&result?.ok)setCalls(result.data.calls||[]);
   })().catch(()=>{ /* Main invoice view displays server errors. */ });
  };
  window.addEventListener("finance-ai-call-updated",refreshCalls);
  return ()=>{active=false;window.removeEventListener("finance-ai-call-updated",refreshCalls);};
 },[entityId]);
 useEffect(()=>{
  let active=true;
  version.current++;
  setSettings({...empty});setApiKey("");setError("");setNotice("");setCalls([]);setLoading(true);
  void load().catch(e=>{if(active)setError(String(e instanceof Error?e.message:e));}).finally(()=>{if(active)setLoading(false);});
  return ()=>{active=false;version.current++;};
 },[load]);
 async function post(action:string,data:Record<string,unknown>={}){
  const r=await fetch("/api/oa/finance/ai-settings",{
   method:"POST",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({action,entity_id:entityId,...data})
  });
  const result=await r.json().catch(()=>null);
  if(!r.ok||!result?.ok){
   const d=result?.diagnostic;
   throw new Error((result?.error||"Invoice AI request failed")+(d?" · HTTP "+(d.http_status??"—")+" · status "+(d.response_status||d.outcome)+" · output tokens "+(d.output_tokens??"—")+" · reasoning "+(d.reasoning_tokens??"—")+" · "+(d.finish_reason||d.error_code||"")+" · request "+(d.request_id||"—"):""));
  }
  return result.data;
 }
 async function perform(action:"saving"|"testing",work:()=>Promise<void>){
  setBusy(true);setPhase(action);setError("");setNotice("");
  try{await work();}
  catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setBusy(false);setPhase("idle");}
 }
 async function save(event:FormEvent){
  event.preventDefault();
  await perform("saving",async()=>{
   const result=await post("save",{base_url:settings.base_url,api_key:apiKey,
    model_name:settings.model_name,protocol:settings.protocol,reasoning_effort:settings.reasoning_effort,enabled:settings.enabled}) as AiSettings;
   setSettings(result);setApiKey("");
   const r=await fetch("/api/oa/finance/ai-settings?entity_id="+encodeURIComponent(entityId),{cache:"no-store"});
   const latest=await r.json().catch(()=>null);
   if(r.ok&&latest?.ok)setCalls(latest.data.calls||[]);
   setNotice("ModelBridge configuration saved for this company. Run Test connection before importing invoices.");
  });
 }
 if(loading)return <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"><p className="text-sm text-neutral-500">Loading invoice AI settings…</p></section>;
 return <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
  <h2 className="font-semibold">Invoice AI / ModelBridge 设置</h2>
  <p className="mb-3 mt-1 text-xs text-neutral-500">Each company configures its own ModelBridge endpoint, API Key and model. Secrets are encrypted and never shown again. This service receives invoice contents for extraction; use an approved model and data policy.</p>
  
  {!settings.settings_master_key_configured&&<p className="text-sm text-red-600">Configure the existing OA_SETTINGS_MASTER_KEY before saving AI credentials.</p>}
  <form onSubmit={save} className="space-y-3">
   <div className="grid gap-3 md:grid-cols-3">
    <label className="block text-xs font-medium md:col-span-2">ModelBridge Base URL
     <input className={fields+" mt-1"} type="url" placeholder="https://your-modelbridge-domain/v1" required
      value={settings.base_url} onChange={e=>setSettings(s=>({...s,base_url:e.target.value}))}/>
    </label>
    <label className="block text-xs font-medium">Model name
     <input className={fields+" mt-1"} placeholder="Your enabled vision/PDF model ID" required
      value={settings.model_name} onChange={e=>setSettings(s=>({...s,model_name:e.target.value}))}/>
    </label>
    <label className="block text-xs font-medium">API Key
     <input className={fields+" mt-1"} type="password" autoComplete="new-password" placeholder={settings.api_key_configured?"Leave blank to keep existing key":"Enter ModelBridge API Key"}
      value={apiKey} required={!settings.api_key_configured} onChange={e=>setApiKey(e.target.value)}/>
    </label>
    <label className="block text-xs font-medium">API protocol
     <select className={fields+" mt-1"} value={settings.protocol}
      onChange={e=>setSettings(s=>({...s,protocol:e.target.value as AiSettings["protocol"]}))}>
      <option value="responses">Responses API (PDF and images)</option>
      <option value="chat_completions">Chat Completions (images only)</option>
     </select>
    </label>
    <label className="block text-xs font-medium">Reasoning effort / 推理强度
     <select className={fields+" mt-1"} value={settings.reasoning_effort||"auto"}
      onChange={e=>setSettings(s=>({...s,reasoning_effort:e.target.value as AiSettings["reasoning_effort"]}))}>
      <option value="auto">Auto (DeepSeek: none, others: provider default)</option>
      <option value="none">None / 关闭推理</option>
      <option value="low">Low / 低</option>
      <option value="medium">Medium / 中</option>
      <option value="high">High / 高</option>
     </select>
    </label>
    <div className="flex items-end pb-2">
     <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.enabled}
      onChange={e=>setSettings(s=>({...s,enabled:e.target.checked}))}/>Enable invoice AI extraction</label>
    </div>
   </div>
   <p className="text-xs text-neutral-500">Enter the API prefix ending in <code>/v1</code>, not the full <code>/responses</code> URL. Optional vendor routing: <code>https://host/vendor/v1</code>. Use Responses with a model capable of reading PDF files; a successful connection test alone does not prove PDF compatibility.</p>
   <p className="text-xs text-neutral-500">ModelBridge DeepSeek models default to no reasoning here because invoice extraction needs visible JSON, not thousands of thinking tokens. Check the selected model supports the effort setting; not every provider accepts "none".</p>
   {/deepseek(?:[-_]|$)/i.test(settings.model_name)&&<p role="note" className="rounded-md border border-amber-300 p-2 text-xs text-amber-900 dark:text-amber-200">DeepSeek may accept images directly, but its Responses API does not accept an inline PDF attachment. For PDF invoices choose a ModelBridge model/provider that supports inline input_file, or convert the PDF to an image first. OA will reject incompatible DeepSeek PDF submissions before charging another model call.</p>}
   <div className="flex flex-wrap items-center gap-2">
    <button className={button} disabled={busy||!settings.settings_master_key_configured}>{phase==="saving"?"Saving…":"Save AI settings"}</button>
    <button type="button" className={button} disabled={busy||!settings.api_key_configured||!settings.enabled}
     onClick={()=>void perform("testing",async()=>{
      const result=await post("test");
      const d=result.diagnostic;
      setNotice(result.connected?"Connection OK · "+result.model+" · HTTP "+(d?.http_status??"—")+" · "+(d?.duration_ms??"—")+"ms · output tokens "+(d?.output_tokens??"—")+" (reasoning "+(d?.reasoning_tokens??"—")+")":"Connection test returned no answer");
      const r=await fetch("/api/oa/finance/ai-settings?entity_id="+encodeURIComponent(entityId),{cache:"no-store"});
      const latest=await r.json().catch(()=>null);
      if(r.ok&&latest?.ok)setCalls(latest.data.calls||[]);
     })}>
     {phase==="testing"?"Testing…":"Test connection"}
    </button>
    <span className="text-xs text-neutral-500">{settings.api_key_configured?"API Key stored securely":"API Key not set"} · {settings.enabled?"Enabled":"Disabled"}</span>
   </div>
   {busy&&<p role="status" className="mt-2 text-sm font-medium">{phase==="saving"?"Saving company AI settings…":"Calling ModelBridge AI; checking response status and output…"}</p>}
   {notice&&<p role="status" className="mt-2 rounded-md border border-green-300 p-3 text-sm text-green-800 dark:text-green-300">{notice}</p>}
   {error&&<p role="alert" className="mt-2 rounded-md border border-red-300 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
  </form>
  <details className="mt-4 border-t pt-3 dark:border-neutral-800" open={calls.length>0}>
   <summary className="cursor-pointer text-sm font-semibold">Recent ModelBridge calls / 最近 AI 调用（{calls.length}）</summary>
   <p className="mt-1 text-xs text-neutral-500">No API key, invoice content, prompt or response text is retained in this diagnostic history.</p>
   <div className="mt-2 overflow-x-auto"><table className="min-w-full text-left text-xs">
    <thead><tr>{["Time","Operation / Model","Outcome","HTTP / Reason","Tokens in/out","Duration","Request ID"].map(s=><th key={s} className="p-2">{s}</th>)}</tr></thead>
    <tbody>{calls.map(d=><tr key={d.id} className="border-t dark:border-neutral-800">
     <td className="p-2">{d.created_at}</td>
     <td className="p-2">{d.operation} · {d.model}<div className="text-neutral-500">{d.protocol} · {d.output_types||"unknown output"}</div></td>
     <td className="p-2">{d.outcome}</td>
     <td className="p-2">{d.http_status??"—"} · {d.response_status||"—"}<div>{d.finish_reason||d.error_code||"—"}</div></td>
     <td className="p-2">{d.input_tokens??"—"} / {d.output_tokens??"—"}<div className="text-neutral-500">Reasoning: {d.reasoning_tokens??"—"}</div></td>
     <td className="p-2">{d.duration_ms} ms</td>
     <td className="p-2">{d.request_id||"—"}</td>
    </tr>)}</tbody>
   </table></div>
  </details>
 </section>;
}
