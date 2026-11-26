import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {File} from "node:buffer";
const app=path.resolve(process.argv[2]||".");
const ts=createRequire(path.join(app,"package.json"))("typescript");
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const source=fs.readFileSync(path.join(root,"overlay/lib/oa/invoice-upload.ts"),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};new Function("exports",compiled)(mod.exports);
const {uploadInvoiceFile,classifyInvoiceImport,isUploadTerminal}=mod.exports;
class MockXHR{
 constructor(){this.upload={};MockXHR.last=this;}
 open(method,url){this.method=method;this.url=url;}
 send(form){this.form=form;}
}
globalThis.XMLHttpRequest=MockXHR;
const file=new File(["test"],"invoice.pdf",{type:"application/pdf"});
const events=[];const promise=uploadInvoiceFile("company-a",file,e=>events.push(e));
const xhr=MockXHR.last;
assert.equal(xhr.method,"POST");assert.equal(xhr.url,"/api/oa/finance/documents");assert.equal(xhr.form.get("entity_id"),"company-a");
xhr.upload.onprogress({lengthComputable:true,loaded:5,total:10});xhr.upload.onload();
assert.deepEqual(events,[{stage:"uploading",percent:null},{stage:"uploading",percent:50},{stage:"saving",percent:100}]);
let resolved=false;promise.then(()=>resolved=true);await Promise.resolve();assert.equal(resolved,false);
xhr.status=201;xhr.response={ok:true,data:{id:"doc"}};xhr.onload();assert.equal(await promise,"doc");
for(const event of ["onerror","ontimeout","onabort","onload"]){
 const p=uploadInvoiceFile("company-a",file,()=>{});const x=MockXHR.last;x.status=403;x.response={ok:false,error:"Forbidden"};x[event]();await assert.rejects(p);
}
const noLength=[];const p=uploadInvoiceFile("company-a",file,e=>noLength.push(e));
MockXHR.last.upload.onprogress({lengthComputable:false,loaded:2,total:0});
assert.equal(noLength.at(-1).percent,null);MockXHR.last.onerror();await assert.rejects(p);
assert.equal(classifyInvoiceImport({id:"a",extraction_status:"extracted"}),"imported");
assert.equal(classifyInvoiceImport({id:"a",extraction_status:"needs_manual_review"}),"manual");
assert.equal(classifyInvoiceImport({id:"a"}),"manual");
assert.equal(classifyInvoiceImport({id:"a",duplicate:true}),"duplicate");
assert.throws(()=>classifyInvoiceImport({}));
for(const stage of ["queued","uploading","saving","extracting"])assert.equal(isUploadTerminal(stage),false);
for(const stage of ["imported","manual","duplicate","failed"])assert.equal(isUploadTerminal(stage),true);
const ui=fs.readFileSync(path.join(root,"overlay/components/oa/finance-console.tsx"),"utf8");
assert.ok(ui.includes('await uploadInvoiceFile(')&&ui.includes('state:"extracting"')&&ui.includes("uploadRows.map("));
assert.ok(ui.includes("uploadLock.current")&&ui.includes("await load(company)"));
const api=fs.readFileSync(path.join(root,"overlay/app/api/oa/finance/route.ts"),"utf8");
assert.ok(api.includes("extraction_status:parsed.extractionStatus,duplicate:false"));
console.log("PASS invoice upload actual progress, server confirmation, failure, extraction results and batch states");
