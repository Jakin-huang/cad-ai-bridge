import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createExecutor} from '../../src/runner.mjs';
import {dependencyDigest as digest} from '../../src/task-dependencies.mjs';
import {hashFile} from '../../src/drawings.mjs';
import {planningAssetsInput} from '../helpers/planning-assets-input.mjs';
import {assetRevisionDelta} from '../../src/planning-asset-revisions.mjs';
const uuid=()=>crypto.randomUUID(),ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r;},reason='Explicit synthetic source revision; no authority or professional approval is inferred.';
async function fixture(type='office',role='coordination',mode='update'){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'asset-revision-')),runs=root+'/runs';await fs.mkdir(runs);let native=0;
 const execute=createExecutor({runs,getSettings:async()=>({workspace:root}),launch:async()=>{native++;throw Error('No native execution in unit verification');}}),input=planningAssetsInput(type),project={id:uuid(),name:'Synthetic source revision',type:'development'},task={kind:'office-space-planning',title:'Edit retained assets',objective:reason};
 await fs.writeFile(root+'/main.txt',input.brief);const docs=[{id:'MAIN',title:'Declared initial brief',versionLabel:'R0',role:'requirements',file:'main.txt',expectedRawSHA256:await hashFile(root+'/main.txt')}];
 const set=ok(await execute('project_documents',{action:'create',requestId:uuid(),projectId:project.id,coveragePolicy:'fields_only',documents:docs})).set;
 const prepared=ok(await execute('engineering_task',{action:'prepare',requestId:uuid(),project,task,documents:set,parameters:{input}})),binding={jobId:prepared.jobId,expectedProjectId:project.id,expectedTaskSHA256:prepared.taskSHA256},dir=path.join(runs,prepared.current.jobId);
 const status=async()=>ok(await execute('engineering_task',{action:'status',...binding})),invoke=(operation,parameters,requestId=uuid())=>execute('engineering_task',{action:'invoke',...binding,operation,parameters,requestId});
 async function review(set){const s=(await status()).current,targets=ok(await execute('project_documents',{action:'targets',task:binding,set,limit:100})).items,citations=[{documentId:'MAIN',textSHA256:crypto.createHash('sha256').update(input.brief).digest('hex'),quote:input.brief}];
  const r=ok(await execute('project_documents',{action:'review',requestId:uuid(),task:binding,set,expectedInputSHA256:s.inputSHA256,decisions:targets.map(t=>({targetIds:[t.id],expectedValuesSHA256:t.singleTargetValuesSHA256,disposition:'assumption',reason,citations})),documentDispositions:[{documentId:'MAIN',disposition:'used',reason},...(set.revision?[{documentId:'CHANGE',disposition:'context',reason}]:[])]}));
  return ok(await execute('project_documents',{action:'bind',requestId:uuid(),task:binding,set,expectedInputSHA256:s.inputSHA256,review:r.review}));
 }
 await review(set);ok(await invoke('design',{expectedRevision:0,expectedInputSHA256:prepared.current.inputSHA256,budget:{maxNodes:50000,maxMilliseconds:10000,maxPlans:1}}));
 const assets=structuredClone(input.assets),changed=assets.find(a=>a.id==='PRINTER'),oldQuote=changed.evidenceQuote;changed.widthMm+=200;changed.evidenceQuote='PRINTER width is now '+changed.widthMm+' mm; its other declared physical conditions and assumed grade remain unchanged.';
 if(mode==='remove'){assets.splice(assets.findIndex(a=>a.id==='RETAIN'),1);Object.assign(changed,input.assets.find(a=>a.id==='PRINTER'));}
 const text=mode==='remove'?'Remove RETAIN from this synthetic inventory; preserve all remaining assets and their assumed physical conditions.':changed.evidenceQuote;await fs.writeFile(root+'/change.txt',text);
 const newSet=ok(await execute('project_documents',{action:'update',requestId:uuid(),set,documents:[...docs,{id:'CHANGE',title:'Declared amendment',versionLabel:'R1',role,file:'change.txt',expectedRawSHA256:await hashFile(root+'/change.txt')}]})).set;
 const evidence=[{documentId:'CHANGE',textSHA256:crypto.createHash('sha256').update(text).digest('hex'),quote:text}],s=(await status()).current,q={expectedRevision:0,expectedInputSHA256:s.inputSHA256,documents:newSet,brief:input.brief.replace(oldQuote,changed.evidenceQuote),assets,changes:assetRevisionDelta(input.assets,assets).map(d=>({...d,reason,evidence})),reason};
 return {root,runs,dir,input,set,newSet,execute,binding,status,invoke,review,q,evidence,native:()=>native};
}
for(const type of ['hospital','school','office'])test(type+': same task revises sourced assets, invalidates old model, requires new document review and preserves history',async()=>{
 const f=await fixture(type),modelSHA=await hashFile(f.dir+'/model-0.json'),r=ok(await f.invoke('revise_assets',f.q));assert.equal(r.current.revision,1);assert.equal(r.current.modelSHA256,undefined);assert.equal(r.current.pdfReview,undefined);assert.equal(r.current.documentEvidence.eligible,false);assert.equal(f.native(),0);
 const next=JSON.parse(await fs.readFile(f.dir+'/input-1.json','utf8')),strip=a=>Object.fromEntries(Object.entries(a).filter(([k])=>k!=='sourceIds'));
 assert.deepEqual(strip(next.shell),strip(f.input.shell));assert.deepEqual(next.program.map(strip),f.input.program.map(strip));assert.deepEqual(next.assets.find(a=>a.id==='RETAIN').fixed,f.input.assets.find(a=>a.id==='RETAIN').fixed);assert.equal(next.assets.find(a=>a.id==='PRINTER').widthMm,f.q.assets.find(a=>a.id==='PRINTER').widthMm);assert.ok(next.assets.every(a=>a.status==='assumed'));
 assert.equal((await f.invoke('design',{expectedRevision:1,expectedInputSHA256:r.current.inputSHA256})).ok,false);await f.review(f.newSet);const d=ok(await f.invoke('design',{expectedRevision:1,expectedInputSHA256:r.current.inputSHA256,budget:{maxNodes:50000,maxMilliseconds:10000,maxPlans:1}}));assert.equal(d.current.audit.failed,0);assert.equal(await hashFile(f.dir+'/model-0.json'),modelSHA);
 const state=JSON.parse(await fs.readFile(f.dir+'/space-planning.json','utf8')),journal=f.dir+'/'+state.assetRevisions[0].file,bytes=await fs.readFile(journal);await fs.appendFile(journal,'\n');assert.equal((await f.execute('engineering_task',{action:'status',...f.binding})).ok,false);await fs.writeFile(journal,bytes);assert.equal((await f.status()).current.revision,1);
});
test('stale source, omitted/forged delta, wrong quote/hash/retention action and grade upgrade cannot mutate the task',async()=>{
 const f=await fixture(),state=await hashFile(f.dir+'/space-planning.json');
 for(const mutate of [q=>q.documents=f.set,q=>q.changes=[],q=>q.changes[0].expectedAssetSHA256='0'.repeat(64),q=>q.changes[0].evidence[0].quote='This text was never present in the original source.',q=>q.changes[0].retentionAction='release',q=>q.assets.find(a=>a.id==='PRINTER').status='interpreted',q=>q.assets.pop()]){
  const q=structuredClone(f.q);mutate(q);const r=await f.invoke('revise_assets',q);assert.equal(r.ok,false);assert.equal(await hashFile(f.dir+'/space-planning.json'),state);assert.equal(await fs.stat(f.dir+'/input-1.json').then(()=>true,()=>false),false);
 }
 // The old entry point must reject assets rather than accept and ignore them.
 const raw={expectedRevision:0,expectedInputSHA256:f.q.expectedInputSHA256,brief:f.q.brief,program:f.input.program,parameters:f.input.parameters,relations:f.input.relations,assets:f.q.assets,reason};assert.equal((await f.invoke('revise_program',raw)).ok,false);assert.equal(await hashFile(f.dir+'/space-planning.json'),state);assert.equal(f.native(),0);
});
test('fixed removal is explicit and cannot masquerade as unchanged retention',async()=>{
 const f=await fixture('office','coordination','remove'),q=structuredClone(f.q);q.assets=structuredClone(f.input.assets).filter(a=>a.id!=='RETAIN');q.brief=f.input.brief;q.changes=assetRevisionDelta(f.input.assets,q.assets).map(d=>({...d,reason,evidence:f.evidence}));
 assert.equal(q.changes[0].retentionAction,'remove');q.changes[0].retentionAction='unchanged';assert.equal((await f.invoke('revise_assets',q)).ok,false);q.changes[0].retentionAction='remove';ok(await f.invoke('revise_assets',q));assert.equal((await f.status()).current.revision,1);assert.deepEqual(JSON.parse(await fs.readFile(f.dir+'/input-0.json','utf8')),f.input);assert.equal(f.native(),0);
});

