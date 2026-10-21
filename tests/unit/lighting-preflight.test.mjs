import test from 'node:test';
import assert from 'node:assert/strict';
import {initialFixture} from '../helpers/lighting-solver-fixture.mjs';
import {engineeringDigest,engineeringLightingChoices} from '../../src/engineering-design.mjs';
import {rankLightingPlans,rankLightingPlansAsync} from '../../src/lighting-optimizer.mjs';

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
