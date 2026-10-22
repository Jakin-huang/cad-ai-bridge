import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {publishProjectReviewPackage,verifyProjectReviewPackage} from '../../src/project-review-package.mjs';import {compileProjectReview} from '../../src/project-review.mjs';import {hashFile} from '../../src/drawings.mjs';import {engineeringTaskSchema,readonlyEngineeringTaskSchema} from '../../src/engineering-task-contracts.mjs';
async function setup(t){
 const runs=await fs.mkdtemp(path.join(os.tmpdir(),'project-review-package-'));t.after(()=>fs.rm(runs,{recursive:true,force:true}));
 const source=path.join(runs,'original');await fs.mkdir(source);const file=path.join(source,'E01.pdf');await fs.writeFile(file,'Mock native bytes: packaging integrity test, not PDF rendering');
 const projectId=crypto.randomUUID(),jobId='job-task-'+crypto.randomUUID(),q={action:'project_review_package',requestId:crypto.randomUUID(),expectedProjectId:projectId,tasks:[{jobId,expectedTaskSHA256:'a'.repeat(64)}],scopeTaskJobId:jobId,requiredKinds:['ordinary-lighting']};
 const snapshots=[{status:{jobId,taskSHA256:'a'.repeat(64),task:{kind:'ordinary-lighting',title:'<script>alert(1)</script>'},pendingOperations:[],files:[{kind:'pdf',file,sha256:await hashFile(file)}],current:{revision:0,modelSHA256:'b'.repeat(64),status:'delivered',checks:{failed:0,pending:1},delivery:{modelSHA256:'b'.repeat(64),verification:{ok:true}}}},scope:{providesScope:true,current:true,ref:{jobId:'child',revision:0,sha256:'c'.repeat(64)},spaces:[{id:'A',name:'A & <B>'}],pending:['Review evidence']},graph:{sha256:'d'.repeat(64),nodes:[{id:'req:1',kind:'requirement',label:'Target',authority:'assumed',value:{quote:'<img src=x onerror=alert(2)>'},dependsOn:[]}],conflicts:[]}}];
 const report=compileProjectReview(q,snapshots);q.expectedReportSHA256=report.reportSHA256;return {runs,q,report,snapshots,file,assertCurrent:async()=>{}};
}
test('review package preserves bytes, exposes evidence, escapes HTML and replays without granting approval',async t=>{
 const f=await setup(t);assert.equal(engineeringTaskSchema.parse(f.q).action,'project_review_package');assert.throws(()=>readonlyEngineeringTaskSchema.parse(f.q));
 const r=await publishProjectReviewPackage(f);assert.equal(r.professionalApproval,false);assert.equal(r.engineeringAcceptance,false);const m=await verifyProjectReviewPackage(r.folder,r.manifestSHA256);assert.equal(m.sourceFileCount,1);
 const copy=r.files.find(a=>a.kind==='pdf');assert.equal(await hashFile(copy.file),await hashFile(f.file));const html=await fs.readFile(r.entry,'utf8');assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('假设'));assert.ok(html.includes('依据或假设需要核实'));assert.ok(html.includes('原始记录'));assert.match(html,/download="E01.pdf"/);assert.ok(html.includes('查看 CAD 图纸预览'));
 const resultFile=path.join(r.folder,'result.json'),saved=JSON.parse(await fs.readFile(resultFile,'utf8'));saved.professionalApproval=true;await fs.writeFile(resultFile,JSON.stringify(saved));const replay=await publishProjectReviewPackage(f);assert.equal(replay.replayed,true);assert.equal(replay.professionalApproval,false);
 await fs.appendFile(copy.file,'altered');await assert.rejects(publishProjectReviewPackage(f),/FILE_CHANGED/);
});
test('snapshot change during publication never yields a successful result or silently overwrites retained files',async t=>{
 const f=await setup(t);f.assertCurrent=async()=>{throw Error('PROJECT_REVIEW_CHANGED_DURING_PUBLICATION');};await assert.rejects(publishProjectReviewPackage(f),/CHANGED_DURING_PUBLICATION/);
 const folder=path.join(f.runs,'job-projectreview-'+f.q.requestId);await assert.rejects(fs.stat(path.join(folder,'result.json')),e=>e.code==='ENOENT');assert.equal(JSON.parse(await fs.readFile(path.join(folder,'task.json'),'utf8')).status,'blocked');
 f.assertCurrent=async()=>{};await assert.rejects(publishProjectReviewPackage(f),/UNCONFIRMED/);
});
test('stale expected report and changed source bytes cannot be packaged',async t=>{
 const f=await setup(t);await assert.rejects(publishProjectReviewPackage({...f,q:{...f.q,expectedReportSHA256:'f'.repeat(64)}}),/SNAPSHOT_CHANGED/);await fs.appendFile(f.file,'changed');await assert.rejects(publishProjectReviewPackage(f),/SOURCE_CHANGED/);
});
test('files outside owned runs cannot be copied even when their hash is known',async t=>{
 const f=await setup(t),outside=await fs.mkdtemp(path.join(os.tmpdir(),'review-external-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));const file=path.join(outside,'private.txt');await fs.writeFile(file,'outside');f.report.tasks[0].files=[{kind:'text',file,sha256:await hashFile(file)}];await assert.rejects(publishProjectReviewPackage(f),/SOURCE_OUTSIDE_RUNS/);
});
