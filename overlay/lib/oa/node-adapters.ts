/** Native OA D1/R2 compatibility for the existing Seeder Node.js runtime. */
import path from "node:path";
import {getStorage} from "@/lib/storage";
declare const __non_webpack_require__: NodeRequire;

type SqlValue=string|number|bigint|boolean|null|Uint8Array;
type SqlResult={rows:Array<Record<string,unknown>>;rowsAffected:number;lastInsertRowid?:bigint|number|string|null};
type SqlClient={execute:(statement:{sql:string;args:SqlValue[]})=>Promise<SqlResult>};
let sqliteClient:SqlClient|undefined;
function getClient():SqlClient{
 if(sqliteClient)return sqliteClient;
 if(process.env.RUNTIME!=="node")throw new Error("Native OA SQLite adapter requires RUNTIME=node");
 // Keep the native client external to the Next/Workers bundles, like Seeder lib/db/index.ts.
 const pkg=process.env.RUNTIME==="node"?"@libsql/client":"drizzle-orm/d1";
 const driver=__non_webpack_require__(pkg) as {createClient:(options:{url:string})=>SqlClient};
 const filename=path.resolve(process.env.SQLITE_DB_PATH||"./data/seeder.db");
 sqliteClient=driver.createClient({url:"file:"+filename});
 return sqliteClient;
}
function bindValue(v:unknown):SqlValue{
 if(v==null)return null;
 if(["string","number","bigint","boolean"].includes(typeof v))return v as SqlValue;
 if(v instanceof Uint8Array)return v;
 throw new Error("Unsupported OA SQL parameter type");
}
export function nodeOaDb(){
 return {prepare(sql:string){
  return {bind(...values:unknown[]){
   const args=values.map(bindValue);
   return {
    async first<T=Record<string,unknown>>():Promise<T|null>{
     const result=await getClient().execute({sql,args});
     return (result.rows[0] as T|undefined)??null;
    },
    async all<T=Record<string,unknown>>():Promise<{results:T[];success:boolean}>{
     const result=await getClient().execute({sql,args});
     return {results:result.rows as T[],success:true};
    },
    async run(){
     const result=await getClient().execute({sql,args});
     return {success:true,meta:{changes:result.rowsAffected,last_row_id:Number(result.lastInsertRowid??0)}};
    },
   };
  }};
 }};
}
export function nodeOaUploads(){
 const storage=getStorage();
 if(!storage)throw new Error("Local upload storage unavailable");
 return {
  async put(key:string,content:Uint8Array|ArrayBuffer,options?:{httpMetadata?:{contentType?:string}}){
   const bytes=content instanceof Uint8Array?content:new Uint8Array(content);
   const array=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
   await storage.put(key,array,{contentType:options?.httpMetadata?.contentType});
  },
  async get(key:string){
   const object=await storage.get(key);
   if(!object)return null;
   return {body:object.body,httpMetadata:{contentType:object.contentType},
    async arrayBuffer(){return new Response(object.body).arrayBuffer();}};
  },
  async delete(key:string){await storage.delete(key);},
 };
}
