import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';
import {initialFixture,controllerAssessment} from '../helpers/lighting-solver-fixture.mjs';
import {resolveLightingStandards} from '../../src/lighting-standard-evidence.mjs';
import {solveInitialLighting} from '../../src/lighting-optimizer.mjs';

test('whole-plan feedback changes the actual failed room and cannot confuse room IDs sharing a prefix or leak exclusions to another study',async()=>{
 const f=await initialFixture(),p=f.context.input,room=structuredClone(p.rooms[0]);room.id='OFFICE_B';room.name='Second controller-only office';room.polygon=room.polygon.map(v=>[v[0]+12000,v[1]]);room.doors=room.doors.map(v=>[v[0]+12000,v[1]]);p.rooms.push(room);for(const q of p.requirements)q.roomIds.push(room.id);p.lightingEnvironment.rooms.push({...p.lightingEnvironment.rooms[0],roomId:room.id});f.context.lightingStandardEvidence=await resolveLightingStandards(p,{file:f.profileFile});
 const attempted=[],controller=controllerAssessment(),report=await solveInitialLighting(f.context,{folder:path.join(f.root,'local-failure'),maxCandidates:2,assess:async(model,options)=>{
  attempted.push(structuredClone(model.layoutSelections));const report=await controller(model,options);if(attempted.length===1)for(const profile of ['medium','fine'])report.rooms.find(r=>r.roomId==='OFFICE_B').profiles[profile].fill(20);return report;
 }});
 assert.equal(report.status,'feasible_found');assert.equal(attempted.length,2);assert.notEqual(attempted[0].find(r=>r.roomId==='OFFICE_B').choiceSHA256,attempted[1].find(r=>r.roomId==='OFFICE_B').choiceSHA256);assert.deepEqual(report.rejectedRoomLayouts.map(r=>r.roomId),['OFFICE_B']);assert.ok(report.rejectedRoomLayouts[0].failedChecks.includes('total_mean_and_uniformity_OFFICE_B'));assert.ok(report.feedbackRounds[0].coverage.find(r=>r.roomId==='OFFICE_B').preflight.reasons.LIGHTING_PRIOR_FAILED_ROOM_LAYOUT>0);assert.equal(report.feedbackRounds[0].coverage.find(r=>r.roomId==='OFFICE').preflight.reasons.LIGHTING_PRIOR_FAILED_ROOM_LAYOUT,undefined);
 let fresh;await solveInitialLighting(f.context,{folder:path.join(f.root,'separate-study'),maxCandidates:1,assess:async(model,options)=>{fresh=structuredClone(model.layoutSelections);return controller(model,options);}});assert.deepEqual(fresh,attempted[0]);
});
