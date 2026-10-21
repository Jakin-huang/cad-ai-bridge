import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ugrPositionIndex,ugrSourceTerm,sumUgr,photometricDoubleSymmetry} from '../../src/ugr.mjs';
import {rectangularRoomFrame,buildUgrReference} from '../../src/ugr-reference.mjs';
import {auditUgrReport} from '../../src/ugr-assessment.mjs';
import {readUgrProfile,resolveUgrMethod,ugrBasisSummary} from '../../src/ugr-evidence.mjs';
import {parseIes} from '../../src/ies-photometry.mjs';
import {engineeringInputSchema} from '../../src/engineering-contracts.mjs';
import {engineeringDigest} from '../../src/engineering-design.mjs';
import {analyticIes} from '../helpers/photometric-input.mjs';
import {lightingFixture} from '../helpers/lighting-input.mjs';
import {qualityProfiles} from '../../src/radiance-presets.mjs';
import {hashFile} from '../../src/drawings.mjs';
const table={lateralRatios:[0,1,3],elevationRatios:[0,1,2],values:[[1,2,null],[2,3,4],[4,5,6]],interpretation:'minimum_active_bracket_value_no_extrapolation_no_dash_substitution'};
const ies=()=>parseIes(analyticIes({rows:[[1000,1000,0]]}).replace('1 2 0 0 0','1 2 .5 .5 0'));
test('position lookup uses only active brackets, preserves dashes and forbids extrapolation',()=>{
 assert.equal(ugrPositionIndex(table,1,1).value,3);assert.equal(ugrPositionIndex(table,.5,.5).value,1);assert.equal(ugrPositionIndex(table,2,1).value,3);
 assert.throws(()=>ugrPositionIndex(table,0,1.5),/DASH/);for(const pair of [[-1,0],[4,1],[0,3],[NaN,0]])assert.throws(()=>ugrPositionIndex(table,...pair),/OUTSIDE/);
});
test('UGR source uses initial candela and projected area; rigid world rotation preserves terms',()=>{
 const lamp={id:'L',positionM:[2,1,3],openingDimensionsM:[.5,.5,0],maintenanceFactor:.1,ies:ies()},observer={positionM:[0,0,1.5],direction:[1,0]},a=ugrSourceTerm(lamp,observer,table);
 assert.equal(a.emittingAreaM2,.25);assert.equal(a.projectedAreaM2,.25*1.5/Math.hypot(2,1,1.5));assert.equal(a.intensityCd,1000*(90-a.gammaDegrees)/45);
 const b=ugrSourceTerm({...lamp,positionM:[-1,2,3],rotationDegrees:90},{positionM:[0,0,1.5],direction:[0,1]},table);assert.ok(Math.abs(a.term-b.term)<1e-8);
 const sum=sumUgr([a],100);assert.ok(Math.abs(sum.ugr-8*Math.log10(.25*a.term/(100/Math.PI)))<1e-12);for(const e of [0,-1,NaN,Infinity])assert.throws(()=>sumUgr([a],e),/BACKGROUND/);
 for(const dim of [[0,.5,0],[.5,.5,.1],[1,1.5,0],[.05,.1,0]])assert.throws(()=>ugrSourceTerm({...lamp,openingDimensionsM:dim},observer,table),/AREA/);
});
test('symmetry checks actual angular knots including a narrow asymmetric peak',()=>{
 assert.equal(photometricDoubleSymmetry(ies()).ok,true);const asymmetric=parseIes(analyticIes({horizontal:[0,1,90,180,360],rows:[[1000,1000,0],[1000,2000,0],[1000,1000,0],[1000,1000,0],[1000,1000,0]]}));assert.equal(photometricDoubleSymmetry(asymmetric).ok,false);
});
function fixture(){const room={id:'ROOM',polygon:[[0,0],[8000,0],[8000,6000],[0,6000]],obstacles:[]},condition={roomId:'ROOM',posture:'standing',maximumUgr:19,workplaneReflectance:.2,wallReflectance:.5,installationReflectance:.8},method={id:'TEST',limits:{referenceWorkplaneM:.75,seatedEyeM:1.2,standingEyeM:1.5},positionIndex:table},model={input:{rooms:[room],luminaires:[{id:'F',rotationDegrees:0}],glareAssessment:{profileId:'TEST',expectedProfileSHA256:'a'.repeat(64),rooms:[condition]}},devices:[{id:'L',fixture:'F',roomId:'ROOM',position:[4000,3000],mountingHeightM:3}],lightingStandardEvidence:{rooms:[{roomId:'ROOM',maximumUgr:19}]},photometricEvidence:[{fixtureId:'F',sourceFile:'not-executed.ies',sourceSHA256:'b'.repeat(64),ies:ies()}]};return {room,condition,method,model};}
test('UGR reference cuts luminous holes in mounting plane and preserves explicit posture, excluding nonrectangles',()=>{
 const {model,room,condition,method}=fixture(),r=buildUgrReference(model,room,condition,method,model.photometricEvidence);assert.equal(r.observers.length,4);assert.equal(r.geometry.luminousHoles,1);assert.equal(r.geometry.referenceWorkplaneM,.75);assert.equal(r.geometry.installationPlaneM,3);assert.ok(Math.abs(r.geometry.ceilingAreaM2+r.geometry.luminousAreaM2-48)<1e-9);assert.equal(r.lamps[0].maintenanceFactor,1);
 assert.equal(r.observers[0].positionM[2],1.5);assert.equal(buildUgrReference(model,room,{...condition,posture:'seated'},method,model.photometricEvidence).observers[0].positionM[2],1.2);
 assert.throws(()=>rectangularRoomFrame({...room,polygon:[[0,0],[8000,0],[7000,6000],[0,6000]]}),/RECTANGULAR/);
 const changed=structuredClone(model);changed.photometricEvidence[0].ies.signedOpeningDimensionsM=[0,.5,0];assert.throws(()=>buildUgrReference(changed,room,condition,method,changed.photometricEvidence),/AREA/);
});

