import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';
import {createExecutor} from '../../src/runner.mjs';import {engineeringTestInput} from '../helpers/engineering-input.mjs';import {hashFile} from '../../src/drawings.mjs';
import {conditionsIntakeFixture} from '../helpers/conditions-intake.mjs';
const uuid=()=>crypto.randomUUID(),ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r;};
const lines=['Provide ordinary lighting for the selected declared spaces','Tenant furniture fitout is a later separately commissioned scope','Landscape design is requested but not supplied by the installed design adapters'];
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'scope-intake-')),runs=path.join(root,'runs');await fs.mkdir(runs);let native=0;
 const execute=createExecutor({runs,getSettings:async()=>({workspace:root}),launch:async()=>{native++;throw Error('Scope review must not launch CAD');}}),project={id:uuid(),name:'Independent scope without a room model',type:'development'};
 await fs.writeFile(root+'/brief.txt',lines.join('\n'));await fs.writeFile(root+'/reference.txt','Evaluation-only final layout must never enter a scope citation');
 const documents=[{id:'MAIN',title:'Declared development commission',versionLabel:'R1',role:'requirements',file:'brief.txt',expectedRawSHA256:await hashFile(root+'/brief.txt')},{id:'EVAL',title:'Isolated reference',versionLabel:'R1',role:'evaluation_only',file:'reference.txt',expectedRawSHA256:await hashFile(root+'/reference.txt')}];
 const set=ok(await execute('project_documents',{action:'create',requestId:uuid(),projectId:project.id,documents})).set;
 const blocks=ok(await execute('project_documents',{action:'source_blocks',set,limit:100})).items;assert.equal(blocks.length,3);
 const workItems=['candidate','deferred','unsupported'].map((disposition,i)=>({id:['LIGHT','TENANT','LANDSCAPE'][i],description:lines[i],disposition,...(i===0?{taskKind:'ordinary-lighting'}:{}),reason:'Explicit source interpretation for a mechanical development test only.',evidence:[{documentId:'MAIN',quote:lines[i]}],dependsOn:[]}));
 const q={action:'review_scope',requestId:uuid(),documents:set,workItems,sourceCoverage:blocks.map((b,i)=>({blockId:b.blockId,blockSHA256:b.blockSHA256,disposition:'mapped',targetIds:['workItems/'+i],reason:'Each original obligation stays linked to its declared scope disposition.'}))};
 const review=(changes={})=>execute('engineering_intake',{...q,requestId:uuid(),...changes});
 async function freeze(ref,kind='ordinary-lighting',workItemId='LIGHT'){
  await fs.writeFile(root+'/conditions.json',JSON.stringify(engineeringTestInput()));
  return execute('engineering_intake',{action:'freeze',requestId:uuid(),project,task:{kind,title:'Source-linked candidate task',objective:'Prepare the explicitly selected task without claiming other commission obligations are complete.'},documents:set,baselineFile:'conditions.json',expectedRawSHA256:await hashFile(root+'/conditions.json'),scope:{review:ref,workItemId}});
 }
 return {root,runs,execute,project,documents,set,q,review,freeze,native:()=>native};
}
test('scope review retains unsupported/deferred work without physical input, supports pages and selects only a matching candidate',async()=>{
 const f=await fixture(),r=ok(await f.execute('engineering_intake',f.q));assert.deepEqual(r.counts,{candidate:1,deferred:1,unsupported:1,unresolved:0,conflict:0,context:0});assert.equal(r.designReady,false);assert.equal(r.wholeProjectAccepted,false);assert.equal(r.candidates[0].canPrepareConditions,true);
 assert.equal((await fs.readdir(f.runs)).some(n=>/^job-(task|design|spaceplan|intake)-/.test(n)),false);
 const page=ok(await f.execute('engineering_intake',{action:'read_scope_review',review:r.review,section:'work_items',limit:1}));assert.equal(page.items[0].id,'LIGHT');assert.equal(page.nextOffset,1);assert.equal(page.items[0].citations[0].quote,lines[0]);
 const replay=ok(await f.execute('engineering_intake',f.q));assert.equal(replay.replayed,true);assert.deepEqual(replay.review,r.review);
 assert.equal((await f.freeze(r.review,'office-space-planning')).ok,false);assert.equal((await f.freeze(r.review,'ordinary-lighting','TENANT')).ok,false);
 const frozen=ok(await f.freeze(r.review));assert.deepEqual(frozen.scope,{review:r.review,workItemId:'LIGHT'});assert.equal(f.native(),0);
});
test('unreviewed source blocks and unresolved prerequisites cannot authorize conditions preparation',async()=>{
 const f=await fixture(),missing=ok(await f.review({sourceCoverage:[]}));assert.equal(missing.sourceCoverage.unreviewed,3);assert.equal(missing.candidates[0].canPrepareConditions,false);assert.equal((await f.freeze(missing.review)).ok,false);
 const work=structuredClone(f.q.workItems);work[0].dependsOn=['TENANT'];const dependent=ok(await f.review({workItems:work}));assert.equal(dependent.candidates[0].prerequisites[0].id,'TENANT');assert.equal((await f.freeze(dependent.review)).ok,false);
 work[1].disposition='candidate';work[1].taskKind='office-space-planning';const planned=ok(await f.review({workItems:work}));assert.equal(planned.candidates.find(r=>r.id==='LIGHT').canPrepareConditions,false,'Planning a predecessor is not completing it');assert.equal(f.native(),0);
});
test('unknown kinds, invalid dependency graphs, unrelated quotes and evaluator material are rejected before a scope record exists',async()=>{
 const f=await fixture(),variants=[];
 for(const mutate of [w=>w[0].taskKind='hospital',w=>w[0].dependsOn=['MISSING'],w=>{w[0].dependsOn=['TENANT'];w[1].dependsOn=['LIGHT'];},w=>w[0].evidence[0].quote='Invented requirement absent from the original source',w=>w[0].evidence=[{documentId:'EVAL',quote:'Evaluation-only final layout must never enter a scope citation'}],w=>w.push(structuredClone(w[0]))]){const w=structuredClone(f.q.workItems);mutate(w);variants.push(w);}
 for(const workItems of variants)assert.equal((await f.review({workItems})).ok,false);
 assert.equal((await fs.readdir(f.runs)).filter(n=>n.startsWith('job-scopereview-')).length,0);assert.equal(f.native(),0);
});
test('scope source revision and record tampering remain visible; read-only mode cannot create reviews',async()=>{
 const f=await fixture(),r=ok(await f.review()),frozen=ok(await f.freeze(r.review)),old=process.env.CADBRIDGE_READ_ONLY;
 try{process.env.CADBRIDGE_READ_ONLY='1';assert.equal((await f.execute('engineering_intake',{action:'read_scope_review',review:r.review})).ok,true);assert.equal((await f.review()).ok,false);}finally{if(old===undefined)delete process.env.CADBRIDGE_READ_ONLY;else process.env.CADBRIDGE_READ_ONLY=old;}
 await fs.appendFile(f.root+'/brief.txt','\nAdditional unresolved requirement');ok(await f.execute('project_documents',{action:'update',requestId:uuid(),set:f.set,documents:[{...f.documents[0],versionLabel:'R2',expectedRawSHA256:await hashFile(f.root+'/brief.txt')},f.documents[1]]}));
 const stale=ok(await f.execute('engineering_intake',{action:'read_scope_review',review:r.review}));assert.equal(stale.documentsCurrent,false);assert.equal(stale.candidates[0].canPrepareConditions,false);assert.equal((await f.freeze(r.review)).ok,false);
 const staleBaseline=ok(await f.execute('engineering_intake',{action:'status',baseline:frozen.baseline}));assert.equal(staleBaseline.documentsCurrent,false);assert.equal(staleBaseline.canCommit,false,'Unchanged historical scope stays readable after its source is superseded');
 const file=path.join(f.runs,r.review.jobId,'scope-review.json'),record=JSON.parse(await fs.readFile(file,'utf8'));record.workItems[1].disposition='context';await fs.writeFile(file,JSON.stringify(record));const changed=await f.execute('engineering_intake',{action:'read_scope_review',review:r.review});assert.equal(changed.ok,false);assert.match(changed.error.message,/SCOPE_REVIEW_CHANGED/);
});
test('reused request identity cannot replace a scope interpretation and source links must cite the actual paragraph',async()=>{
 const f=await fixture(),r=ok(await f.execute('engineering_intake',f.q));const work=structuredClone(f.q.workItems);work[0].description+=' changed';const reuse=await f.execute('engineering_intake',{...f.q,workItems:work});assert.equal(reuse.ok,false);assert.match(reuse.error.message,/SCOPE_REVIEW_REQUEST_CONFLICT/);
 const coverage=structuredClone(f.q.sourceCoverage);coverage[0].targetIds=['workItems/1'];assert.equal((await f.review({sourceCoverage:coverage})).ok,false);
 const file=path.join(f.runs,r.review.jobId,'scope-review.json'),record=JSON.parse(await fs.readFile(file,'utf8'));record.workItems[1].disposition='candidate';record.workItems[1].taskKind='office-space-planning';await fs.writeFile(file,JSON.stringify(record));
 const tamperedReplay=await f.execute('engineering_intake',f.q);assert.equal(tamperedReplay.ok,false);assert.match(tamperedReplay.error.message,/SCOPE_REVIEW_CHANGED/);
});
test('an installed analysis adapter is not falsely offered as a supported intake preparation route',async()=>{
 const f=await fixture(),caps=ok(await f.execute('engineering_task',{action:'capabilities',section:'summary'}));assert.ok(caps.adapters.some(a=>a.id==='drawing-analysis'));
 const work=structuredClone(f.q.workItems);work[0].taskKind='drawing-analysis';const r=await f.review({workItems:work});assert.equal(r.ok,false);assert.match(r.error.message,/SCOPE_CANDIDATE_INTAKE_UNSUPPORTED/);
});
test('a scope-linked frozen input rechecks scope integrity in status and adoption before creating a formal task',async()=>{
 const f=await conditionsIntakeFixture('ordinary-lighting'),text=await fs.readFile(f.root+'/requirements.txt','utf8'),blocks=ok(await f.execute('project_documents',{action:'source_blocks',set:f.set,limit:100})).items;
 const scope=ok(await f.execute('engineering_intake',{action:'review_scope',requestId:uuid(),documents:f.set,workItems:[{id:'LIGHT',description:'Prepare the explicitly scoped development lighting design',disposition:'candidate',taskKind:'ordinary-lighting',reason:'Known development scope used to verify adoption integrity only.',evidence:[{documentId:'MAIN',quote:text}]}],sourceCoverage:blocks.map(b=>({blockId:b.blockId,blockSHA256:b.blockSHA256,disposition:'mapped',targetIds:['workItems/0'],reason:'Known mechanical test scope contains the declared source requirements.'}))}));
 const frozen=ok(await f.execute('engineering_intake',{action:'freeze',requestId:uuid(),project:f.project,task:{kind:'ordinary-lighting',title:'Scope-bound preparation',objective:'Verify scope is checked again after a physical baseline and logical draft have been prepared.'},documents:f.set,baselineFile:'conditions.json',expectedRawSHA256:f.inspection.rawSHA256,scope:{review:scope.review,workItemId:'LIGHT'}}));
 const draft=ok(await f.execute('engineering_intake',{action:'draft',requestId:uuid(),baseline:frozen.baseline,parameters:await f.cover(f.parameters)}));assert.equal(draft.ready,true);
 const file=path.join(f.runs,scope.review.jobId,'scope-review.json'),record=JSON.parse(await fs.readFile(file,'utf8'));record.workItems[0].disposition='deferred';await fs.writeFile(file,JSON.stringify(record));
 const status=await f.execute('engineering_intake',{action:'status',baseline:frozen.baseline});assert.equal(status.ok,false);assert.match(status.error.message,/SCOPE_REVIEW_CHANGED/);
 const rejected=await f.execute('engineering_intake',{action:'commit',requestId:uuid(),baseline:frozen.baseline,draft:draft.draft,expectedInputSHA256:draft.inputSHA256,reviewed:true});assert.equal(rejected.ok,false);assert.match(rejected.error.message,/SCOPE_REVIEW_CHANGED/);assert.equal((await fs.readdir(f.runs)).some(n=>n.startsWith('job-task-')),false);
});
