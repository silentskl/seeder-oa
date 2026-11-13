"use client";

import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";

type AiSettings={
 base_url:string;model_name:string;protocol:"responses"|"chat_completions";
 enabled:boolean;api_key_configured:boolean;legacy_environment_configured:boolean;
 settings_master_key_configured:boolean;updated_at:string|null;
};
const fields="w-full rounded-md border border-neutral-300 bg-white p-2 text-sm dark:border-neutral-700 dark:bg-neutral-950";
const button="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium disabled:opacity-40 dark:border-neutral-700";
const empty:AiSettings={base_url:"",model_name:"",protocol:"responses",enabled:false,api_key_configured:false,legacy_environment_configured:false,settings_master_key_configured:false,updated_at:null};

export function FinanceAiPanel({entityId}:{entityId:string}){
 const [settings,setSettings]=useState<AiSettings>({...empty});
 const [apiKey,setApiKey]=useState("");
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(""),[notice,setNotice]=useState("");
 const version=useRef(0);
 const load=useCallback(async()=>{
  const seq=++version.current;
  const r=await fetch("/api/oa/finance/ai-settings?entity_id="+encodeURIComponent(entityId),{cache:"no-store"});
  const result=await r.json().catch(()=>null);
  if(!r.ok||!result?.ok)throw new Error(result?.error||"Cannot load invoice AI settings");
  if(seq!==version.current)return;
  setSettings(result.data);
 },[entityId]);
 useEffect(()=>{
  let active=true;
  version.current++;
  setSettings({...empty});setApiKey("");setError("");setNotice("");setLoading(true);
  void load().catch(e=>{if(active)setError(String(e instanceof Error?e.message:e));}).finally(()=>{if(active)setLoading(false);});
  return ()=>{active=false;version.current++;};
 },[load]);
 async function post(action:string,data:Record<string,unknown>={}){
  const r=await fetch("/api/oa/finance/ai-settings",{
   method:"POST",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({action,entity_id:entityId,...data})
  });
  const result=await r.json().catch(()=>null);
  if(!r.ok||!result?.ok)throw new Error(result?.error||"Invoice AI request failed");
  return result.data;
 }
 async function perform(work:()=>Promise<void>){
  setBusy(true);setError("");setNotice("");
  try{await work();}catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setBusy(false);}
 }
 async function save(event:FormEvent){
  event.preventDefault();
  await perform(async()=>{
   const result=await post("save",{base_url:settings.base_url,api_key:apiKey,
    model_name:settings.model_name,protocol:settings.protocol,enabled:settings.enabled}) as AiSettings;
   setSettings(result);setApiKey("");
   setNotice("ModelBridge configuration saved for this company. Run Test connection before importing invoices.");
  });
 }
 if(loading)return <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"><p className="text-sm text-neutral-500">Loading invoice AI settings…</p></section>;
 return <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
  <h2 className="font-semibold">Invoice AI / ModelBridge 设置</h2>
  <p className="mb-3 mt-1 text-xs text-neutral-500">Each company configures its own ModelBridge endpoint, API Key and model. Secrets are encrypted and never shown again. This service receives invoice contents for extraction; use an approved model and data policy.</p>
  {error&&<p role="alert" className="my-2 text-sm text-red-600">{error}</p>}
  {notice&&<p role="status" className="my-2 text-sm">{notice}</p>}
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
    <div className="flex items-end pb-2">
     <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.enabled}
      onChange={e=>setSettings(s=>({...s,enabled:e.target.checked}))}/>Enable invoice AI extraction</label>
    </div>
   </div>
   <p className="text-xs text-neutral-500">Enter the API prefix ending in <code>/v1</code>, not the full <code>/responses</code> URL. Optional vendor routing: <code>https://host/vendor/v1</code>. Use Responses with a model capable of reading PDF files; a successful connection test alone does not prove PDF compatibility.</p>
   <div className="flex flex-wrap items-center gap-2">
    <button className={button} disabled={busy||!settings.settings_master_key_configured}>Save AI settings</button>
    <button type="button" className={button} disabled={busy||!settings.api_key_configured||!settings.enabled}
     onClick={()=>void perform(async()=>{const result=await post("test");setNotice(result.connected?"ModelBridge connection succeeded for model "+result.model+".":"ModelBridge connection did not return a valid answer.");})}>
     Test connection
    </button>
    <span className="text-xs text-neutral-500">{settings.api_key_configured?"API Key stored securely":"API Key not set"} · {settings.enabled?"Enabled":"Disabled"}</span>
   </div>
  </form>
 </section>;
}
