import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fixture,source,published} from '../helpers/shared-space-fixture.mjs';
import {spaceTestInput} from '../helpers/space-input.mjs';
import {sharedLightingInput} from '../helpers/shared-spaces.mjs';
import {createProjectDocumentManager} from '../../src/project-documents.mjs';
import {dependencyDigest} from '../../src/task-dependencies.mjs';
import {hashFile} from '../../src/drawings.mjs';
import {loadPlanningHandoff} from '../../src/space-planning-handoff.mjs';
const uuid=()=>crypto.randomUUID(),bound=r=>({jobId:r.jobId,expectedProjectId:r.project.id,expectedTaskSHA256:r.taskSHA256});
const invoke=(r,operation,parameters)=>({action:'invoke',...bound(r),requestId:uuid(),operation,parameters});
const ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r;};

test('upstream document revision invalidates a published space pack and downstream delivery until its model is rebuilt',async()=>{
 const f=await fixture(),projectId=uuid(),p=await source(f,spaceTestInput());
 const documents=createProjectDocumentManager({runs:f.runs,getInputRoot:async()=>f.runs,taskContext:f.manager.documentContext});
 const text='Known synthetic source for a freshness regression; every design value remains a developer assumption.';
 const file=path.join(f.runs,'source.txt');await fs.writeFile(file,text);
 const descriptor={id:'MAIN',title:'Synthetic freshness test',versionLabel:'R0',role:'requirements',file:'source.txt',expectedRawSHA256:await hashFile(file)};
 const set=ok(await documents.run({action:'create',requestId:uuid(),projectId,documents:[descriptor]})).set;
 const b=ok(await f.manager.run({action:'prepare',requestId:uuid(),project:{id:projectId,name:'Cross-task document freshness',type:'synthetic'},task:{kind:'office-space-planning',title:'Source-bound space plan',objective:'Verify document invalidation across task boundaries; no semantic or professional acceptance.'},documents:set,parameters:{input:p}}));
 async function bind(set){
  const targets=ok(await documents.run({action:'targets',task:bound(b),set,limit:100}));assert.equal(targets.nextOffset,null);
  const meta=ok(await documents.run({action:'read',set})).items[0],blocks=ok(await documents.run({action:'source_blocks',set,limit:100})).items;
  const review=ok(await documents.run({action:'review',requestId:uuid(),task:bound(b),set,expectedInputSHA256:targets.inputSHA256,decisions:[{targetIds:targets.items.map(t=>t.id),expectedValuesSHA256:dependencyDigest(targets.items.map(({id,value})=>({id,value}))),disposition:'assumption',reason:'Known developer input used only to verify cross-task freshness, not interpretation.',citations:[{documentId:'MAIN',textSHA256:meta.textSHA256,quote:await fs.readFile(file,'utf8')}]}],documentDispositions:[{documentId:'MAIN',disposition:'used',reason:'Explicit synthetic source lifecycle for this mechanical regression.'}],sourceCoverage:blocks.map(r=>({blockId:r.blockId,blockSHA256:r.blockSHA256,disposition:'mapped',targetIds:targets.items.map(t=>t.id),reason:'Explicit developer assumption statement, not independent source authority.'}))}));
  assert.equal(review.ready,true);return ok(await documents.run({action:'bind',requestId:uuid(),task:bound(b),set,expectedInputSHA256:targets.inputSHA256,review:review.review}));
 }
 await bind(set);
 const d=ok(await f.manager.run(invoke(b,'design',{expectedRevision:0,expectedInputSHA256:b.current.inputSHA256}))),h=await published(f,b,d);
 assert.equal((await loadPlanningHandoff(h.ref,{runs:f.runs,expectedProjectId:projectId})).current,true);
 const input=sharedLightingInput(h.pack,h.ref,['RECEPTION','MEETING','TEAM','OFFICE_A','CIRCULATION']);
 const l=ok(await f.manager.run({action:'prepare',requestId:uuid(),project:b.project,task:{kind:'ordinary-lighting',title:'Downstream freshness',objective:'Reject stale upstream document evidence before native delivery.'},parameters:{action:'prepare',project:input}}));
 const ld=ok(await f.manager.run(invoke(l,'design',{expectedRevision:0}))),files=(await f.manager.run({action:'status',...bound(b)})).files;
 await fs.writeFile(file,text+' Replacement source version requires a fresh review before further design.');
 const updated=ok(await documents.run({action:'update',requestId:uuid(),set,documents:[{...descriptor,versionLabel:'R1',expectedRawSHA256:await hashFile(file)}]})).set;
 const loaded=await loadPlanningHandoff(h.ref,{runs:f.runs,expectedProjectId:projectId});
 assert.equal(loaded.current,false,'A still-delivered model must not authorize stale upstream documents');
 assert.equal(loaded.currentProducer.documentEvidence.eligible,false);
 const historicalPage=ok(await f.manager.run({action:'data',...bound(b),section:'spaces',revision:0,limit:100}));assert.equal(historicalPage.current,false);assert.equal(historicalPage.total,11);
 const effects=f.effects(),blocked=await f.manager.run(invoke(l,'deliver',{expectedModelSHA256:ld.current.modelSHA256}));assert.equal(blocked.ok,false);assert.match(JSON.stringify(blocked),/SHARED_SOURCE_SUPERSEDED/);assert.equal(f.effects(),effects);
 const report=ok(await f.manager.run({action:'project_review',expectedProjectId:projectId,tasks:[b,l].map(r=>({jobId:r.jobId,expectedTaskSHA256:r.taskSHA256})),scopeTaskJobId:b.jobId,requiredKinds:['office-space-planning','ordinary-lighting']}));assert.equal(report.summary.designCoverageComplete,false);assert.ok(report.summary.issuesByCode.SCOPE_SOURCE_STALE);
 await bind(updated);
 const rebound=await loadPlanningHandoff(h.ref,{runs:f.runs,expectedProjectId:projectId});assert.equal(rebound.current,false,'Rebinding alone cannot bless an old model');assert.equal(rebound.currentProducer.documentEvidence.current,true);assert.equal(rebound.currentProducer.documentEvidence.modelCurrent,false);
 for(const item of files)assert.equal(await hashFile(item.file),item.sha256);
 // Restoring validity requires a new model and native delivery; old reference stays historical.
 const revised=ok(await f.manager.run(invoke(b,'revise_program',{expectedRevision:0,expectedInputSHA256:d.current.inputSHA256,brief:p.brief,program:p.program,relations:p.relations,parameters:p.parameters,reason:'Explicitly reconfirm the synthetic program under the new document version.'})));
 await bind(updated);
 const rebuilt=ok(await f.manager.run(invoke(b,'design',{expectedRevision:1,expectedInputSHA256:revised.current.inputSHA256}))),next=await published(f,b,rebuilt);
 assert.equal((await loadPlanningHandoff(next.ref,{runs:f.runs,expectedProjectId:projectId})).current,true);
 assert.equal((await loadPlanningHandoff(h.ref,{runs:f.runs,expectedProjectId:projectId})).current,false);
 for(const item of files)assert.equal(await hashFile(item.file),item.sha256);
});
