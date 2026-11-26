// Actual multipart transmission; 100% does not mean server storage or AI completion.
export type UploadEvent={stage:"uploading";percent:number|null}|{stage:"saving";percent:100};
export function uploadInvoiceFile(entityId:string,file:File,onProgress:(event:UploadEvent)=>void):Promise<string>{
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();
  const form=new FormData();form.set("entity_id",entityId);form.set("purpose","invoice");form.set("file",file);
  xhr.open("POST","/api/oa/finance/documents");xhr.timeout=120000;xhr.responseType="json";
  let sent=false;
  xhr.upload.onprogress=e=>{
   if(!sent)onProgress({stage:"uploading",percent:e.lengthComputable&&e.total>0?Math.min(100,Math.max(0,Math.floor(e.loaded/e.total*100))):null});
  };
  xhr.upload.onload=()=>{sent=true;onProgress({stage:"saving",percent:100});};
  xhr.onload=()=>{
   const data=xhr.response;
   if(xhr.status<200||xhr.status>=300||!data?.ok||typeof data?.data?.id!=="string"||!data.data.id){
    reject(new Error(typeof data?.error==="string"?data.error:"Attachment upload HTTP "+xhr.status));return;
   }
   resolve(data.data.id);
  };
  xhr.onerror=()=>reject(new Error("Upload connection interrupted; check records before retrying"));
  xhr.ontimeout=()=>reject(new Error("Upload response timed out; check records before retrying"));
  xhr.onabort=()=>reject(new Error("Upload interrupted; check records before retrying"));
  onProgress({stage:"uploading",percent:null});xhr.send(form);
 });
}
export type InvoiceImportState="queued"|"uploading"|"saving"|"extracting"|"imported"|"manual"|"duplicate"|"failed";
export type InvoiceUploadRow={name:string;size:number;state:InvoiceImportState;percent:number|null;error?:string;direction?:string;documentId?:string};
export function isUploadTerminal(state:InvoiceImportState){
 return state==="imported"||state==="manual"||state==="duplicate"||state==="failed";
}
export function classifyInvoiceImport(result:unknown):"imported"|"manual"|"duplicate"{
 if(!result||typeof result!=="object")throw new Error("Invalid invoice import response");
 const r=result as Record<string,unknown>;
 if(typeof r.id!=="string"||!r.id)throw new Error("Invoice import response missing ID");
 if(r.duplicate===true)return "duplicate";
 return r.extraction_status==="extracted"?"imported":"manual";
}
