import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {makeSchoolDesign,validateSchool} from '../../src/school-design.mjs';
import {routedTree,pathLength} from '../../src/school-routing.mjs';
const requirement=JSON.parse(fs.readFileSync(new URL('../../examples/school-requirements.json',import.meta.url)));
test('routing retains independent endpoint coordinates and reduces the revised test-case geometry',()=>{
 const m=makeSchoolDesign(requirement);assert.ok(m.review.routing.savedPercent>25);const d=m.devices.find(d=>d.id===m.routes[0].from),x=d.position[0];m.routes[0].vertices[0][0]+=10;assert.equal(d.position[0],x);assert.equal(validateSchool(m).ok,false);
});
test('socket paths use room perimeter and each routed tree has exactly one edge per terminal',()=>{
 const p={id:'P',position:[32500,7300,0]},ds=[{id:'A',position:[5300,1200,0]},{id:'B',position:[13000,6500,0]},{id:'C',position:[9000,7500,0]}];
 const rs=routedTree(p,ds,{ox:0,oy:0,width:42000,depth:8000,classWidth:9000,classCount:3,circuitId:'AP1-S1',system:'power'});assert.equal(rs.length,3);assert.equal(new Set(rs.map(w=>w.to)).size,3);for(const r of rs){assert.ok(pathLength(r.vertices)>0);assert.ok(r.vertices.slice(1).every((v,i)=>v[0]===r.vertices[i][0]||v[1]===r.vertices[i][1]));}
 const between=rs.filter(r=>r.from!=='P');assert.ok(between.flatMap(r=>r.vertices).every(v=>v[0]===5300||v[0]===13000||v[1]===1200||v[1]===7500));
});
test('seven emergency outputs segregate stairs and add both equipment rooms within capacity',()=>{
 const m=makeSchoolDesign(requirement);for(let f=1;f<=2;f++){const cs=m.circuits.filter(c=>c.system==='emergency'&&c.floor===f);assert.equal(cs.length,7);assert.equal(cs.filter(c=>c.area.includes('楼梯')).length,2);assert.equal(cs.filter(c=>c.area.includes('电间')).length,2);assert.equal(cs.reduce((n,c)=>n+c.watts,0),130);assert.ok(cs.every(c=>c.watts<=c.outputRatedWatts*.8));}
 const c=m.circuits.find(c=>c.system==='emergency');c.outputRatedA=8;assert.equal(validateSchool(m).ok,false);
});
test('dual data ports keep two cable quantities and separate physical star lanes',()=>{
 const m=makeSchoolDesign(requirement),cs=m.circuits.filter(c=>c.system==='data');assert.equal(cs.reduce((n,c)=>n+c.parallelCables,0),18);const rs=cs.filter(c=>c.floor===1).map(c=>m.routes.find(w=>w.circuitId===c.id));assert.equal(new Set(rs.map(r=>r.vertices[1][1])).size,6);cs[0].parallelCables=1;assert.equal(validateSchool(m).ok,false);
});
test('four control groups map each classroom light once and model both switch legs and return pipes',()=>{
 const m=makeSchoolDesign(requirement);assert.equal(m.controls.length,24);assert.equal(m.controlWiring.length,12);assert.equal(new Set(m.controls.flatMap(c=>c.deviceIds)).size,90);assert.ok(m.routes.filter(w=>w.controlPipe).length>0);assert.ok(m.routes.filter(w=>w.controlPipe).every(w=>w.controlGroups.length<=4));m.controls[0].switchId='absent';assert.equal(validateSchool(m).ok,false);
});
test('phase reassignment reduces imbalance while conserving installed and demand load',()=>{
 const m=makeSchoolDesign(requirement);assert.equal(m.calculations.installedWatts,10296);assert.equal(m.calculations.demandWatts,7416);assert.deepEqual(m.calculations.phaseDemandWatts,{A:2472,B:2412,C:2532});assert.ok(m.calculations.phaseImbalancePercent<5);
});
test('review covers every emitted sheet and unresolved inputs have provider and explicit impact',()=>{
 const m=makeSchoolDesign(requirement);assert.deepEqual(m.review.sheets.map(s=>s.sheetId),m.sheets.map(s=>s.id));assert.equal(m.review.requiredInputs.length,7);assert.ok(m.review.requiredInputs.every(i=>i.owner&&i.materials&&i.limit));assert.equal(m.validation.pending.length,7);assert.equal(m.groundLinks.length,8);const points=JSON.stringify(m.groundLinks[0].points);m.scene.entities=m.scene.entities.filter(p=>JSON.stringify(p.points)!==points);assert.equal(validateSchool(m).ok,false);
});
