/**
 * Local equivalents of the small D1 / R2 surface used by Seeder OA.
 * Seeder upstream already runs Drizzle against @libsql/client in RUNTIME=node.
 * This adapter uses the SAME SQLite file and SAME local storage directory:
 * OA and upstream therefore share accounts, sessions, invoices and attachments.
 *
 * Do not import @libsql/client statically: upstream's node runtime intentionally
 * externalises the native client through __non_webpack_require__.
 */
import path from "node:path";
import {getStorage} from "@/lib/storage";

declare const __non_webpack_require__: NodeRequire;

type SqlArgs = unknown[];
type SqlResult = {rows:Array<Record<string,unknown>>;rowsAffected:number;lastInsertRowid?:bigint};
type Client = {execute:(input:{sql:string;args:unknown[]})=>Promise<SqlResult>};

let client:Client|undefined;
function sqlite():Client{
 if(process.env.RUNTIME!=="node")throw new Error("Local OA database is only available with RUNTIME=node");
 if(!client){
  const database=path.resolve(process.env.SQLITE_DB_PATH||"./data/seeder.db");
  const libsqlName=process.env.RUNTIME==="node"?"@libsql/client":"unavailable";
  const libsql=__non_webpack_require__(libsqlName) as {createClient:(o:{url:string})=>Client};
  client=libsql.createClient({url:"file:"+database});
 }
 return client;
}
function normaliseArg(v:unknown):unknown{
 if(v===undefined||v===null)return null;
 if(typeof v==="boolean")return v?1:0;
 if(v instanceof ArrayBuffer)return new Uint8Array(v);
 return v;
}
const db={
 prepare(sql:string){
  const query=(args:SqlArgs)=>sqlite().execute({sql,args:args.map(normaliseArg)});
  const prepared=(args:SqlArgs=[])=>({
   bind(...values:SqlArgs){return prepared(values);},
   async first<T=Record<string,unknown>>(field?:string):Promise<T|null>{
    const row=(await query(args)).rows[0];
    if(!row)return null;
    return (field?row[field]:row) as T??null;
   },
   async all<T=Record<string,unknown>>():Promise<{success:true;results:T[];meta:{changes:number}}>{
    const result=await query(args);
    return {success:true,results:result.rows as T[],meta:{changes:result.rowsAffected}};
   },
   async run():Promise<{success:true;meta:{changes:number;last_row_id?:number}}>{
    const result=await query(args);
    return {success:true,meta:{
     changes:result.rowsAffected,
     ...(result.lastInsertRowid===undefined?{}:{last_row_id:Number(result.lastInsertRowid)})
    }};
   }
  });
  return prepared();
 }
};
type PutInput=ArrayBuffer|ArrayBufferView|ReadableStream<Uint8Array>|string;
async function bytesOf(input:PutInput):Promise<ArrayBuffer>{
 if(typeof input==="string"){
  const bytes=new TextEncoder().encode(input);
  return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
 }
 if(input instanceof ArrayBuffer)return input;
 if(ArrayBuffer.isView(input)){
  const view=new Uint8Array(input.buffer,input.byteOffset,input.byteLength);
  return view.slice().buffer as ArrayBuffer;
 }
 return await new Response(input).arrayBuffer();
}
const uploads={
 async put(key:string,input:PutInput,options?:{httpMetadata?:{contentType?:string;cacheControl?:string}}){
  const store=getStorage();
  if(!store)throw new Error("Node upload storage is unavailable");
  await store.put(key,await bytesOf(input),{contentType:options?.httpMetadata?.contentType,cacheControl:options?.httpMetadata?.cacheControl});
 },
 async get(key:string){
  const store=getStorage();
  if(!store)throw new Error("Node upload storage is unavailable");
  const item=await store.get(key);
  if(!item)return null;
  return {body:item.body,httpMetadata:{contentType:item.contentType,cacheControl:item.cacheControl},httpEtag:item.etag};
 },
 async delete(key:string){
  const store=getStorage();
  if(!store)throw new Error("Node upload storage is unavailable");
  await store.delete(key);
 }
};
export function getNodeBindings(){return {db,uploads};}
