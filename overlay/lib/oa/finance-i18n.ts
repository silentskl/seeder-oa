"use client";

import {useCallback,useEffect,useState} from "react";

export type FinanceLanguage="en"|"zh";
export const financeTr=(language:FinanceLanguage,english:string,chinese:string)=>
 language==="zh"?chinese:english;
const key="oa.language";
const eventName="oa-language-changed";
function readLanguage():FinanceLanguage{
 if(typeof window==="undefined")return "en";
 try{
  const stored=window.localStorage.getItem(key);
  if(stored==="en"||stored==="zh")return stored;
 }catch{ /* private browsing can disable storage */ }
 const dom=document.documentElement.lang.toLowerCase();
 if(dom.startsWith("zh"))return "zh";
 return navigator.language.toLowerCase().startsWith("zh")?"zh":"en";
}
export function useFinanceLanguage():[FinanceLanguage,(lang:FinanceLanguage)=>void]{
 const [language,setLanguage]=useState<FinanceLanguage>("en");
 useEffect(()=>{
  const sync=()=>setLanguage(readLanguage());
  sync();
  window.addEventListener(eventName,sync);
  window.addEventListener("storage",sync);
  return ()=>{window.removeEventListener(eventName,sync);window.removeEventListener("storage",sync);};
 },[]);
 const update=useCallback((next:FinanceLanguage)=>{
  try{window.localStorage.setItem(key,next);}catch{}
  document.documentElement.lang=next==="zh"?"zh-CN":"en";
  setLanguage(next);
  window.dispatchEvent(new Event(eventName));
 },[]);
 return [language,update];
}
export function financeError(language:FinanceLanguage,message:string):string{
 if(language==="en")return message;
 const known=[
  [/Duplicate invoice number|duplicate normalized invoice number/i,"已存在相同发票编号，无法重复入账"],
  [/Invoice review mismatch|correct all required counterparty details/i,"发票与已批准供应商或客户资料不一致，请先更正全部必填校验项"],
  [/Bank account verification required/i,"银行账户验证未通过"],
  [/Invoice was already reviewed|Invoice is not awaiting review/i,"发票已被审核或不再处于待审核状态"],
  [/Unauthorized|Forbidden/i,"没有执行此操作的权限"],
  [/Failed to fetch|NetworkError/i,"网络请求失败"],
  [/Possible duplicate invoice/i,"检测到疑似重复发票，请先处理排重提示"],
  [/missing|not found/i,"找不到所需数据"],
  [/invalid/i,"数据格式无效"]
 ] as const;
 for(const [regex,translation] of known)if(regex.test(message))return translation;
 return "操作未成功，请检查输入或联系管理员。";
}
