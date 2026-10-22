const fs=require('fs'),path=require('path');
let ts;
try {ts=require('typescript')} catch {
 try {ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript')} catch {console.error('TypeScript compiler not found; cannot check syntax');process.exit(2)}
}
const root=process.argv[2];if(!root){process.exit(2)}
const files=[];function walk(p){for(const e of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,e.name);if(e.isDirectory())walk(f);else if(/\.tsx?$/.test(e.name))files.push(f)}}walk(root);
let errors=0;for(const f of files){const src=fs.readFileSync(f,'utf8');const result=ts.transpileModule(src,{fileName:f,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.Preserve,target:ts.ScriptTarget.ES2022}});for(const d of result.diagnostics||[]){if(d.category===ts.DiagnosticCategory.Error){errors++;console.error(f+': '+ts.flattenDiagnosticMessageText(d.messageText,' '))}}}
console.log(`TypeScript/TSX syntax: ${files.length} files, ${errors} errors`);if(errors)process.exit(1);
