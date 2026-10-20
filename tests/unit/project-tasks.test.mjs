import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {createProjectManager} from '../../src/project-tasks.mjs';
import {schemas} from '../../src/contracts.mjs';
import {hashFile} from '../../src/drawings.mjs';
import {atomicJson} from '../../src/files.mjs';
async function setup(t,{fail=false,gate}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cad-project-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const runs=path.join(root,'runs');await fs.mkdir(runs);const a=path.join(root,'a.dwg'),b=path.join(root,'b.dwg');await fs.writeFile(a,'original A');await fs.writeFile(b,'original B');const calls=[];
 const execute=async(action,args)=>{calls.push({action,args});if(gate&&calls.length===1)await gate;const job=path.join(runs,'job-workflow-'+args.requestId);await fs.mkdir(job,{recursive:true});const file=path.join(job,'output.dwg');await fs.copyFile(args.drawing,file);const result={ok:!fail,drawing:file,drawingSaved:true,drawingSha256:await hashFile(file),outcome:'saved',jobRoot:job,files:[{kind:'dwg',file,sha256:await hashFile(file)}],...(fail?{error:{code:'POSTCHECK_FAILED'}}:{})};await atomicJson(path.join(job,'result.json'),result);return result;};
 const manager=createProjectManager({execute,getSettings:async()=>({workspace:root}),runs});
 const request=()=>schemas.project.parse({action:'start',requestId:crypto.randomUUID(),items:[{id:'A',drawing:a,preview:false,plan:{type:'replace_text',search:'OLD',replacement:'NEW'}},{id:'B',drawing:b,plan:{type:'takeoff'}}]});return {root,runs,a,b,calls,manager,request,execute};
}
test('project freezes all inputs, retains per-item hashes and never reruns same UUID',async t=>{
 const f=await setup(t),args=f.request(),started=await f.manager.run(args);await f.manager.wait(started.jobId);const result=await f.manager.run({action:'status',jobId:started.jobId});assert.equal(result.status,'completed');assert.equal(result.items.length,2);assert.equal(f.calls.length,2);assert.notEqual(f.calls[0].args.drawing,f.a);assert.equal(await fs.readFile(f.a,'utf8'),'original A');assert.ok((await f.manager.run(args)).replayed);assert.equal(f.calls.length,2);await assert.rejects(f.manager.run({...args,failurePolicy:'continue'}),/REQUEST_ID_CONFLICT/);
});
test('cancel waits for in-flight save and resume runs only untouched items',async t=>{
 let release;const gate=new Promise(resolve=>{release=resolve;}),f=await setup(t,{gate}),started=await f.manager.run(f.request());while(!f.calls.length)await new Promise(resolve=>setTimeout(resolve,5));await f.manager.run({action:'cancel',jobId:started.jobId});release();await f.manager.wait(started.jobId);const stopped=await f.manager.run({action:'status',jobId:started.jobId});assert.equal(stopped.status,'cancelled');assert.deepEqual(stopped.items.map(i=>i.status),['completed','cancelled']);await f.manager.run({action:'resume',jobId:started.jobId});await f.manager.wait(started.jobId);assert.equal(f.calls.length,2);assert.equal((await f.manager.run({action:'status',jobId:started.jobId})).status,'completed');
});
test('lost worker reconciles retained child and blocks unknown write without replay',async t=>{
 const f=await setup(t),id='job-project-'+crypto.randomUUID(),job=path.join(f.runs,id);await fs.mkdir(job);const child='job-workflow-'+crypto.randomUUID();await fs.mkdir(path.join(f.runs,child));const completed={ok:true,outcome:'saved',files:[]};await atomicJson(path.join(f.runs,child,'result.json'),completed);
 const items=[{id:'A',status:'running',childJobId:child,sourceDrawing:f.a,inputSha256:await hashFile(f.a),spec:{plan:{type:'replace_text'}}},{id:'B',status:'running',childJobId:'job-workflow-missing',sourceDrawing:f.b,inputSha256:await hashFile(f.b),spec:{plan:{type:'replace_text'}}}];await atomicJson(path.join(job,'task.json'),{jobId:id,action:'project',status:'running',phase:'executing',items});await f.manager.run({action:'resume',jobId:id});await f.manager.wait(id);const result=await f.manager.run({action:'status',jobId:id});assert.equal(result.status,'blocked');assert.deepEqual(result.items.map(i=>i.status),['completed','blocked']);assert.equal(f.calls.length,0);assert.equal(result.items[1].error.code,'PROJECT_WRITE_UNCONFIRMED');
});
test('stop policy retains saved failure, and changed original is visible independently of frozen execution',async t=>{
 const f=await setup(t,{fail:true}),started=await f.manager.run(f.request());await f.manager.wait(started.jobId);const stopped=await f.manager.run({action:'status',jobId:started.jobId});assert.equal(stopped.status,'stopped');assert.equal(stopped.items[0].result.drawingSaved,true);assert.equal(f.calls.length,1);
 await fs.writeFile(f.b,'externally changed');await f.manager.run({action:'resume',jobId:started.jobId});await f.manager.wait(started.jobId);const result=await f.manager.run({action:'status',jobId:started.jobId});assert.equal(result.status,'partial');assert.notEqual(result.items[1].sourceIntegrity.expectedSha256,result.items[1].sourceIntegrity.actualSha256);assert.equal(await fs.readFile(f.calls[1].args.drawing,'utf8'),'original B');assert.equal(f.calls.length,2);
});
test('preflight rejects stale identity before any CAD launch, and read-only mode rejects project writes',async t=>{
 const f=await setup(t),args=f.request();args.items[1].expectedSha256='0'.repeat(64);await assert.rejects(f.manager.run(args),/STALE_FILE/);assert.equal(f.calls.length,0);const old=process.env.CADBRIDGE_READ_ONLY;process.env.CADBRIDGE_READ_ONLY='1';try{await assert.rejects(f.manager.run(f.request()),/READ_ONLY/);}finally{if(old===undefined)delete process.env.CADBRIDGE_READ_ONLY;else process.env.CADBRIDGE_READ_ONLY=old;}
});
test('resume detects a changed completed output and never repeats its write',async t=>{
 const f=await setup(t),started=await f.manager.run(f.request());await f.manager.wait(started.jobId);const before=await f.manager.run({action:'status',jobId:started.jobId});await fs.appendFile(before.items[0].result.drawing,'changed');await f.manager.run({action:'resume',jobId:started.jobId});await f.manager.wait(started.jobId);const after=await f.manager.run({action:'status',jobId:started.jobId});assert.equal(after.status,'blocked');assert.equal(after.items[0].status,'blocked');assert.equal(f.calls.length,2);
});
test('failed exports recover read-only from the saved hash without changing the historical edit result',async t=>{
 const f=await setup(t),started=await f.manager.run(f.request());await f.manager.wait(started.jobId);const taskFile=path.join(f.runs,started.jobId,'task.json'),state=JSON.parse(await fs.readFile(taskFile,'utf8'));state.items[0].spec.delivery={exports:[{name:'sheet',format:'pdf'},{name:'preview',format:'png'}]};state.items[0].result.exports=[{name:'sheet',ok:true},{name:'preview',ok:false}];await atomicJson(taskFile,state);
 const result=await f.manager.run({action:'reexport',jobId:started.jobId,itemId:'A',requestId:crypto.randomUUID()});assert.equal(result.readOnlyRecovery,true);assert.equal(f.calls.at(-1).args.plan.type,'export_batch');assert.deepEqual(f.calls.at(-1).args.plan.items.map(i=>i.name),['preview']);assert.equal(f.calls.at(-1).args.drawing,state.items[0].result.drawing);assert.equal(f.calls.length,3);assert.equal((await f.manager.run({action:'status',jobId:started.jobId})).items[0].deliveryRetries.length,1);
});
