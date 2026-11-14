"use client";

import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";
import {financeTr,financeError,type FinanceLanguage} from "@/lib/oa/finance-i18n";

type AiSettings={
 base_url:string;model_name:string;protocol:"responses"|"chat_completions";reasoning_effort:"auto"|"none"|"low"|"medium"|"high";
 enabled:boolean;api_key_configured:boolean;legacy_environment_configured:boolean;
 settings_master_key_configured:boolean;updated_at:string|null;
};
type AiCall={id:string;operation:string;model:string;protocol:string;outcome:string;http_status:number|null;response_status:string;finish_reason:string;output_types:string;duration_ms:number;input_tokens:number|null;output_tokens:number|null;reasoning_tokens:number|null;output_chars:number;request_id:string;error_code:string;created_at:string};
const fields="w-full rounded-md border border-neutral-300 bg-white p-2 text-sm dark:border-neutral-700 dark:bg-neutral-950";
const button="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium disabled:opacity-40 dark:border-neutral-700";
const empty:AiSettings={base_url:"",model_name:"",protocol:"responses",reasoning_effort:"auto",enabled:false,api_key_configured:false,legacy_environment_configured:false,settings_master_key_configured:false,updated_at:null};

export function FinanceAiPanel({entityId,mode="settings",lang}:{entityId:string;mode?:"settings"|"calls";lang:FinanceLanguage}){
 const t=(en:string,zh:string)=>financeTr(lang,en,zh);
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
   setNotice(t("Configuration saved. Test the connection before importing invoices.","配置已保存。导入发票前请先测试连接。"));
  });
 }
 if(loading)return <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"><p className="text-sm text-neutral-500">{t("Loading invoice AI settings…","正在加载发票 AI 配置…")}</p></section>;
 if(mode==="calls")return <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
   <h2 className="font-semibold">{t("Recent ModelBridge calls","最近 ModelBridge 调用")} ({calls.length})</h2>
   <p className="mt-1 text-xs text-neutral-500">{t("No API keys, invoice contents, prompts or response texts are retained in the diagnostic history.","诊断记录不保存 API 密钥、发票内容、提示词或响应正文。")}</p>
   {error&&<p role="alert" className="mt-2 text-sm text-red-600">{financeError(lang,error)}</p>}
   <div className="mt-3 overflow-x-auto"><table className="min-w-full text-left text-xs">
    <thead><tr>{[t("Time","时间"),t("Operation / Model","操作与模型"),t("Outcome","结果"),t("HTTP / Reason","状态与原因"),t("Tokens in/out","输入／输出 Token"),t("Duration","耗时"),t("Request ID","请求 ID")].map(s=><th key={s} className="p-2">{s}</th>)}</tr></thead>
    <tbody>{calls.map(d=><tr key={d.id} className="border-t dark:border-neutral-800">
     <td className="p-2">{d.created_at}</td>
     <td className="p-2">{d.operation} · {d.model}<div className="text-neutral-500">{d.protocol} · {d.output_types||"—"}</div></td>
     <td className="p-2">{d.outcome}</td>
     <td className="p-2">{d.http_status??"—"} · {d.response_status||"—"}<div>{d.finish_reason||d.error_code||"—"}</div></td>
     <td className="p-2">{d.input_tokens??"—"} / {d.output_tokens??"—"}<div className="text-neutral-500">{t("Reasoning","推理")}: {d.reasoning_tokens??"—"}</div></td>
     <td className="p-2">{d.duration_ms} ms</td>
     <td className="p-2">{d.request_id||"—"}</td>
    </tr>)}</tbody>
   </table></div>
   {!calls.length&&<p className="mt-3 text-sm text-neutral-500">{t("No recent calls.","暂无最近调用记录。")}</p>}
  </section>;
 return <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
  <h2 className="font-semibold">{t("ModelBridge AI settings","ModelBridge AI 设置")}</h2>
  <p className="mb-3 mt-1 text-xs text-neutral-500">{t("Configure the ModelBridge endpoint, API key and model for this company. Credentials are encrypted. Use an approved model for invoice content.","为本公司配置 ModelBridge 接口、API 密钥及模型。凭证加密保存；请选择符合发票数据政策的模型。")}</p>
  
  {!settings.settings_master_key_configured&&<p className="text-sm text-red-600">{t("Configure OA_SETTINGS_MASTER_KEY before saving AI credentials.","保存 AI 凭证前请配置 OA_SETTINGS_MASTER_KEY。")}</p>}
  <form onSubmit={save} className="space-y-3">
   <div className="grid gap-3 md:grid-cols-3">
    <label className="block text-xs font-medium md:col-span-2">{t("ModelBridge Base URL","ModelBridge 接口地址")}
     <input className={fields+" mt-1"} type="url" placeholder="https://your-modelbridge-domain/v1" required
      value={settings.base_url} onChange={e=>setSettings(s=>({...s,base_url:e.target.value}))}/>
    </label>
    <label className="block text-xs font-medium">{t("Model name","模型名称")}
     <input className={fields+" mt-1"} placeholder="Your enabled vision/PDF model ID" required
      value={settings.model_name} onChange={e=>setSettings(s=>({...s,model_name:e.target.value}))}/>
    </label>
    <label className="block text-xs font-medium">{t("API Key","API 密钥")}
     <input className={fields+" mt-1"} type="password" autoComplete="new-password" placeholder={settings.api_key_configured?t("Leave blank to keep current key","留空则保留现有密钥"):t("Enter ModelBridge API key","输入 ModelBridge API 密钥")}
      value={apiKey} required={!settings.api_key_configured} onChange={e=>setApiKey(e.target.value)}/>
    </label>
    <label className="block text-xs font-medium">{t("API protocol","接口协议")}
     <select className={fields+" mt-1"} value={settings.protocol}
      onChange={e=>setSettings(s=>({...s,protocol:e.target.value as AiSettings["protocol"]}))}>
      <option value="responses">{t("Responses API (PDF and images)","Responses 接口（支持 PDF 和图片）")}</option>
      <option value="chat_completions">{t("Chat Completions (images only)","Chat Completions 接口（仅图片）")}</option>
     </select>
    </label>
    <label className="block text-xs font-medium">{t("Reasoning effort","推理强度")}
     <select className={fields+" mt-1"} value={settings.reasoning_effort||"auto"}
      onChange={e=>setSettings(s=>({...s,reasoning_effort:e.target.value as AiSettings["reasoning_effort"]}))}>
      <option value="auto">{t("Auto (DeepSeek: none, others: provider default)","自动（DeepSeek 关闭推理，其他模型使用上游默认）")}</option>
      <option value="none">{t("None","关闭")}</option>
      <option value="low">{t("Low","低")}</option>
      <option value="medium">{t("Medium","中")}</option>
      <option value="high">{t("High","高")}</option>
     </select>
    </label>
    <div className="flex items-end pb-2">
     <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.enabled}
      onChange={e=>setSettings(s=>({...s,enabled:e.target.checked}))}/>{t("Enable invoice AI extraction","启用发票 AI 识别")}</label>
    </div>
   </div>
   <p className="text-xs text-neutral-500">{t("Enter the API prefix ending in /v1, not the full /responses URL. Choose a model that supports PDF files; a successful connection test alone does not verify PDF parsing.","请输入以 /v1 结尾的接口前缀，不要填写完整的 /responses 路径。请选择支持 PDF 的模型；连接测试成功不代表 PDF 识别可用。")}</p>
   <p className="text-xs text-neutral-500">{t("DeepSeek defaults to no reasoning for invoice extraction. Not every upstream supports every reasoning setting.","DeepSeek 发票识别默认关闭推理。不同上游支持的推理选项可能不同。")}</p>
   {/deepseek(?:[-_]|$)/i.test(settings.model_name)&&<p role="note" className="rounded-md border border-amber-300 p-2 text-xs text-amber-900 dark:text-amber-200">{t("DeepSeek Responses API may not support inline PDF input. Select a PDF-capable upstream for PDF invoices.","DeepSeek 的 Responses 接口可能不支持内嵌 PDF 文件。请为 PDF 发票选择支持文件输入的上游模型。")}</p>}
   <div className="flex flex-wrap items-center gap-2">
    <button className={button} disabled={busy||!settings.settings_master_key_configured}>{phase==="saving"?t("Saving…","保存中…"):t("Save AI settings","保存 AI 配置")}</button>
    <button type="button" className={button} disabled={busy||!settings.api_key_configured||!settings.enabled}
     onClick={()=>void perform("testing",async()=>{
      const result=await post("test");
      const d=result.diagnostic;
      setNotice(result.connected?t("Connection OK","连接成功")+" · "+result.model+" · HTTP "+(d?.http_status??"—")+" · "+(d?.duration_ms??"—")+"ms · "+t("output tokens","输出 Token")+" "+(d?.output_tokens??"—")+" ("+t("reasoning","推理")+" "+(d?.reasoning_tokens??"—")+")":t("Connection test returned no answer","连接测试未返回有效结果"));
      const r=await fetch("/api/oa/finance/ai-settings?entity_id="+encodeURIComponent(entityId),{cache:"no-store"});
      const latest=await r.json().catch(()=>null);
      if(r.ok&&latest?.ok)setCalls(latest.data.calls||[]);
     })}>
     {phase==="testing"?t("Testing…","测试中…"):t("Test connection","测试连接")}
    </button>
    <span className="text-xs text-neutral-500">{settings.api_key_configured?t("API key stored","密钥已保存"):t("API key not set","尚未设置密钥")} · {settings.enabled?t("Enabled","已启用"):t("Disabled","已禁用")}</span>
   </div>
   {busy&&<p role="status" className="mt-2 text-sm font-medium">{phase==="saving"?t("Saving AI settings…","正在保存 AI 配置…"):t("Testing ModelBridge connection…","正在测试 ModelBridge 连接…")}</p>}
   {notice&&<p role="status" className="mt-2 rounded-md border border-green-300 p-3 text-sm text-green-800 dark:text-green-300">{notice}</p>}
   {error&&<p role="alert" className="mt-2 rounded-md border border-red-300 p-3 text-sm text-red-700 dark:text-red-300">{financeError(lang,error)}</p>}
  </form>

 </section>;
}