test('multiple lamps retain independent opening checks and changed source data is revalidated on the next call',()=>{
 const {model,room,condition,method}=fixture();model.devices[0].position=[2000,3000];model.devices.push({...model.devices[0],id:'SECOND',position:[6000,3000]});const first=buildUgrReference(model,room,condition,method,model.photometricEvidence);assert.equal(first.geometry.luminousHoles,2);assert.ok(first.lamps.every(l=>l.symmetry.ok));const source=model.photometricEvidence[0].ies;Object.assign(source,parseIes(analyticIes({horizontal:[0,1,90,180,360],rows:[[1000,1000,0],[1000,2000,0],[1000,1000,0],[1000,1000,0],[1000,1000,0]]}).replace('1 2 0 0 0','1 2 .5 .5 0')));assert.throws(()=>buildUgrReference(model,room,condition,method,model.photometricEvidence),/NOT_DOUBLE_SYMMETRIC/);Object.assign(source,ies());model.devices[1].position=[0,3000];assert.throws(()=>buildUgrReference(model,room,condition,method,model.photometricEvidence),/OPENING_OUTSIDE_ROOM/);model.devices[1].position=[2000,3000];assert.throws(()=>buildUgrReference(model,room,condition,method,model.photometricEvidence),/OPENING_COLLISION/);
});
test('audit independently recomputes source terms, wall positions, reference planes and limits rather than passed flags',()=>{
 const {model,room,condition,method}=fixture(),ref=buildUgrReference(model,room,condition,method,model.photometricEvidence),loaded={profile:method,sha256:'a'.repeat(64)},report={profileId:'TEST',profileSHA256:loaded.sha256,modelSHA256:engineeringDigest(model),conditionsSHA256:engineeringDigest(model.input.glareAssessment),initialOutputMaintenanceFactor:1,settings:qualityProfiles.filter(p=>p.id!=='coarse'),rooms:[{roomId:'ROOM',condition,geometry:ref.geometry,observers:ref.calculations.map(o=>({...o,eyeLux:{direct:100,medium:10000,fine:10000}}))}]};assert.equal(auditUgrReport(model,report,{method:loaded}).ok,true);assert.equal(auditUgrReport(model,report).ok,false);
 for(const mutate of [r=>r.initialOutputMaintenanceFactor=.8,r=>r.rooms[0].geometry.referenceWorkplaneM=0,r=>r.rooms[0].observers.pop(),r=>r.rooms[0].observers[0].observer.positionM[0]+=.1,r=>r.rooms[0].observers[0].sources[0].term/=10,r=>r.rooms[0].observers[0].eyeLux.fine=101,r=>r.rooms[0].observers[0].eyeLux.medium=5000]){const bad=structuredClone(report);bad.passed=true;mutate(bad);assert.equal(auditUgrReport(model,bad,{method:loaded}).ok,false);}
});
test('UGR input needs every room, explicit posture, bounded reflectance and existing condition sources',async()=>{
 const f=await lightingFixture(),p=f.input;p.lightingEnvironment={model:'closed_diffuse_rooms',geometry:'ies_rectangular_opening',sourceIds:['BRIEF'],status:'assumed',description:'Procedural environment for validation only',rooms:p.rooms.map(r=>({roomId:r.id,enclosure:'closed_opaque',floorReflectance:.2,wallReflectance:.5,ceilingReflectance:.8,sourceIds:['BRIEF'],status:'assumed',description:'Procedural assumed surfaces for validation'}))};p.glareAssessment={profileId:'TEST',expectedProfileSHA256:'a'.repeat(64),protocol:'four_wall_midpoints_horizontal',rooms:[{...fixture().condition,roomId:p.rooms[0].id,sourceIds:['BRIEF'],status:'assumed',description:'Explicit procedural reference-room conditions'}]};assert.equal(engineeringInputSchema.safeParse(p).success,true);for(const mutate of [p=>delete p.lightingStandards,p=>p.glareAssessment.rooms=[],p=>p.glareAssessment.rooms[0].posture='any',p=>p.glareAssessment.rooms[0].wallReflectance=1,p=>p.glareAssessment.rooms[0].sourceIds=['UNKNOWN']]){const bad=structuredClone(p);mutate(bad);assert.equal(engineeringInputSchema.safeParse(bad).success,false);}
});
test('private method is source-bound and exposes metadata without full table or paths',async()=>{
 const f=await lightingFixture(),file=path.join(f.root,'ugr.json'),profile={schemaVersion:1,id:'TEST',createdAt:new Date().toISOString(),manifestSHA256:'a'.repeat(64),sourceScope:'inspected_edition_subset_not_professional_applicability',source:{code:'GB/T 50034-2024',edition:'2024',effectiveFrom:'2024-08-01',file:f.pdf,sha256:await hashFile(f.pdf),url:'https://example.invalid/procedural'},witnesses:[1,2,3,4].map(pdfPage=>({pdfPage,pixelSHA256:'a'.repeat(64),crossCheckFile:f.cross,crossCheckSHA256:'',scope:'Procedural witness'})),positionIndex:table,limits:{minimumEmittingAreaM2:.005,maximumEmittingAreaM2:1.5,referenceWorkplaneM:.75,seatedEyeM:1.2,standingEyeM:1.5,room:'rectangular_reference_room',photometry:'double_symmetric'},professionalApproval:false};for(const w of profile.witnesses)w.crossCheckSHA256=await hashFile(f.cross);await fs.writeFile(file,JSON.stringify(profile));const loaded=await readUgrProfile({file}),summary=JSON.stringify(await ugrBasisSummary({file}));assert.equal(summary.includes('lateralRatios'),false);assert.equal(summary.includes(f.pdf),false);
 const {model}=fixture();model.input.designDate='2026-10-20';model.input.glareAssessment.expectedProfileSHA256=loaded.sha256;model.input.standards=[{code:profile.source.code,edition:'2024',effectiveFrom:'2024-08-01',sourceId:'BOOK'}];model.input.sources=[{id:'BOOK',role:'standard',sha256:profile.source.sha256}];assert.equal((await resolveUgrMethod(model,{file})).sha256,loaded.sha256);model.input.sources[0].sha256='0'.repeat(64);await assert.rejects(()=>resolveUgrMethod(model,{file}),/SOURCE_MISMATCH/);await fs.appendFile(f.cross,' changed');await assert.rejects(()=>readUgrProfile({file}),/WITNESS_CHANGED/);
});
