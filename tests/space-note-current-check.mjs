// Read-only controller regression after the source-bound R1 client session.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {projectPath} from '../src/local-paths.mjs';
import {hashFile} from '../src/drawings.mjs';
import {startTaskCenter} from '../src/task-center.mjs';
import {getJob} from '../src/jobs.mjs';
const [original,phase]=process.argv.slice(2).map(p=>path.resolve(p));
assert.ok(process.argv[2]&&process.argv[3]);
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const audit=await read(phase+'/independent-audit.json'),old=await read(original+'/three-kind-switch-regression.json');
const runs=original+'/data/runs',state=await read(path.join(runs,audit.jobId,'space-planning.json'));
const lighting=old.controllerTasks.lighting,analysis=old.controllerTasks.analysis;
const litExpected=old.calls.find(c=>c.args.jobId===lighting.jobId&&c.args.operation==='design').result.current;
const priorState=await read(phase+'/state-r0.json');
assert.equal(audit.wholeClientTrialPassed,true);
assert.equal(state.revision,1);
const beforeRuns=(await fs.readdir(runs)).sort(),protectedFiles=[],seen=new Set();
for(const f of [...audit.files,...await read(phase+'/protected-before.json'),{file:path.join(runs,audit.jobId,'space-planning.json')},{file:path.join(runs,audit.jobId,'document-binding.json')},{file:phase+'/events.ndjson'},{file:phase+'/independent-audit.json'}]){
 if(!seen.has(f.file)){seen.add(f.file);protectedFiles.push({file:f.file,sha256:await hashFile(f.file)});}
}
const c=new Client({name:'source-note-r1-readonly-regression',version:'1'});
const report={ok:false,actualMcpProtocol:true,readOnly:true,postClientControllerRegression:true,actualAiPerformedThisSwitch:false,newNativeCadExecuted:false,newTasksCreated:0,professionalApproval:false,calls:[],downloads:[]};
let center;
try{
 await c.connect(new StdioClientTransport({command:process.execPath,args:[projectPath('mcp-server.mjs')],env:{...process.env,CADBRIDGE_DATA_HOME:original+'/data',CADAGENT_ALLOWED_ROOT:original+'/workspace',CADBRIDGE_READ_ONLY:'1'},stderr:'pipe'}));
 for(const [type,task] of [['space',audit.task],['lighting',lighting],['space',audit.task],['analysis',analysis],['space',audit.task],['lighting',lighting],['analysis',analysis],['space',audit.task]]){
  const raw=await c.callTool({name:'cad_engineering_task',arguments:{action:'status',...task}},{timeout:60000});
  const r=JSON.parse(raw.content.find(t=>t.type==='text').text);assert.equal(r.ok,true,JSON.stringify(r));
  if(type==='space'){assert.equal(r.current.modelSHA256,audit.modelSHA256);assert.equal(r.current.inputSHA256,audit.inputSHA256);assert.equal(r.current.documentEvidence.eligible,true);assert.equal(r.current.status,'delivered');}
  else if(type==='lighting'){assert.equal(r.current.modelSHA256,litExpected.modelSHA256);assert.equal(r.current.inputSHA256,litExpected.inputSHA256);}
  else{assert.equal(r.current.sourceSHA256,priorState.delivery.drawingSHA256);assert.notEqual(r.current.sourceSHA256,state.delivery.drawingSHA256);assert.equal(r.current.quantityResults[0].total,20);assert.equal(r.current.summary.issues,0);}
  report.calls.push({type,task,current:r.current});
 }
 const linked=await getJob(runs,{jobId:audit.jobId});assert.equal(linked.parentJobId,audit.task.jobId);assert.equal(linked.status,'linked');
 report.childNavigation={jobId:audit.jobId,parentJobId:linked.parentJobId};
 center=await startTaskCenter({runs,execute:async()=>{throw Error('Read-only downloads');}});
 const headers={Authorization:'Bearer '+center.token};
 const files=audit.files.filter(f=>['pdf','dwg'].includes(f.kind)||/^source-index-1\.(json|csv)$/.test(path.basename(f.file)));
 assert.equal(files.length,8);
 for(const f of files)for(const jobId of [audit.jobId,audit.task.jobId]){
  const r=await fetch(center.origin+'/api/file?jobId='+jobId+'&sha256='+f.sha256,{headers});assert.equal(r.status,200);
  const sha=crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex');assert.equal(sha,f.sha256);
  report.downloads.push({jobId,file:path.basename(f.file),sha256:sha});
 }
 for(const f of protectedFiles)assert.equal(await hashFile(f.file),f.sha256,f.file);
 assert.deepEqual((await fs.readdir(runs)).sort(),beforeRuns);
 report.protectedFiles=protectedFiles;report.ok=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{await fs.writeFile(phase+'/current-source-readonly.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});await center?.close();await c.close();}
console.log(JSON.stringify({ok:report.ok,calls:report.calls.length,downloads:report.downloads.length,protectedFiles:report.protectedFiles?.length,error:report.error}));
