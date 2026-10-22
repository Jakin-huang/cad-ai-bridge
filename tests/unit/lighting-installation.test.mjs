import test from 'node:test';
import assert from 'node:assert/strict';
import {engineeringTestInput} from '../helpers/engineering-input.mjs';
import {compileLightingInstallation,buildLightingInstallation,installationAssumptionsPreserved} from '../../src/lighting-installation.mjs';
import {auditLightingInstallation} from '../../src/lighting-installation-verification.mjs';
import {makeEngineeringDesign,engineeringDigest} from '../../src/engineering-design.mjs';
import {auditEngineeringDesign} from '../../src/engineering-verification.mjs';
import {inspectEngineeringInput} from '../../src/engineering-contracts.mjs';
import {conditionBundles,replaceProjectBrief,sourceRevisionIssues,briefTextSHA256} from '../../src/engineering-source-revisions.mjs';
import {spaceScopeDelta} from '../../src/space-scope-decisions.mjs';
import {frozenLightingSpaceConditions} from '../../src/lighting-space-program.mjs';
const basis={sourceIds:['BRIEF'],status:'assumed',description:'Explicit synthetic mounting and manual-switch assumptions; no construction approval.'};
function input(){const p=engineeringTestInput();p.routingConditions={mode:'declared_rectilinear_regions',clearanceMm:100,...basis,allowedRegions:[{id:'AREA',min:[-1000,-1500],max:[9000,7000],...basis}],exclusions:[]};p.installation={topology:'ceiling_junction_single_pole',routingHeightM:3.2,panelHeightM:1.5,...basis,rooms:[{roomId:'OFFICE',switchPosition:[1250,250],switchHeightM:1.3,switchRatingA:10,switchRatedVoltage:250,...basis}]};return p;}
function good(m){const a=auditLightingInstallation(m);assert.ok(a.length);assert.deepEqual(a.filter(c=>!c.ok),[]);}
test('installation plan detects shifted routes, omitted coordinates and incorrect vertical sequences',()=>{
 const m=makeEngineeringDesign(input());good(m);
 const fractional=input();fractional.installation.rooms[0].switchPosition[0]+=.0004;good(makeEngineeringDesign(fractional));
 for(const mutate of [
  n=>n.scene.entities.find(e=>e.layer==='E-INSTALL-PATH').points[0][0]+=10,
  n=>n.scene.entities=n.scene.entities.filter(e=>!(e.kind==='text'&&/^V1  X=/.test(e.text))),
  n=>{const page=n.sheets.find(s=>s.id.startsWith('E09-'));n.scene.entities.find(e=>e.kind==='text'&&e.position[0]>page.region.min[0]&&e.position[0]<page.region.max[0]&&e.text.startsWith('W1 | ')).text+=' > V1@0';},
  n=>n.scene.entities.find(e=>e.layer==='E-INSTALL-REF').points[0][0]+=10,
  n=>n.sheets=n.sheets.filter(s=>!s.id.startsWith('E08-'))
 ]){const bad=structuredClone(m);mutate(bad);assert.ok(auditLightingInstallation(bad).some(c=>c.id.startsWith('installation_plan_')&&!c.ok));}
});
test('two-load hand calculation checks vertical switch loop, shared-current drops and role quantities',()=>{
 const p=input();p.electrical.extraLengthM=0;p.electrical.powerFactor=1;p.installation.routingHeightM=3;p.installation.panelHeightM=1;p.installation.rooms[0].switchPosition=[1000,1000];p.installation.rooms[0].switchHeightM=1;
 const ds=[{id:'D_A',roomId:'OFFICE',position:[3000,1000],mountingHeightM:2.5,watts:230},{id:'D_B',roomId:'OFFICE',position:[5000,1000],mountingHeightM:2.5,watts:230}],cs=[{id:'C',roomId:'OFFICE',deviceIds:['D_A','D_B']}],controls=[{id:'S',circuitId:'C'}],compiler=compileLightingInstallation(p,ds),installation=buildLightingInstallation(p,cs,ds,controls,compiler),m={input:p,devices:ds,circuits:cs,controls,installation};good(m);
 const c=installation.circuits[0];assert.deepEqual(c.conductorLengthsM,{L:6,SL:7,N:9,PE:11});assert.equal(c.drops[0].dropV,.297);assert.equal(c.drops[1].dropV,.333);assert.equal(c.physicalPathLengthM,11);
 const switchedNeutral=structuredClone(m);switchedNeutral.installation.circuits[0].runs[1].conductors[0].fromTerminal='N';assert.ok(auditLightingInstallation(switchedNeutral).some(c=>!c.ok));
 const brokenPE=structuredClone(m);brokenPE.installation.circuits[0].runs.at(-1).conductors.pop();assert.ok(auditLightingInstallation(brokenPE).some(c=>!c.ok));
 const bypass=structuredClone(m);bypass.installation.circuits[0].runs[2].conductors[0].fromTerminal='L';assert.equal(auditLightingInstallation(bypass).find(c=>c.id.startsWith('installation_switch_function')).ok,false);
 for(const mutate of [c=>c.runs[0].lengthM=1,c=>c.runs[0].vertices[0][2]=0,c=>c.drops[0].dropV=0,c=>c.conductorLengthsM.SL=0,c=>c.switch.ratingA=100,c=>c.runs.pop()]){const bad=structuredClone(m);mutate(bad.installation.circuits[0]);assert.ok(auditLightingInstallation(bad).some(c=>!c.ok));}
});
test('integrated design keeps lights and limits, subdivides for declared switch rating, and rejects altered installation',()=>{
 const p=input(),legacy=makeEngineeringDesign({...p,installation:undefined}),normal=makeEngineeringDesign(p);good(normal);assert.equal(auditEngineeringDesign(normal).ok,true);assert.deepEqual(normal.devices,legacy.devices);
 p.installation.rooms[0].switchRatingA=.25;const m=makeEngineeringDesign(p);good(m);assert.equal(auditEngineeringDesign(m).ok,true);assert.ok(m.circuits.length>normal.circuits.length);assert.ok(m.installation.circuits.every(c=>c.currentA<=.25));assert.deepEqual(m.devices.map(d=>d.position),normal.devices.map(d=>d.position));assert.deepEqual(m.input.requirements,normal.input.requirements);
 const bad=structuredClone(m);delete bad.installation;assert.equal(auditEngineeringDesign(bad).ok,false);
 assert.equal(engineeringDigest(makeEngineeringDesign(engineeringTestInput())),'b995ef30d746543902743397c7f1c9e25146bfbf081819696e875494efbfe9f3');
});
test('missing, conflicting, derived-final and unsupported installation conditions cannot become a design',()=>{
 for(const mutate of [p=>delete p.routingConditions,p=>p.installation.rooms=[],p=>p.installation.rooms.push(structuredClone(p.installation.rooms[0])),p=>p.installation.rooms[0].roomId='UNKNOWN',p=>p.installation.rooms[0].sourceIds=['MISSING'],p=>p.sources[0].derivedFromFinalDrawing=true,p=>p.sources[0].supersededBy='NEXT',p=>p.installation.routingHeightM=4,p=>p.installation.panelHeightM=4,p=>p.installation.rooms[0].switchHeightM=4,p=>p.installation.rooms[0].switchPosition=[-1,-1],p=>p.installation.rooms[0].switchRatedVoltage=200,p=>p.requirements.find(r=>r.rule==='control_mode').value='occupancy_manual']){
  const p=input();mutate(p);let rejected=false;try{rejected=!inspectEngineeringInput(p).ok;}catch{rejected=true;}assert.ok(rejected,String(mutate));
 }
 const p=input();p.installation.rooms[0].switchRatingA=.001;assert.throws(()=>makeEngineeringDesign(p),/NO_FEASIBLE_SEQUENCE/);
 const blocked=input();blocked.routingConditions.exclusions.push({id:'SWITCH_BLOCK',min:[1100,100],max:[1400,400],...basis});assert.throws(()=>makeEngineeringDesign(blocked),/TERMINAL_OUTSIDE_ALLOWED/);
});
test('installation remains source-bound across scope, shared geometry and brief changes without assumption upgrades',()=>{
 const p=input(),next=structuredClone(p);next.installation.rooms[0].switchHeightM=1.5;
 assert.notEqual(frozenLightingSpaceConditions(p),frozenLightingSpaceConditions(next));assert.equal(spaceScopeDelta(p,next).find(c=>c.key==='installation').disposition,'revised');assert.ok(conditionBundles(p).some(c=>c.key==='installation'));
 next.installation.rooms[0].status='documented';assert.equal(installationAssumptionsPreserved(p.installation,next.installation),false);
 p.sources[0].sha256=briefTextSHA256(p.brief);const change=replaceProjectBrief(p,{changeId:'9655b1ad-8f12-4033-9f36-bd8ea69b8434',sourceId:'NEXT',supersededSourceId:'BRIEF',text:p.brief+' New mounting conditions require interpretation.',description:'Synthetic brief revision test',priorInputSHA256:engineeringDigest(p)});
 assert.ok(change.input.briefRevision.requiredConditionKeys.includes('installation'));assert.ok(sourceRevisionIssues(change.input).some(i=>i.code==='SUPERSEDED_SOURCE_STILL_USED'));assert.equal(inspectEngineeringInput(change.input).ok,false);
});
