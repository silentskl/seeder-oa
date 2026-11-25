#!/usr/bin/env node
// Reviewed against better-auth v1.6.9 source. Abort on dependency drift.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const root=path.resolve(process.argv[2] || ".");
const req=createRequire(path.join(root,"package.json"));
function packageRoot(name, resolver=req){
  let dir=path.dirname(resolver.resolve(name));
  for (;;) {
    const p=path.join(dir,"package.json");
    if(fs.existsSync(p)&&JSON.parse(fs.readFileSync(p,"utf8")).name===name) return dir;
    const parent=path.dirname(dir);
    if(parent===dir) throw Error("Cannot locate "+name);
    dir=parent;
  }
}
function version(dir){return JSON.parse(fs.readFileSync(path.join(dir,"package.json"),"utf8")).version;}
const auth=packageRoot("better-auth");
const adapter=packageRoot("@better-auth/drizzle-adapter");
const core=packageRoot("@better-auth/core",createRequire(path.join(auth,"package.json")));
for(const dir of [auth,adapter,core]){
  if(version(dir)!=="1.6.9") throw Error("Unreviewed dependency version: "+dir+" "+version(dir));
}
for(const dir of [auth,adapter]){
  if(fs.realpathSync(packageRoot("@better-auth/core",createRequire(path.join(dir,"package.json"))))!==fs.realpathSync(core))
    throw Error("Multiple Better Auth core copies; refuse deployment");
}
const changes=new Map();
function read(rel){return fs.readFileSync(path.join(core,rel),"utf8");}
const loader="dist/async_hooks/index.mjs";
const staticLoader='// OA_STATIC_ASYNC_HOOKS_V1\nimport { AsyncLocalStorage } from "node:async_hooks";\nasync function getAsyncLocalStorage() { return AsyncLocalStorage; }\nexport { getAsyncLocalStorage };\n';
const old=read(loader);
if(old!==staticLoader){
  if(!old.includes("AsyncLocalStoragePromise")||!old.includes("node:async_hooks")||!old.includes("getAsyncLocalStorage"))
    throw Error("Unreviewed async_hooks loader");
  changes.set(loader,staticLoader);
}
// Each async initializer has an await gap. A second synchronous check after
// the await preserves the one shared ALS container, never a shared Promise.
for(const [name,field] of [
  ["request-state","requestStateAsyncStorage"],
  ["endpoint-context","endpointContextAsyncStorage"],
  ["transaction","adapterAsyncStorage"]
]){
  const rel="dist/context/"+name+".mjs";
  const source=read(rel);
  const escaped=field.replace(/[.*+?^$(){}|[\]\\]/g,"\\$&");
  const unsafe=new RegExp("(\\.context\\."+escaped+"\\s*)=(\\s*new AsyncLocalStorage\\s*\\()","g");
  const safe=new RegExp("\\.context\\."+escaped+"\\s*\\?\\?=\\s*new AsyncLocalStorage\\s*\\(","g");
  if((source.match(safe)||[]).length===1 && !unsafe.test(source)) continue;
  const matches=source.match(unsafe)||[];
  if(matches.length!==1 || !source.includes("await getAsyncLocalStorage()"))
    throw Error("Unreviewed ALS initialization: "+rel);
  changes.set(rel,source.replace(unsafe,"$1??=$2"));
}
for(const [rel,source] of changes) fs.writeFileSync(path.join(core,rel),source);
// Exercise the actual installed patched modules, not only text assertions.
const imp=rel=>import(pathToFileURL(path.join(core,rel)).href);
const {getAsyncLocalStorage}=await imp(loader);
const {AsyncLocalStorage}=await import("node:async_hooks");
assert.equal(await getAsyncLocalStorage(),AsyncLocalStorage);
const state=await imp("dist/context/request-state.mjs");
const endpoint=await imp("dist/context/endpoint-context.mjs");
const transaction=await imp("dist/context/transaction.mjs");
for(const get of [state.getRequestStateAsyncLocalStorage,endpoint.getCurrentAuthContextAsyncLocalStorage,transaction.getCurrentDBAdapterAsyncLocalStorage]){
  const all=await Promise.all(Array.from({length:64},()=>get()));
  assert.ok(all.every(x=>x===all[0]),"cold concurrent ALS initialization diverged");
}
await Promise.all(Array.from({length:64},(_,i)=>{
  const store=new WeakMap();
  return state.runWithRequestState(store,async()=>{
    await Promise.resolve();
    assert.equal(await state.getCurrentRequestState(),store);
    const ctx={id:i};
    await endpoint.runWithEndpointContext(ctx,async()=>{
      await Promise.resolve();
      assert.equal(await endpoint.getCurrentAuthContext(),ctx);
    });
    const adapter={id:i};
    await transaction.runWithAdapter(adapter,async()=>{
      await Promise.resolve();
      assert.equal(await transaction.getCurrentAdapter({}),adapter);
    });
  });
}));
console.log("PASS Better Auth 1.6.9 static native ALS, concurrent initialization and context isolation (64 requests)");
