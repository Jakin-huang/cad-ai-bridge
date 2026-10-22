import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {compileProjectReview,projectReviewPage} from '../../src/project-review.mjs';
import {readonlyEngineeringTaskSchema} from '../../src/engineering-task-contracts.mjs';
import {fixture,designed,published} from '../helpers/shared-space-fixture.mjs';
import {sharedLightingInput} from '../helpers/shared-spaces.mjs';
import {planningBrief} from '../helpers/space-input.mjs';
import os from 'node:os';
import {z} from 'zod';
import {createEngineeringTaskManager} from '../../src/engineering-task-manager.mjs';
const taskRef=r=>({jobId:r.jobId,expectedTaskSHA256:r.taskSHA256});
const invoke=(r,operation,parameters)=>({action:'invoke',...taskRef(r),expectedProjectId:r.project.id,requestId:crypto.randomUUID(),operation,parameters});
test('project review reports missing lighting spaces, stale cross-pack coverage and immutable pagination without any native work',async()=>{
 const f=await fixture(),projectId=crypto.randomUUID(),{p,b,d}=await designed(f,projectId),h=await published(f,b,d),selected=['MEETING','TEAM','OFFICE_A','CIRCULATION'];
 const l=await f.manager.run({action:'prepare',requestId:crypto.randomUUID(),project:{id:projectId,name:'Shared project review',type:'developer-test'},task:{kind:'ordinary-lighting',title:'Partial scope lighting',objective:'Verify cross-task scope completeness without implying engineering approval'},parameters:{action:'prepare',project:sharedLightingInput(h.pack,h.ref,selected)}});
 const ld=await f.manager.run(invoke(l,'design',{expectedRevision:0}));assert.equal(ld.ok,true);
 const q={action:'project_review',expectedProjectId:projectId,tasks:[taskRef(b),taskRef(l)],scopeTaskJobId:b.jobId,requiredKinds:['ordinary-lighting']},before=f.effects();
 const tree=async dir=>{const rows=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())rows.push(...await tree(file));else rows.push([file,crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')]);}return rows.sort((a,b)=>a[0].localeCompare(b[0]));};const originalFiles=await tree(f.runs);
 assert.equal(readonlyEngineeringTaskSchema.parse(q).action,'project_review');
 const env=process.env.CADBRIDGE_READ_ONLY;let r;try{process.env.CADBRIDGE_READ_ONLY='1';r=await f.manager.run(q);}finally{if(env===undefined)delete process.env.CADBRIDGE_READ_ONLY;else process.env.CADBRIDGE_READ_ONLY=env;}assert.equal(r.summary.scopeSpaces,11);assert.equal(r.summary.issuesByCode.SPACE_DESIGN_MISSING,7);assert.equal(r.summary.issuesByCode.SPACE_DELIVERY_MISSING,11);assert.equal(r.summary.deliveryCoverageComplete,false);assert.equal(r.engineeringAcceptance,false);assert.equal(f.effects(),before);
 const rows=[];for(let offset=0;offset<11;offset+=3){const page=await f.manager.run({...q,section:'spaces',offset,limit:3,expectedReportSHA256:r.reportSHA256});rows.push(...page.items);}
 assert.deepEqual(await tree(f.runs),originalFiles);
 const packageRequest={...q,action:'project_review_package',requestId:crypto.randomUUID(),expectedReportSHA256:r.reportSHA256};
 const packet=await f.manager.run(packageRequest);assert.equal(packet.ok,true);assert.equal(packet.summary.deliveryCoverageComplete,false);assert.equal(packet.professionalApproval,false);assert.equal(f.effects(),before);
 for(const [file,sha]of originalFiles)assert.equal(crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'),sha);
 assert.equal((await f.manager.run(packageRequest)).replayed,true);
 assert.equal(rows.length,11);assert.equal(rows.filter(r=>r.disciplines[0].designedBy.length===1).length,4);
 await assert.rejects(()=>f.manager.run({...q,expectedProjectId:crypto.randomUUID()}),/PROJECT_MISMATCH/);
 await assert.rejects(()=>f.manager.run({...q,tasks:[taskRef(b),taskRef(b)]}),/DUPLICATE_SCOPE/);
 const changed=structuredClone(p);changed.title='Same scope new brief';planningBrief(changed);
 const revised=await f.manager.run(invoke(b,'revise_program',{expectedRevision:0,expectedInputSHA256:d.current.inputSHA256,brief:changed.brief,program:changed.program,relations:changed.relations,parameters:changed.parameters,reason:'Explicit upstream program revision invalidates previous shared space publication'}));assert.equal(revised.ok,true);
 await assert.rejects(()=>f.manager.run(q),/PUBLISHED_SCOPE_REQUIRED/);
 await assert.rejects(()=>f.manager.run(packageRequest),/PUBLISHED_SCOPE_REQUIRED|SNAPSHOT_CHANGED/);
 // Historical pages cannot be requested through a stale current-report token.
 await assert.rejects(()=>f.manager.run({...q,expectedReportSHA256:r.reportSHA256,section:'spaces'}),/PUBLISHED_SCOPE_REQUIRED|SNAPSHOT_CHANGED/);
 assert.equal(f.effects(),before);
});
function snapshots(){
 const ref={jobId:'child',revision:0,sha256:'a'.repeat(64)},q={expectedProjectId:crypto.randomUUID(),scopeTaskJobId:'source',requiredKinds:['lighting'],section:'summary'};
 const snap=(jobId,kind,ids,providesScope=false)=>({status:{jobId,taskSHA256:'b'.repeat(64),task:{kind,title:kind},pendingOperations:[],files:[],current:{status:'delivered',modelSHA256:'c'.repeat(64),checks:{passed:1,failed:0,pending:1},delivery:{modelSHA256:'c'.repeat(64),verification:{ok:true}}}},scope:{providesScope,ref,current:true,spaces:ids.map(id=>({id})),pending:['Source and professional applicability still pending']},graph:{sha256:'d'.repeat(64),nodes:[{id:'standard:S',kind:'standard',label:'Unverified source clause',authority:'unverified',value:{edition:'declared'}}],conflicts:[]}});
 return {q,rows:[snap('source','planning',['A','B'],true),snap('light','lighting',['A','B'])]};
}
test('complete declared coverage never becomes engineering approval and duplicate design tasks remain ambiguous',()=>{
 const {q,rows}=snapshots(),r=compileProjectReview(q,rows);assert.equal(r.summary.deliveryCoverageComplete,true);assert.equal(r.summary.engineeringAcceptance,false);assert.ok(r.summary.issuesByCode.EVIDENCE_REVIEW_REQUIRED);assert.ok(r.summary.openIssues>0);
 const copy=structuredClone(rows[1]);copy.status.jobId='other-light';const ambiguous=compileProjectReview(q,[...rows,copy]);assert.equal(ambiguous.summary.deliveryCoverageComplete,false);assert.equal(ambiguous.summary.issuesByCode.SPACE_TASK_SELECTION_AMBIGUOUS,2);
 assert.throws(()=>projectReviewPage(r,{...q,expectedReportSHA256:'f'.repeat(64)}),/SNAPSHOT_CHANGED/);
});
test('same room IDs cannot hide different producer revision, stale documents, unconfirmed operation or constraint conflict',()=>{
 for(const change of [s=>s.scope.ref={...s.scope.ref,revision:1},s=>s.scope.current=false,s=>s.status.current.documentEvidence={current:true,modelCurrent:false},s=>s.status.pendingOperations=[{operation:'deliver',requestId:'uncertain'}],s=>s.graph.conflicts=[{code:'CONSTRAINT_INTERVAL_CONFLICT'}],s=>s.status.current.delivery.modelSHA256='f'.repeat(64)]){
  const {q,rows}=snapshots();change(rows[1]);const r=compileProjectReview(q,rows);assert.equal(r.summary.deliveryCoverageComplete,false);assert.equal(r.summary.issuesByCode.SPACE_DELIVERY_MISSING,2);
 }
});
test('a task changing during aggregate capture cannot publish a mixed-version project snapshot',async()=>{
 const runs=await fs.mkdtemp(path.join(os.tmpdir(),'project-review-race-'));let drift=false,reads=0;
 const adapter={id:'test-design',version:1,complexDesign:true,validatePrepare:x=>x,prepare:async()=>({child:'test'}),inspect:async()=>({status:'designed',revision:drift?reads++:0,modelSHA256:'a'.repeat(64),checks:{failed:0,pending:1},files:[]}),dependencyNodes:async()=>[],projectReviewScope:async()=>({providesScope:true,current:true,ref:{jobId:'test-child',revision:0,sha256:'b'.repeat(64)},spaces:[{id:'A'}],pending:[]}),prepareSchema:z.strictObject({}),operationSchemas:{}};
 const manager=createEngineeringTaskManager({runs,adapters:[adapter]}),p=await manager.run({action:'prepare',requestId:crypto.randomUUID(),project:{id:crypto.randomUUID(),name:'Snapshot consistency',type:'test'},task:{kind:adapter.id,title:'Snapshot consistency',objective:'Reject aggregate snapshot when any included task changes'},parameters:{}});
 drift=true;await assert.rejects(()=>manager.run({action:'project_review',expectedProjectId:p.project.id,tasks:[taskRef(p)],scopeTaskJobId:p.jobId,requiredKinds:[adapter.id]}),/CHANGED_DURING_READ/);
});
test('a retained delivery cannot cover a space after its current quality check explicitly fails',()=>{
 const {q,rows}=snapshots();rows[1].graph.nodes.push({id:'check:quality',kind:'check',label:'Current optical assessment',value:{passed:false}});
 const report=compileProjectReview(q,rows);assert.equal(report.summary.deliveryCoverageComplete,false);assert.equal(report.summary.issuesByCode.CHECK_RESULT_FAILED,1);assert.equal(report.summary.issuesByCode.SPACE_DELIVERY_MISSING,2);
 assert.equal(report.tasks[1].modelSHA256,'c'.repeat(64));assert.equal(report.tasks[1].delivered,false);
});
