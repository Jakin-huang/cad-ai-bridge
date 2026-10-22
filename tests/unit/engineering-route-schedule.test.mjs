import test from 'node:test';import assert from 'node:assert/strict';
import {buildRouteSchedule,routeScheduleRows} from '../../src/engineering-route-schedule.mjs';
import {auditRouteSchedule} from '../../src/engineering-route-schedule-verification.mjs';
import {makeEngineeringDesign} from '../../src/engineering-design.mjs';import {auditEngineeringDesign} from '../../src/engineering-verification.mjs';import {engineeringTestInput} from '../helpers/engineering-input.mjs';
function fixture(){
 const routes=[{id:'R1',circuitId:'C1',vertices:[[0,0],[4000,0],[2000,0],[2000,2000]]},{id:'R2',circuitId:'C2',vertices:[[1000,0],[3000,0],[3000,-1000]]},{id:'R3',circuitId:'C3',vertices:[[2500,-1000],[2500,1000]]}],circuits=[{id:'C1',wireSectionMm2:2.5,routeLengthM:8,estimatedLengthM:13},{id:'C2',wireSectionMm2:1.5,routeLengthM:3,estimatedLengthM:8},{id:'C3',wireSectionMm2:2.5,routeLengthM:2,estimatedLengthM:7}].map(c=>({...c,conductors:'L+N+PE'})),conditionsSHA256='a'.repeat(64),routeSchedule=buildRouteSchedule(routes,circuits,conditionsSHA256);
 return {engineVersion:'1.16.0',routes,circuits,routeSchedule,routingBasis:{conditionsSHA256}};
}
test('overlaps, return traversals and non-connecting crossings retain independently known lengths and memberships',()=>{
 const m=fixture(),s=m.routeSchedule;assert.deepEqual(s.summary,{segments:9,sharedSegments:3,uniquePlanarLengthM:9,planarTraversalLengthM:13,maximumCoincidentCircuits:2,maximumTraversals:3});
 const shared=s.segments.find(s=>s.start[0]===2000&&s.end[0]===2500&&s.start[1]===0);assert.deepEqual(shared.circuits.map(c=>[c.circuitId,c.passes]),[['C1',2],['C2',1]]);assert.equal(shared.traversals,3);
 assert.deepEqual(s.materials,[{wireSectionMm2:1.5,conductorsPerTraversal:3,planarConductorLengthM:9,extraConductorLengthM:15},{wireSectionMm2:2.5,conductorsPerTraversal:3,planarConductorLengthM:30,extraConductorLengthM:30}]);
 assert.ok(auditRouteSchedule(m).every(c=>c.ok));assert.equal(routeScheduleRows(s).length,10);
 const reordered=buildRouteSchedule([...m.routes].reverse(),m.circuits,m.routingBasis.conditionsSHA256);assert.deepEqual(reordered,s);
});
test('independent accounting rejects missing coverage, understated returns, altered material quantities and lost basis',()=>{
 for(const mutate of [m=>m.routeSchedule.segments.splice(0,1),m=>m.routeSchedule.segments.find(s=>s.traversals===3).members.pop(),m=>m.routeSchedule.materials[0].planarConductorLengthM=1,m=>m.routeSchedule.conditionsSHA256='b'.repeat(64),m=>delete m.routeSchedule]){const m=fixture();mutate(m);assert.ok(auditRouteSchedule(m).some(c=>!c.ok));}
 const duplicate=fixture();duplicate.routeSchedule.segments.push(duplicate.routeSchedule.segments[0]);assert.ok(auditRouteSchedule(duplicate).some(c=>!c.ok));
});
test('accounting has explicit work and segment limits and refuses diagonal source legs',()=>{
 const m=fixture();assert.throws(()=>buildRouteSchedule(m.routes,m.circuits,'a',{maxComparisons:1}),/WORK_BUDGET/);assert.throws(()=>buildRouteSchedule(m.routes,m.circuits,'a',{maxSegments:1}),/LEG_BUDGET/);
 assert.throws(()=>buildRouteSchedule([{id:'X',circuitId:'C1',vertices:[[0,0],[1000,1000]]}],m.circuits,'a'),/NON_ORTHOGONAL/);
});
test('actual design generates complete paginated CAD schedule and detects changed drawing numbers',()=>{
 const p=engineeringTestInput(),basis={sourceIds:['BRIEF'],status:'assumed',description:'Explicit developer routing region for schedule accounting verification.'};p.routingConditions={mode:'declared_rectilinear_regions',clearanceMm:100,...basis,allowedRegions:[{id:'ROOM',min:[-1000,-1000],max:[9000,7000],...basis}],exclusions:[]};const m=makeEngineeringDesign(p),a=auditEngineeringDesign(m);assert.ok(a.ok,JSON.stringify(a.checks.filter(c=>!c.ok)));assert.ok(m.sheets.some(s=>s.id==='E06'));assert.ok(m.routeSchedule.segments.length);
 const changed=structuredClone(m),text=changed.scene.entities.find(e=>e.kind==='text'&&e.text.startsWith('T001 | '));assert.ok(text);text.text=text.text.replace('m |','m INVALID |');assert.equal(auditRouteSchedule(changed).find(c=>c.id==='drawing_route_schedule').ok,false);
});
