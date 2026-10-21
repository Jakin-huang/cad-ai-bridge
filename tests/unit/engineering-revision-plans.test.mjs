import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fixture,designed,published} from '../helpers/shared-space-fixture.mjs';
import {sharedLightingInput} from '../helpers/shared-spaces.mjs';
import {createEngineeringRevisionManager,compileRevisionPlan} from '../../src/engineering-revision-plans.mjs';
import {revisionPlanSchema} from '../../src/engineering-revision-contracts.mjs';
import {engineeringInputSchema} from '../../src/engineering-contracts.mjs';
import {hashFile} from '../../src/drawings.mjs';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
async function setup(){
 const f=await fixture(),projectId=crypto.randomUUID(),{b,d}=await designed(f,projectId),h=await published(f,b,d),input=sharedLightingInput(h.pack,h.ref,['RECEPTION','MEETING','TEAM','OFFICE_A','CIRCULATION']);
 const p=await f.engineering.run({action:'prepare',requestId:crypto.randomUUID(),project:input}),old=await f.engineering.run({action:'design',jobId:p.jobId,expectedRevision:0});
 const child=path.join(f.runs,p.jobId),before=await read(path.join(child,'input-0.json')),quote='Use OFFICE_A for teaching at 450 lx; retain CIRCULATION as corridor. Remove RECEPTION, MEETING and TEAM. All other requirements, products, supply and physical conditions remain unchanged; retain every stated assumption and pending review.';
 const briefFile=path.join(f.runs,'amendment.txt');await fs.writeFile(briefFile,quote);
 const evidence={quote,reason:'The client explicitly interprets the amended task text and preserves all stated assumptions and pending professional review.'};
 const q={action:'draft',jobId:p.jobId,requestId:crypto.randomUUID(),expectedRevision:0,expectedInputSHA256:old.inputSHA256,briefFile,expectedBriefSHA256:crypto.createHash('sha256').update(quote).digest('hex'),spacePack:h.ref,sourceEvidence:evidence,carryForward:evidence,
  rooms:[{roomId:'OFFICE_A',fromRoomId:'OFFICE_A',use:'teaching',...evidence,requirements:[{rule:'target_lux',values:[450],status:'assumed',...evidence}]},{roomId:'CIRCULATION',fromRoomId:'CIRCULATION',use:'corridor',...evidence}],removedRooms:['RECEPTION','MEETING','TEAM'].map(roomId=>({roomId,...evidence}))};
 return {...f,child,before,q,evidence,revision:createEngineeringRevisionManager({runs:f.runs,engineering:f.engineering,getInputRoot:async()=>f.runs})};
}
test('compact draft has no project/native effect; apply preserves history, retires the model, and replay cannot mutate the project',async()=>{
 const f=await setup(),stateSHA=await hashFile(path.join(f.child,'engineering.json')),modelSHA=await hashFile(path.join(f.child,'model-0.json')),effects=f.effects(),draft=await f.revision.run(f.q);
 assert.equal(draft.status,'prepared',JSON.stringify(draft));assert.equal(await hashFile(path.join(f.child,'engineering.json')),stateSHA);assert.equal(f.effects(),effects);
 const page=await f.revision.run({action:'read',draft:draft.draft,section:'conditions',limit:2});assert.equal(page.items.length,2);assert.equal(page.hasMore,true);
 const same=await f.revision.run(f.q);assert.equal(same.replayed,true);assert.deepEqual(same.draft,draft.draft);
 const apply={action:'apply',requestId:crypto.randomUUID(),draft:draft.draft},applied=await f.revision.run(apply);assert.equal(applied.status,'prepared');assert.equal(applied.revision,1);assert.equal(applied.rooms,2);
 const input=await read(path.join(f.child,'input-1.json')),state=await read(path.join(f.child,'engineering.json'));assert.equal(input.rooms.find(r=>r.id==='OFFICE_A').use,'teaching');assert.equal(input.requirements.find(r=>r.roomIds.includes('OFFICE_A')&&r.rule==='target_lux').value,450);assert.ok(input.requirements.every(r=>r.status==='assumed'));assert.equal(state.modelSHA256,undefined);assert.equal(await hashFile(path.join(f.child,'model-0.json')),modelSHA);assert.equal(f.effects(),effects);
 const repeated=await f.revision.run(apply);assert.equal(repeated.replayed,true);assert.equal(repeated.revision,1);assert.equal(repeated.current.revision,1);
 await fs.appendFile(path.join(f.child,'scope-plan-'+draft.draft.draftId+'.json'),' ');await assert.rejects(()=>f.revision.run({action:'apply',requestId:crypto.randomUUID(),draft:draft.draft}),/REVISION_DRAFT_CHANGED/);
});
test('compact draft preserves unresolved rules and conflicting values as a blocked revision',async()=>{
 const f=await setup();f.q.rooms[0].use='unknown';f.q.rooms[0].requirements=[{rule:'target_lux',values:[450,550],status:'assumed',...f.evidence}];f.q.rooms[0].unresolvedRules=[{rule:'control_mode',...f.evidence}];
 const draft=await f.revision.run(f.q);assert.equal(draft.status,'blocked');const applied=await f.revision.run({action:'apply',requestId:crypto.randomUUID(),draft:draft.draft});assert.equal(applied.status,'blocked');const input=await read(path.join(f.child,'input-1.json'));assert.deepEqual(input.requirements.filter(r=>r.roomIds.includes('OFFICE_A')&&r.rule==='target_lux').map(r=>r.value),[450,550]);assert.ok(!input.requirements.some(r=>r.roomIds.includes('OFFICE_A')&&r.rule==='control_mode'));assert.ok(!await fs.stat(path.join(f.child,'model-1.json')).catch(()=>false));
});
test('compact input cannot omit removed spaces, forge evidence, stale the baseline or upgrade assumptions',async()=>{
 const f=await setup(),snapshot=await hashFile(path.join(f.child,'engineering.json'));
 for(const [change,error]of [[q=>q.removedRooms.pop(),/EXPLICIT_SCOPE_REMOVALS/],[q=>q.sourceEvidence.quote='A fabricated statement absent from the actual task text',/QUOTE_NOT_IN_BRIEF/],[q=>q.expectedInputSHA256='f'.repeat(64),/BASE_CHANGED/],[q=>q.rooms[0].requirements[0].status='interpreted',/ASSUMPTION_UPGRADE/]]){const q=structuredClone(f.q);change(q);await assert.rejects(()=>f.revision.run(q),error);assert.equal(await hashFile(path.join(f.child,'engineering.json')),snapshot);}
});
test('mechanical assembly retains every selected optical quality condition without certifying or relaxing it',async()=>{
 const f=await setup(),p=structuredClone(f.before),description='Synthetic condition-preservation fixture only; no actual photometric or professional evidence.';
 p.photometricDesign={method:'ies_direct_point',gridSpacingM:.5,edgeOffsetM:.1,boundaryModel:'opaque_vertical_room_walls'};
 p.lightingStandards={profileId:'QA',expectedProfileSHA256:'b'.repeat(64)};
 p.lightingEnvironment={model:'closed_diffuse_rooms',geometry:'ies_rectangular_opening',sourceIds:['BRIEF'],status:'assumed',description,rooms:p.rooms.map(r=>({roomId:r.id,enclosure:'closed_opaque',floorReflectance:.2,wallReflectance:.5,ceilingReflectance:.8,sourceIds:['BRIEF'],status:'assumed',description}))};
 p.glareAssessment={profileId:'QA',expectedProfileSHA256:'c'.repeat(64),protocol:'four_wall_midpoints_horizontal',rooms:p.rooms.map(r=>({roomId:r.id,posture:'standing',maximumUgr:19,workplaneReflectance:.2,wallReflectance:.5,installationReflectance:.7,sourceIds:['BRIEF'],status:'assumed',description}))};
 const compiled=await compileRevisionPlan(engineeringInputSchema.parse(p),revisionPlanSchema.parse(f.q),{runs:f.runs,inputRoot:f.runs});
 assert.deepEqual(compiled.project.photometricDesign,p.photometricDesign);assert.deepEqual(compiled.project.lightingStandards,p.lightingStandards);assert.equal(compiled.intake.ok,false,'Unconfirmed classifications remain blocking');
 for(const key of ['lightingEnvironment','glareAssessment']){assert.deepEqual(compiled.project[key].rooms.map(r=>r.roomId),['OFFICE_A','CIRCULATION']);for(const r of compiled.project[key].rooms){const old=p[key].rooms.find(a=>a.roomId===r.roomId);assert.deepEqual({...r,sourceIds:old.sourceIds},old);assert.equal(r.status,'assumed');}}
});
