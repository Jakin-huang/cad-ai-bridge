import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
import {initialFixture} from '../helpers/lighting-solver-fixture.mjs';
import {createEngineeringManager} from '../../src/engineering-projects.mjs';
import {engineeringDigest,engineeringLightingChoices,engineeringLightingChoicesAsync} from '../../src/engineering-design.mjs';
import {rankLightingPlans,rankLightingPlansAsync,lightingCandidatePreflight} from '../../src/lighting-optimizer.mjs';

test('condition preflight sees the source pool before bounded point sampling and preserves otherwise omitted eligible geometry',async()=>{
 const {context}=await initialFixture();context.input.requirements.find(q=>q.rule==='max_lpd').value=6;
 const before=engineeringDigest(context),sampled=new Set(engineeringLightingChoices(context)[0].choices.map(c=>c.choiceSHA256));let omitted;
 engineeringLightingChoices(context,{preflight:(_room,c)=>{if(!sampled.has(c.choiceSHA256))omitted??=c.choiceSHA256;return false;}});
 assert.ok(omitted,'Fixture must exercise a layout outside the original point pool');
 const ranked=rankLightingPlans(context,undefined,{preflight:(_room,c)=>c.choiceSHA256===omitted?[]:[{code:'TEST_UNSUPPORTED_CONDITION'}]});
 assert.equal(ranked.plans[0].selections[0].choiceSHA256,omitted);
 const p=ranked.coverage[0].preflight;assert.ok(p.examined>16);assert.equal(p.eligible,1);assert.equal(p.rejected,p.examined-1);assert.equal(p.reasons.TEST_UNSUPPORTED_CONDITION,p.rejected);assert.ok(p.examples.length<=12);assert.equal(engineeringDigest(context),before);
});
test('an exhausted preflight records bounded-family rejection without claiming global infeasibility',async()=>{
 const {context}=await initialFixture(),r=rankLightingPlans(context,undefined,{preflight:()=>[{code:'TEST_OUTSIDE_TABLE'},{code:'TEST_OUTSIDE_TABLE'}]});
 assert.deepEqual(r.plans,[]);const c=r.coverage[0];assert.equal(c.preflight.eligible,0);assert.equal(c.preflight.reasons.TEST_OUTSIDE_TABLE,c.preflight.examined);assert.match(c.reason,/not a global infeasibility/);
});
test('async ranking yields between rooms and equals synchronous ranking without changing input',async()=>{
 const {context}=await initialFixture(),before=engineeringDigest(context),events=[];let yielded=false;
 setImmediate(()=>yielded=true);
 const actual=await rankLightingPlansAsync(context,undefined,{preflight:()=>[],onPreflightRoom:p=>events.push(p)});
 assert.ok(yielded);assert.equal(events.length,context.input.rooms.length);assert.equal(events[0].phase,'geometry_preflight');assert.equal(events[0].completedRooms,0);
 assert.deepEqual(actual,rankLightingPlans(context,undefined,{preflight:()=>[]}));assert.equal(engineeringDigest(context),before);
});
test('ranking budget includes preflight and prevents the next room after expiry',async()=>{
 const {context}=await initialFixture();let calls=0;
 await assert.rejects(()=>rankLightingPlansAsync(context,undefined,{deadlineMs:0,preflight:()=>{calls++;return [];}}),/TIME_BUDGET/);assert.equal(calls,0);
 await assert.rejects(()=>rankLightingPlansAsync(context,undefined,{deadlineMs:Date.now()+60000,onPreflightRoom:()=>{throw Error('PROGRESS_PERSIST_FAILED');}}),/PROGRESS_PERSIST_FAILED/);
});

test('a busy single-room preflight yields while candidates are still being checked and keeps exact choice order/results',async()=>{
 const {context}=await initialFixture();context.input.requirements.find(q=>q.rule==='max_lpd').value=6;const before=engineeringDigest(context),ticks=[],progress=[];let examined=0;const timer=setInterval(()=>ticks.push(examined),2);
 try{const actual=await engineeringLightingChoicesAsync(context,{sliceMs:2,progressIntervalMs:0,onProgress:p=>progress.push(p),preflight:()=>{examined++;const until=performance.now()+1;while(performance.now()<until){}return true;}}),expected=engineeringLightingChoices(context,{preflight:()=>true});assert.deepEqual(actual,expected);assert.ok(examined>16);assert.ok(ticks.some(n=>n>0&&n<examined),'A timer must run within this room before its final candidate');assert.ok(progress.some(p=>p.workPhase==='condition_preflight'&&p.examinedCandidates>0));assert.equal(engineeringDigest(context),before);}finally{clearInterval(timer);}
});

test('deadline expiry inside one room stops before the next condition and publishes no partial choices',async t=>{
 const {context}=await initialFixture(),before=engineeringDigest(context);let now=1,calls=0;t.mock.method(Date,'now',()=>now);await assert.rejects(()=>engineeringLightingChoicesAsync(context,{deadlineMs:10,preflight:()=>{calls++;now=10;return true;}}),/LIGHTING_OPTIMIZATION_TIME_BUDGET/);assert.equal(calls,1);assert.equal(engineeringDigest(context),before);
});

test('in-room progress persistence failure aborts ranking; async and sync rejection coverage remain identical',async()=>{
 const {context}=await initialFixture(),preflight=(_room,c)=>c.count%2?[{code:'DECLARED_CONDITION_UNSUPPORTED'}]:[];assert.deepEqual(await rankLightingPlansAsync(context,undefined,{preflight}),rankLightingPlans(context,undefined,{preflight}));await assert.rejects(()=>engineeringLightingChoicesAsync(context,{sliceMs:1,progressIntervalMs:0,onProgress:()=>{throw Error('IN_ROOM_PROGRESS_SAVE_FAILED');},preflight:()=>{const until=performance.now()+2;while(performance.now()<until){}return true;}}),/IN_ROOM_PROGRESS_SAVE_FAILED/);
});

