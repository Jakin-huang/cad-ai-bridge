// Existing-task compatibility only; no new design, CAD or AI/model calls.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {dataHome,outsideProject} from '../src/local-paths.mjs';
import {hashFile} from '../src/drawings.mjs';
const [folder,spaceFolder,sharedFolder]=process.argv.slice(2).map(p=>outsideProject(path.resolve(p)));assert.ok(folder&&spaceFolder&&sharedFolder);
const read=async p=>JSON.parse(await fs.readFile(p,'utf8')),runs=path.join(dataHome(),'runs'),now=await read(path.join(folder,'journal.json')),oldSpace=await read(path.join(spaceFolder,'journal.json')),oldShared=await read(path.join(sharedFolder,'journal.json')),bound=t=>({jobId:t.jobId,expectedProjectId:t.project.id,expectedTaskSHA256:t.taskSHA256});
const sequence=[oldSpace.lightingBefore.identity,bound(oldSpace.taskB),bound(oldShared.lightingTask),bound(oldSpace.taskC),bound(now.lightingTask),oldSpace.lightingBefore.identity],before=new Map();
for(const q of sequence){if(before.has(q.jobId))continue;const binding=await read(path.join(runs,q.jobId,'binding.json')),child=path.join(runs,binding.childJobId),state=await read(path.join(child,binding.childJobId.startsWith('job-spaceplan-')?'space-planning.json':'engineering.json')),files=[];
 for(const name of ['input-'+state.revision+'.json',...(state.modelSHA256?['model-'+state.revision+'.json']:[])])files.push({file:path.join(child,name),sha256:await hashFile(path.join(child,name))});
 for(const f of state.delivery?.files??state.files??[]){assert.equal(await hashFile(f.file),f.sha256);files.push(f);}
 before.set(q.jobId,{revision:state.revision,inputSHA256:state.inputSHA256,modelSHA256:state.modelSHA256,files});
}
assert.equal(before.get(oldSpace.lightingBefore.identity.jobId).modelSHA256,oldSpace.lightingBefore.modelSHA256);
assert.equal(before.get(oldSpace.taskB.jobId).modelSHA256,oldSpace.design1.current.modelSHA256);
assert.equal(before.get(oldShared.lightingTask.jobId).modelSHA256,oldShared.lightingDesign1.current.modelSHA256);
const client=new Client({name:'known-design-compatibility-readback',version:'1.0.0'}),report={ok:false,knownTasks:true,scope:'Read-only persisted state/byte checks, not unseen design quality or semantic acceptance',newCadOrDesign:false,professionalApproval:false,calls:[],hashChecks:0};
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('mcp-server.mjs')],env:{...process.env,CADAGENT_ALLOWED_ROOT:dataHome(),CADBRIDGE_READ_ONLY:'1'},stderr:'pipe'}));
 for(const q of sequence){const reply=await client.callTool({name:'cad_engineering_task',arguments:{action:'status',...q}}),r=JSON.parse(reply.content.find(c=>c.type==='text').text);assert.equal(r.ok,true,JSON.stringify(r));const prior=before.get(q.jobId);for(const key of ['revision','inputSHA256','modelSHA256'])assert.equal(r.current[key],prior[key]);for(const file of prior.files){assert.equal(await hashFile(file.file),file.sha256);report.hashChecks++;}report.calls.push({identity:q,revision:r.current.revision,inputSHA256:r.current.inputSHA256,modelSHA256:r.current.modelSHA256,files:prior.files.length});}
 report.ok=true;report.distinctTasks=before.size;await fs.writeFile(path.join(folder,'known-task-portability-readback.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({ok:true,calls:report.calls.length,tasks:report.distinctTasks,hashChecks:report.hashChecks}));
}finally{await client.close();}
