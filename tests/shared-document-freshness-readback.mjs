// Read-only compatibility check on an existing native project; no client or CAD trial.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {dataHome,outsideProject,projectPath} from '../src/local-paths.mjs';
import {hashFile} from '../src/drawings.mjs';
const [priorArg,targetArg]=process.argv.slice(2);assert.ok(priorArg&&targetArg,'Supply previous private evidence directory and new output directory');
const prior=outsideProject(path.resolve(priorArg)),root=outsideProject(path.resolve(targetArg));
const read=async f=>JSON.parse(await fs.readFile(f,'utf8')),old=await read(prior+'/retained-task-manifest.json'),pack=await read(prior+'/project-package/report.json');
for(const f of old.files)assert.equal(await hashFile(f.file),f.sha256,f.file);
await fs.mkdir(root,{recursive:false});
const client=new Client({name:'shared-document-freshness-readback',version:'1'}),report={ok:false,newNativeCad:false,newAiClient:false,professionalApproval:false,calls:[],protectedFiles:old.files,protectedReferences:old.protectedReferences};
async function call(q){const raw=await client.callTool({name:'cad_engineering_task',arguments:q},{timeout:120000}),result=JSON.parse(raw.content.find(c=>c.type==='text').text);report.calls.push({q,result});assert.equal(result.ok,true,JSON.stringify(result));return result;}
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[projectPath('mcp-server.mjs')],env:{...process.env,CADBRIDGE_READ_ONLY:'1',CADAGENT_ALLOWED_ROOT:dataHome()},stderr:'pipe'}));
 const q=pack.calls.find(c=>c.action==='project_review');assert.ok(q);
 const result=await call({...q,expectedReportSHA256:pack.packet.reportSHA256});assert.equal(result.reportSHA256,pack.packet.reportSHA256);
 for(const t of q.tasks){const status=await call({action:'status',...t,expectedProjectId:q.expectedProjectId});if(t.jobId===q.scopeTaskJobId){const pages=await call({action:'data',...t,expectedProjectId:q.expectedProjectId,section:'spaces',revision:status.current.revision,expectedDataSHA256:status.current.sharedSpaces.ref.sha256,limit:100});assert.equal(pages.current,true);assert.equal(pages.total,11);assert.equal(pages.hasMore,false);}else assert.equal(status.current.spaceProgram.current,true);}
 for(const f of old.files)assert.equal(await hashFile(f.file),f.sha256,f.file);
 for(const r of old.protectedReferences)assert.equal(await hashFile(r.id==='plugin'?projectPath(r.file):path.join(dataHome(),r.file)),r.sha256,r.file);
 report.ok=true;report.summary=result.summary;report.reportSHA256=result.reportSHA256;report.scope='Known existing native project read-only compatibility. Document-revision failure/recovery is separately covered by controller regression, not a new native or AI trial.';
}finally{await client.close().catch(()=>{});await fs.writeFile(root+'/readback.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});}
console.log(JSON.stringify({ok:report.ok,calls:report.calls.length,protectedFiles:old.files.length,protectedReferences:old.protectedReferences.length}));