test('a model changed during an asynchronous ranking cannot publish mixed-condition plans',async()=>{
 for(const useWorker of [false,true]){const {context}=await initialFixture();let changed=false;await assert.rejects(()=>rankLightingPlansAsync(context,undefined,{useWorker,onPreflightRoom:()=>{if(!changed){changed=true;context.input.title+=' changed while yielding';}}}),/LIGHTING_PREFLIGHT_MODEL_CHANGED/);assert.equal(changed,true);}
});

test('pure worker ranking equals synchronous conditions and keeps failed-layout exclusions local',async()=>{
 const {context}=await initialFixture(),before=engineeringDigest(context),events=[],expected=rankLightingPlans(context),actual=await rankLightingPlansAsync(context,undefined,{useWorker:true,onPreflightRoom:p=>events.push(p)});assert.deepEqual(actual,expected);assert.equal(events.length,context.input.rooms.length);const roomId=context.input.rooms[0].id,choice=expected.plans[0].selections[0].choiceSHA256,condition=lightingCandidatePreflight(context),rejected={code:'LIGHTING_PRIOR_FAILED_ROOM_LAYOUT',reason:'Same frozen room, source product, conditions and layout already failed an audited local quality gate in this study'},filtered=await rankLightingPlansAsync(context,undefined,{useWorker:true,priorFailedChoices:[[roomId,[choice]]]});assert.deepEqual(filtered,rankLightingPlans(context,undefined,{preflight:(r,c)=>r.id===roomId&&c.choiceSHA256===choice?[rejected]:condition(r,c)}));assert.ok(filtered.plans.every(p=>!p.selections.some(s=>s.roomId===roomId&&s.choiceSHA256===choice)));assert.equal(engineeringDigest(context),before);
});

test('worker progress failure releases its slot and arbitrary callbacks cannot be silently serialized',async()=>{
 const {context}=await initialFixture();await assert.rejects(()=>rankLightingPlansAsync(context,undefined,{useWorker:true,onPreflightRoom:async()=>{await new Promise(resolve=>setTimeout(resolve,10));throw Error('WORKER_PROGRESS_SAVE_FAILED');}}),/WORKER_PROGRESS_SAVE_FAILED/);await assert.rejects(()=>rankLightingPlansAsync(context,undefined,{useWorker:true,preflight:()=>[]}),/CUSTOM_PREFLIGHT_WORKER_UNSUPPORTED/);assert.deepEqual(await rankLightingPlansAsync(context,undefined,{useWorker:true}),rankLightingPlans(context));
});

test('a queued worker deadline expires without starting another calculation and the queue recovers',async()=>{
 const {context}=await initialFixture();let entered,release,secondStarted=false;const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve),first=rankLightingPlansAsync(context,undefined,{useWorker:true,onPreflightRoom:async()=>{entered();await gate;}});await ready;try{await assert.rejects(()=>rankLightingPlansAsync(context,undefined,{useWorker:true,deadlineMs:Date.now()+30,onPreflightRoom:()=>{secondStarted=true;}}),/TIME_BUDGET/);assert.equal(secondStarted,false);}finally{release();await first;}assert.deepEqual(await rankLightingPlansAsync(context,undefined,{useWorker:true}),rankLightingPlans(context));
});

test('an active design lease exposes saved preflight progress and a diagnostic stop cannot publish a model',async()=>{
 const f=await initialFixture(),runs=path.join(f.root,'active-preflight');let entered,release;const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve),manager=createEngineeringManager({runs,lightingProfile:f.profileFile,getInputRoot:async()=>f.root,execute:()=>{throw Error('Native execution forbidden');},initialSolver:async(context,options)=>{await rankLightingPlansAsync(context,undefined,{useWorker:true,onPreflightRoom:async p=>{await options.onProgress(p);entered();await gate;},onPreflightProgress:options.onProgress});throw Error('PREFLIGHT_REPLAY_ONLY_STOP');}}),p=await manager.run({action:'prepare',requestId:crypto.randomUUID(),project:f.input}),pending=manager.run({action:'solve_lighting',jobId:p.jobId,requestId:crypto.randomUUID(),expectedRevision:0,expectedInputSHA256:p.inputSHA256,maxCandidates:1,maxMinutes:2}).then(()=>Error('Unexpected model publication'),error=>error);await Promise.race([ready,pending.then(error=>{throw error;})]);try{const status=await manager.run({action:'status',jobId:p.jobId});assert.equal(status.status,'quality_assessing');assert.equal(status.lightingProgress.phase,'geometry_preflight');assert.equal(status.lightingProgress.roomId,f.input.rooms[0].id);assert.equal(status.inputSHA256,p.inputSHA256);assert.equal(status.modelSHA256,undefined);}finally{release();}assert.match((await pending).message,/PREFLIGHT_REPLAY_ONLY_STOP/);const stopped=await manager.run({action:'status',jobId:p.jobId});assert.equal(stopped.status,'blocked');assert.equal(stopped.modelSHA256,undefined);assert.equal(stopped.lightingProgress,undefined);assert.equal((await fs.readdir(path.join(runs,p.jobId))).some(n=>/^model-\d+\.json$/.test(n)),false);
});
