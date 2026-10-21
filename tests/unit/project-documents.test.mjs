import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createExecutor} from '../../src/runner.mjs';
import {engineeringInputSchema} from '../../src/engineering-contracts.mjs';
import {spacePlanningInputSchema} from '../../src/space-planning-contracts.mjs';
import {engineeringTestInput} from '../helpers/engineering-input.mjs';
import {spaceTestInput} from '../helpers/space-input.mjs';
import {hashFile} from '../../src/drawings.mjs';
import {dependencyDigest} from '../../src/task-dependencies.mjs';
import {createEngineeringTaskManager} from '../../src/engineering-task-manager.mjs';
import {createEngineeringTaskAdapters} from '../../src/engineering-task-adapters.mjs';
import {schemas} from '../../src/contracts.mjs';
const uuid=()=>crypto.randomUUID(),sha=t=>crypto.createHash('sha256').update(t).digest('hex');
const bound=r=>({jobId:r.jobId,expectedProjectId:r.project.id,expectedTaskSHA256:r.taskSHA256});
const invoke=(r,operation,parameters)=>({action:'invoke',...bound(r),requestId:uuid(),operation,parameters});
const ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r;};
async function fixture(kind='ordinary-lighting'){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'project-documents-')),runs=path.join(root,'runs'),projectId=uuid();await fs.mkdir(runs);let native=0;
 const execute=createExecutor({runs,getSettings:async()=>({workspace:root}),launch:async()=>{native++;throw Error('Native execution is forbidden in this source-management regression');}});
 const input=kind==='ordinary-lighting'?engineeringInputSchema.parse(engineeringTestInput()):spacePlanningInputSchema.parse(spaceTestInput());
 async function file(id,text,role='requirements',versionLabel='R0'){const name=id+'-'+uuid()+'.txt';await fs.writeFile(path.join(root,name),text);return {id,title:'Known synthetic '+id,versionLabel,role,file:name,expectedRawSHA256:sha(text)};}
 const docs=[await file('MAIN',input.brief),await file('VALUES',JSON.stringify(input),'coordination'),await file('REFERENCE','Evaluation-only drawing outcome; never design input.','evaluation_only')];
 const request={action:'create',requestId:uuid(),projectId,documents:docs},set=ok(await execute('project_documents',request)).set;
 const task=ok(await execute('engineering_task',{action:'prepare',requestId:uuid(),project:{id:projectId,name:'Reusable document lifecycle',type:'synthetic-scope'},task:{kind,title:'Source managed task',objective:'Verify distinct original documents and task switching without using final reference outputs.'},documents:set,parameters:kind==='ordinary-lighting'?{action:'prepare',project:input}:{input}}));
 async function targets(r=task,s=set){const rows=[];let offset=0;do{const p=ok(await execute('project_documents',{action:'targets',task:bound(r),set:s,offset,limit:5}));rows.push(...p.items);offset=p.nextOffset;if(offset===null)return {...p,items:rows};}while(true);}
 async function reviewRequest(r=task,s=set){const t=await targets(r,s),meta=ok(await execute('project_documents',{action:'read',set:s})),source=meta.items.find(d=>d.id==='VALUES');return {action:'review',requestId:uuid(),task:bound(r),set:s,expectedInputSHA256:t.inputSHA256,decisions:t.items.map(t=>({targetIds:[t.id],expectedValuesSHA256:t.singleTargetValuesSHA256,disposition:'supported',reason:'Known fixture values cited for mechanical coverage; semantic acceptance remains false.',citations:[{documentId:'VALUES',textSHA256:source.textSHA256,quote:JSON.stringify(t.value)}]})),documentDispositions:meta.items.filter(d=>d.role!=='evaluation_only').map(d=>({documentId:d.id,disposition:d.id==='VALUES'?'used':'context',reason:'Explicit source disposition in a known synthetic regression.'}))};}
 async function bind(r=task,s=set){const q=await reviewRequest(r,s),review=ok(await execute('project_documents',q));assert.equal(review.ready,true);const bindQ={action:'bind',requestId:uuid(),task:bound(r),set:s,expectedInputSHA256:q.expectedInputSHA256,review:review.review};return {result:ok(await execute('project_documents',bindQ)),q:bindQ,review};}
 const status=r=>execute('engineering_task',{action:'status',...bound(r??task)});
 const design=r=>execute('engineering_task',invoke(r??task,'design',kind==='ordinary-lighting'?{expectedRevision:(r??task).current.revision}:{expectedRevision:(r??task).current.revision,expectedInputSHA256:(r??task).current.inputSHA256,budget:{maxNodes:50000,maxMilliseconds:10000,maxPlans:1}}));
 return {root,runs,projectId,kind,input,execute,file,docs,request,set,task,targets,reviewRequest,bind,status,design,native:()=>native};
}
for(const kind of ['ordinary-lighting','office-space-planning']){
 test(kind+': unresolved document review blocks design, accepted mechanical coverage binds actual model; source update blocks reuse and preserves bytes',async()=>{
  const f=await fixture(kind);assert.equal(f.task.current.documentEvidence.reviewReady,false);assert.equal((await f.design()).ok,false);assert.equal(await fs.stat(path.join(f.runs,f.task.current.jobId,'model-0.json')).then(()=>true,()=>false),false);
  if(kind==='ordinary-lighting'){const direct=await f.execute('engineering',{action:'design',jobId:f.task.current.jobId,expectedRevision:0});assert.equal(direct.ok,false);assert.match(direct.error.message,/DOCUMENT_REVIEW_REQUIRED/);}
  const boundReview=await f.bind(),designed=ok(await f.design());assert.ok(designed.current.modelSHA256);assert.equal(designed.current.documentEvidence.eligible,true);assert.equal(designed.current.documentEvidence.semanticCoverageAccepted,false);
  const modelFile=path.join(f.runs,f.task.current.jobId,'model-0.json'),modelSHA=await hashFile(modelFile),metadata=ok(await f.execute('project_documents',{action:'read',set:f.set}));assert.equal(metadata.items.length,3);assert.ok(metadata.items.every(d=>d.authority==='declared_unverified'));
  const journal=JSON.parse(await fs.readFile(path.join(f.runs,f.task.current.jobId,kind==='ordinary-lighting'?'engineering.json':'space-planning.json'),'utf8'));assert.equal(journal.history.find(h=>h.event==='designed').documentBindingSHA256,designed.current.documentEvidence.bindingSHA256);
  const update=ok(await f.execute('project_documents',{action:'update',requestId:uuid(),set:f.set,documents:f.docs})),stale=ok(await f.status());assert.equal(stale.current.documentEvidence.documentsCurrent,false);assert.equal(stale.current.documentEvidence.eligible,false);assert.equal(await hashFile(modelFile),modelSHA);const prepareReplay=ok(await f.execute('engineering_task',{action:'prepare',requestId:f.task.jobId.slice('job-task-'.length),project:f.task.project,task:f.task.task,documents:f.set,parameters:kind==='ordinary-lighting'?{action:'prepare',project:f.input}:{input:f.input}}));assert.equal(prepareReplay.replayed,true);assert.equal(prepareReplay.current.documentEvidence.eligible,false);
  for(const operation of ['design','deliver','review_pdfs']){const parameters=operation==='design'?(kind==='ordinary-lighting'?{expectedRevision:0}:{expectedRevision:0,expectedInputSHA256:stale.current.inputSHA256}):{expectedModelSHA256:stale.current.modelSHA256,...(operation==='review_pdfs'?{expectedSourceSHA256:'b'.repeat(64)}:{})};assert.equal((await f.execute('engineering_task',invoke(stale,operation,parameters))).ok,false);}
  const rebound=await f.bind(stale,update.set);assert.equal(rebound.result.modelRecomputationRequired,true);assert.equal((await f.design(stale)).ok,false);assert.equal(await hashFile(modelFile),modelSHA);assert.equal(f.native(),0);
  const historical=ok(await f.execute('project_documents',{action:'read',set:f.set}));assert.equal(historical.current,false);assert.equal(historical.set.sha256,f.set.sha256);
  const oldBindReplay=ok(await f.execute('project_documents',rebound.q));assert.equal(oldBindReplay.replayed,true);assert.equal(oldBindReplay.active,true);assert.ok(boundReview.result.bindingSHA256);
 });
 test(kind+': new input requires a fresh full review before recomputation, without changing the other task',async()=>{
  const f=await fixture(kind);await f.bind();const first=ok(await f.design()),oldFile=path.join(f.runs,first.current.jobId,'model-0.json'),oldSHA=await hashFile(oldFile);
  let parameters;if(kind==='ordinary-lighting')parameters={expectedRevision:0,changes:[{requirementId:'REQ_0',value:350,sourceId:'BRIEF',reason:'Synthetic new explicit target, all values will be re-reviewed against new coordination source.'}]};else parameters={expectedRevision:0,expectedInputSHA256:first.current.inputSHA256,brief:f.input.brief+'\nSynthetic revision requires a new evidence review.',program:f.input.program,relations:f.input.relations,parameters:f.input.parameters,reason:'Explicit synthetic program revision for document dependency invalidation.'};
  const revised=ok(await f.execute('engineering_task',invoke(first,kind==='ordinary-lighting'?'revise':'revise_program',parameters)));assert.equal(revised.current.documentEvidence.inputCurrent,false);assert.equal((await f.design(revised)).ok,false);
  const nextInput=JSON.parse(await fs.readFile(path.join(f.runs,first.current.jobId,'input-1.json'),'utf8')),docs=[await f.file('MAIN',nextInput.brief,'requirements','R1'),await f.file('VALUES',JSON.stringify(nextInput),'coordination','R1'),f.docs[2]],next=ok(await f.execute('project_documents',{action:'update',requestId:uuid(),set:f.set,documents:docs}));
  await f.bind(revised,next.set);const again=ok(await f.design(revised));assert.equal(again.current.revision,1);assert.equal(again.current.documentEvidence.eligible,true);assert.notEqual(again.current.modelSHA256,first.current.modelSHA256);assert.equal(await hashFile(oldFile),oldSHA);assert.equal(f.native(),0);
 });
}
test('partial coverage, changed actual values, concatenated quotes, evaluation references and document conflicts cannot become ready bindings',async()=>{
 const f=await fixture(),original=await f.reviewRequest();
 const missing=structuredClone(original);missing.requestId=uuid();missing.decisions.pop();assert.match((await f.execute('project_documents',missing)).error.message,/COVERAGE_INCOMPLETE/);
 const changed=structuredClone(original);changed.requestId=uuid();changed.decisions[0].expectedValuesSHA256='0'.repeat(64);assert.match((await f.execute('project_documents',changed)).error.message,/VALUES_CHANGED/);
 const bad=structuredClone(original);bad.requestId=uuid();bad.decisions[0].citations[0].quote='non-adjacent quote assembled by a client';assert.match((await f.execute('project_documents',bad)).error.message,/LITERAL_CITATION_INVALID/);
 const leak=structuredClone(original);leak.requestId=uuid();leak.decisions[0].citations[0].documentId='REFERENCE';assert.match((await f.execute('project_documents',leak)).error.message,/EVALUATION_CONTENT_FORBIDDEN/);
 const conflict=structuredClone(original);conflict.requestId=uuid();conflict.decisions[0].disposition='conflict';const blocked=ok(await f.execute('project_documents',conflict));assert.equal(blocked.ready,false);const bind=await f.execute('project_documents',{action:'bind',requestId:uuid(),task:bound(f.task),set:f.set,expectedInputSHA256:original.expectedInputSHA256,review:blocked.review});assert.match(bind.error.message,/REVIEW_BLOCKED/);assert.equal(f.native(),0);
});
test('original UTF-8 bytes, BOM and line endings remain distinct and history cannot launder evaluation identities or bytes',async()=>{
 const f=await fixture(),text='\uFEFF原始文档\r\n保持换行\r\n',doc=await f.file('SPECIAL',text,'coordination'),set=ok(await f.execute('project_documents',{action:'update',requestId:uuid(),set:f.set,documents:[...f.docs,doc]})).set;
 const read=ok(await f.execute('project_documents',{action:'read',set,documentId:'SPECIAL'}));assert.equal(read.items.map(r=>r.text).join(''),text.slice(1));assert.equal(read.document.rawSHA256,sha(text));assert.equal(read.document.textSHA256,sha(text.slice(1)));
 const double=await f.file('DOUBLE','\uFEFF\uFEFFRetain the second actual character.','background'),doubleSet=ok(await f.execute('project_documents',{action:'create',requestId:uuid(),projectId:uuid(),documents:[double]})).set;assert.equal(ok(await f.execute('project_documents',{action:'read',set:doubleSet,documentId:'DOUBLE'})).items[0].text,'\uFEFFRetain the second actual character.');
 const deny=await f.execute('project_documents',{action:'read',set,documentId:'REFERENCE'});assert.match(deny.error.message,/EVALUATION_CONTENT_FORBIDDEN/);
 const removed=ok(await f.execute('project_documents',{action:'update',requestId:uuid(),set,documents:[f.docs[0],f.docs[1]]}));
 for(const entry of [{...f.docs[2],id:'RENAMED',role:'requirements'},await f.file('REFERENCE','Different bytes still cannot promote a retained evaluation identity.','requirements')]){const r=await f.execute('project_documents',{action:'update',requestId:uuid(),set:removed.set,documents:[f.docs[0],f.docs[1],entry]});assert.match(r.error.message,/EVALUATION_INPUT_LEAK/);}
 const crossSet=await f.execute('project_documents',{action:'create',requestId:uuid(),projectId:f.projectId,documents:[{...f.docs[2],id:'NEW_SET_INPUT',role:'requirements'}]});assert.match(crossSet.error.message,/EVALUATION_INPUT_LEAK/);
 const outside={...doc,file:path.join(path.dirname(f.root),'not-in-input-root.txt')};await fs.writeFile(outside.file,'Outside root');outside.expectedRawSHA256=sha('Outside root');assert.match((await f.execute('project_documents',{action:'update',requestId:uuid(),set:removed.set,documents:[outside]})).error.message,/OUTSIDE_ROOT/);
});
test('task/project boundaries, original and review tampering fail closed; known tasks remain readable',async()=>{
 const f=await fixture(),rq=await f.reviewRequest(),review=ok(await f.execute('project_documents',rq));
 const other=ok(await f.execute('engineering_task',{action:'prepare',requestId:uuid(),project:f.task.project,task:{kind:'ordinary-lighting',title:'Other task',objective:'Retain the exact same input as a separate task to reject cross-task review reuse.'},parameters:{action:'prepare',project:f.input}}));
 assert.match((await f.execute('project_documents',{action:'bind',requestId:uuid(),task:bound(other),set:f.set,expectedInputSHA256:rq.expectedInputSHA256,review:review.review})).error.message,/WRONG_TASK_OR_INPUT/);
 const foreign={...bound(f.task),expectedProjectId:uuid()};assert.equal((await f.execute('project_documents',{action:'targets',task:foreign,set:f.set})).ok,false);
 const reviewFile=path.join(f.runs,review.review.jobId,'review.json'),bytes=await fs.readFile(reviewFile);await fs.appendFile(reviewFile,' '); // Formatting alone does not change canonical content identity.
 assert.equal(dependencyDigest(JSON.parse(await fs.readFile(reviewFile,'utf8'))),review.review.sha256);const bad=JSON.parse(bytes);bad.ready=false;await fs.writeFile(reviewFile,JSON.stringify(bad));assert.match((await f.execute('project_documents',{action:'bind',requestId:uuid(),task:bound(f.task),set:f.set,expectedInputSHA256:rq.expectedInputSHA256,review:review.review})).error.message,/REVIEW_CHANGED/);await fs.writeFile(reviewFile,bytes);
 const meta=ok(await f.execute('project_documents',{action:'read',set:f.set})),snapshot=path.join(f.runs,f.set.jobId,'snapshot-'+meta.items[0].rawSHA256+'.bin');await fs.appendFile(snapshot,' changed');assert.match((await f.status()).error.message,/SNAPSHOT_CHANGED/);
 assert.equal((await f.execute('engineering_task',{action:'status',...bound(other)})).ok,true);assert.equal(f.native(),0);
});
test('reviews are fully readable after becoming historical, dependency graph excludes evaluation inputs, and missing required bindings do not fall back to legacy behavior',async()=>{
 const f=await fixture(),boundReview=await f.bind(),design=ok(await f.design()),bindingFile=path.join(f.runs,f.task.current.jobId,'document-binding.json'),bytes=await fs.readFile(bindingFile);
 const review=ok(await f.execute('project_documents',{action:'read_review',task:bound(f.task),review:boundReview.review.review,section:'targets',limit:100}));assert.equal(review.current,true);assert.equal(review.total,(await f.targets()).items.length);
 const nodes=[];let offset=0;do{const p=ok(await f.execute('engineering_task',{action:'dependencies',...bound(f.task),offset,limit:100}));nodes.push(...p.items);offset=p.nextOffset;if(!p.hasMore)break;}while(true);
 const evaluation=nodes.find(n=>n.id==='documents:source:REFERENCE');assert.equal(evaluation.sourceRole,'reference');assert.ok(nodes.find(n=>n.id==='design:model').dependsOn.includes('documents:review'));assert.ok(!nodes.find(n=>n.id==='documents:review').dependsOn.includes(evaluation.id));assert.ok(nodes.some(n=>n.id.startsWith('documents:target:requirements/')));
 await fs.unlink(bindingFile);assert.match((await f.execute('engineering',{action:'design',jobId:f.task.current.jobId,expectedRevision:0})).error.message,/REQUIRED_BINDING_MISSING/);await fs.writeFile(bindingFile,bytes);
 const markerFile=path.join(f.runs,f.task.current.jobId,'document-required.json'),markerBytes=await fs.readFile(markerFile);await fs.unlink(markerFile);await fs.unlink(bindingFile);assert.match((await f.execute('engineering',{action:'design',jobId:f.task.current.jobId,expectedRevision:0})).error.message,/REQUIRED_BINDING_MISSING/);await fs.writeFile(markerFile,markerBytes);await fs.writeFile(bindingFile,bytes);
 const update=ok(await f.execute('project_documents',{action:'update',requestId:uuid(),set:f.set,documents:f.docs}));const historic=ok(await f.execute('project_documents',{action:'read_review',task:bound(f.task),review:boundReview.review.review}));assert.equal(historic.current,false);assert.equal(historic.items[0].ready,true);assert.equal((await f.execute('project_documents',f.request)).set.sha256,f.set.sha256);
 const v0=path.join(f.runs,f.set.jobId,'version-0.json'),old=await fs.readFile(v0),modified=JSON.parse(old);modified.documents[2].role='requirements';await fs.writeFile(v0,JSON.stringify(modified));assert.match((await f.execute('project_documents',{action:'read',set:update.set})).error.message,/HISTORY_CHANGED/);await fs.writeFile(v0,old);assert.equal((await f.status()).current.modelSHA256,design.current.modelSHA256);
});
test('read-only mode exposes only immutable document inspection and refuses local source/review mutations',async()=>{
 const f=await fixture(),before=await fs.readdir(f.runs),old=process.env.CADBRIDGE_READ_ONLY;try{process.env.CADBRIDGE_READ_ONLY='1';assert.equal((await f.execute('project_documents',{action:'read',set:f.set})).ok,true);assert.equal((await f.execute('project_documents',{action:'targets',task:bound(f.task),set:f.set})).ok,true);assert.equal((await f.execute('project_documents',{action:'update',requestId:uuid(),set:f.set,documents:f.docs})).ok,false);assert.deepEqual(await fs.readdir(f.runs),before);}finally{if(old===undefined)delete process.env.CADBRIDGE_READ_ONLY;else process.env.CADBRIDGE_READ_ONLY=old;}
});
test('an interrupted document-aware preparation cannot expose a legacy design path before its binding is published',async()=>{
 const f=await fixture(),base=createEngineeringTaskAdapters({schemas,execute:f.execute,runs:f.runs})[0],requestId=uuid(),childJobId='job-design-'+requestId,adapter={...base,async prepare(parameters,id,manifest){await base.prepare(parameters,id,manifest);const during=await f.execute('engineering',{action:'design',jobId:childJobId,expectedRevision:0});assert.equal(during.ok,false);assert.match(during.error.message,/DOCUMENT_REQUIRED_BINDING_MISSING/);throw Error('Injected interruption after the non-native child preparation');}},manager=createEngineeringTaskManager({runs:f.runs,adapters:[adapter]});
 await assert.rejects(()=>manager.run({action:'prepare',requestId,project:f.task.project,task:f.task.task,documents:f.set,parameters:{action:'prepare',project:f.input}}),/Injected interruption/);
 const direct=await f.execute('engineering',{action:'design',jobId:childJobId,expectedRevision:0});assert.equal(direct.ok,false);assert.match(direct.error.message,/DOCUMENT_REQUIRED_BINDING_MISSING/);assert.equal(await fs.stat(path.join(f.runs,childJobId,'model-0.json')).then(()=>true,()=>false),false);assert.equal(f.native(),0);
});
