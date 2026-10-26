#!/usr/bin/env node
// Parse reviewed OA TypeScript/TSX sources before expensive Next.js production builds.
// Resolve TypeScript from the target Seeder app, not the overlay repository.
import {createRequire} from "node:module";
import {readdirSync,readFileSync,statSync} from "node:fs";
import {resolve,join,relative} from "node:path";

const app=resolve(process.argv[2]||"seeder-oa-app");
const requireFromApp=createRequire(join(app,"package.json"));
let ts;
try{ts=requireFromApp("typescript")}
catch(e){console.error("ERROR: TypeScript not installed in Seeder app; run npm ci before checking",e.message);process.exit(2)}
const roots=["app/api/oa","components/oa","lib/oa"];
let count=0,failures=0;
function walk(path){
  if(!statSync(path).isDirectory()){
    if(!/\.tsx?$/.test(path))return;
    const source=readFileSync(path,"utf8");
    const sf=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,path.endsWith(".tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    count++;
    for(const d of sf.parseDiagnostics){
      const loc=sf.getLineAndCharacterOfPosition(d.start||0);
      console.error("FAIL "+relative(app,path)+":"+(loc.line+1)+":"+(loc.character+1)+" "+ts.flattenDiagnosticMessageText(d.messageText," "));
      failures++;
    }
    return;
  }
  for(const e of readdirSync(path,{withFileTypes:true})){
    if(e.name==="node_modules"||e.name===".next")continue;
    walk(join(path,e.name));
  }
}
for(const root of roots)walk(join(app,root));
if(failures){console.error("OA syntax preflight failed: "+failures+" parse diagnostics.");process.exit(1)}
console.log("PASS OA TypeScript/TSX syntax preflight: "+count+" files parsed");