test('requirements alone cannot release a retained asset; background and evaluator witnesses cannot be used as physical authority',async()=>{
 for(const role of ['requirements','background','evaluation_only']){const f=await fixture('office',role,'remove'),q=structuredClone(f.q);q.assets=structuredClone(f.input.assets).filter(a=>a.id!=='RETAIN');q.changes=assetRevisionDelta(f.input.assets,q.assets).map(d=>({...d,reason,evidence:f.evidence}));const s=await hashFile(f.dir+'/space-planning.json');assert.equal((await f.invoke('revise_assets',q)).ok,false);assert.equal(await hashFile(f.dir+'/space-planning.json'),s);assert.equal(f.native(),0);}
});
test('read-only mode and stale revision cannot publish an asset change; completed generic receipt replays without a second revision',async()=>{
 const f=await fixture();assert.equal((await f.invoke('revise_assets',{...f.q,expectedRevision:9})).ok,false);const old=process.env.CADBRIDGE_READ_ONLY;try{process.env.CADBRIDGE_READ_ONLY='1';assert.equal((await f.invoke('revise_assets',f.q)).ok,false);}finally{if(old===undefined)delete process.env.CADBRIDGE_READ_ONLY;else process.env.CADBRIDGE_READ_ONLY=old;}
 const requestId=uuid();ok(await f.invoke('revise_assets',f.q,requestId));const r=ok(await f.invoke('revise_assets',f.q,requestId));assert.equal(r.execution.replayed,true);assert.equal(r.current.revision,1);assert.equal(f.native(),0);
});
test('interrupted physical publication stays unconfirmed and blocks same or new UUID rather than repeating the mutation',async()=>{
 const f=await fixture(),requestId=uuid(),before=await hashFile(f.dir+'/space-planning.json');await fs.writeFile(f.dir+'/input-1.json','Retained orphan simulates an interrupted prior publication.\n',{flag:'wx'});
 const r=await f.invoke('revise_assets',f.q,requestId);assert.equal(r.ok,false);assert.equal(r.execution.status,'unconfirmed');assert.equal(r.execution.result.error.code,'PLANNING_ASSET_REVISION_UNCONFIRMED');assert.equal((await f.status()).status,'operation_unconfirmed');assert.equal(await hashFile(f.dir+'/space-planning.json'),before);
 assert.equal((await f.invoke('revise_assets',f.q,requestId)).ok,false);assert.equal((await f.invoke('revise_assets',f.q)).ok,false);assert.equal((await f.status()).current.revision,0);assert.equal(f.native(),0);
});
