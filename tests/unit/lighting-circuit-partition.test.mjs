import test from 'node:test';import assert from 'node:assert/strict';
import {engineeringTestInput} from '../helpers/engineering-input.mjs';import {makeEngineeringDesign,engineeringDigest} from '../../src/engineering-design.mjs';import {auditEngineeringDesign} from '../../src/engineering-verification.mjs';import {partitionLightingCircuits} from '../../src/lighting-circuit-partition.mjs';
test('already feasible legacy layout remains byte-identical; splitting preserves lights and fixed electrical declarations',()=>{
 const p=engineeringTestInput(),baseline=makeEngineeringDesign(p);assert.equal(engineeringDigest(baseline),'b995ef30d746543902743397c7f1c9e25146bfbf081819696e875494efbfe9f3');
 p.electrical.panelPosition=[-20000,-500];p.requirements.find(r=>r.rule==='max_drop').value=.15;const original=structuredClone(p),m=makeEngineeringDesign(p);assert.deepEqual(p,original);assert.equal(m.circuits.length,3);assert.equal(m.devices.length,baseline.devices.length);assert.deepEqual(m.devices.map(d=>d.position),baseline.devices.map(d=>d.position));assert.deepEqual(m.input.electrical,p.electrical);assert.equal(auditEngineeringDesign(m).ok,true);assert.equal(m.circuitPartitioning[0].originalCircuits,1);assert.ok(m.circuits.every(c=>c.dropPercent<=.15));
 const changed=structuredClone(m);changed.circuits[0].maxDropPercent=3;assert.equal(auditEngineeringDesign(changed).ok,false);
});
test('feasible decimal product rating preserves the complete legacy model digest',()=>{
 const p=engineeringTestInput();p.luminaires[0].watts=24.1;
 const m=makeEngineeringDesign(p);
 assert.equal(engineeringDigest(m),'9292e1eb2403d68358f5a84bc9fd669dde0636cee7fc7f9fde718ce2945a790f');
 assert.equal(m.circuits[0].watts,216.9);assert.equal(auditEngineeringDesign(m).ok,true);
});
test('declared current constraint can require more circuits without increasing breaker or changing wire',()=>{
 const p=engineeringTestInput();p.electrical.breakerA=.5;const m=makeEngineeringDesign(p);assert.equal(m.circuits.length,3);assert.ok(m.circuits.every(c=>c.currentA<=.5&&c.breakerA===.5&&c.wireSectionMm2===2.5));assert.equal(auditEngineeringDesign(m).ok,true);
});
// Exhaust every contiguous partition independently of the dynamic-programming solver.
function exhaustive(devices,door,e,maxDevices,maxWatts,maxDrop){
 let best=Infinity;
 const recurse=(start,groups)=>{if(start===devices.length){best=Math.min(best,groups);return;}for(let end=start+1;end<=devices.length&&end-start<=maxDevices;end++){
  const chosen=devices.slice(start,end).sort((a,b)=>Math.hypot(a.position[0]-door[0],a.position[1]-door[1])-Math.hypot(b.position[0]-door[0],b.position[1]-door[1]));let meters=(Math.abs(door[0]-e.panelPosition[0])+Math.abs(door[1]-e.panelPosition[1]))/1000,previous=door;
  for(const d of chosen){meters+=(Math.abs(d.position[0]-previous[0])+Math.abs(d.position[1]-previous[1]))/1000;previous=d.position;}
  const watts=chosen.reduce((n,d)=>n+d.watts,0),amps=watts/(e.voltage*e.powerFactor),drop=2*e.copperOhmMm2PerM*(meters+e.extraLengthM)*amps/e.wireSectionMm2/e.voltage*100;
  if(watts<=maxWatts&&amps<=e.breakerA&&e.breakerA<=e.assumedIzA&&drop<=maxDrop&&Math.round(drop*1e6)/1e6<=maxDrop)recurse(end,groups+1);
 }};recurse(0,0);return best;
}
test('bounded search finds the minimum contiguous circuit count across irregular positions and strict limits',()=>{
 const p=engineeringTestInput(),e={...p.electrical,panelPosition:[-12000,-500]},door=[1000,0],devices=Array.from({length:8},(_,i)=>({id:'D'+i,watts:24,position:[[1000,3000,5000,7000][i%4],i%2?4500:1500]}));
 for(const maxDropPercent of [.04,.07,.12,.18,.3])for(const maxDevices of [3,5,8]){const expected=exhaustive(devices,door,e,maxDevices,1000,maxDropPercent),q={devices,door,electrical:e,maxDevices,maxWatts:1000,maxDropPercent,roomId:'TEST'};
  if(!Number.isFinite(expected))assert.throws(()=>partitionLightingCircuits(q),/NO_FEASIBLE_SEQUENCE/);else{const actual=partitionLightingCircuits(q);assert.equal(actual.groups.length,expected);assert.deepEqual(actual.groups.flatMap(g=>g.selected.map(d=>d.id)),devices.map(d=>d.id));}
 }
});
test('unsatisfied single load, fixed ampacity conflict and exhausted search have distinct failure reasons',()=>{
 const p=engineeringTestInput(),q={devices:[{id:'A',watts:24,position:[1000,1000]},{id:'B',watts:24,position:[7000,5000]}],door:[1000,0],electrical:p.electrical,maxDevices:12,maxWatts:1000,maxDropPercent:.000001,roomId:'TEST'};
 assert.throws(()=>partitionLightingCircuits(q),/NO_FEASIBLE_SEQUENCE/);
 assert.throws(()=>partitionLightingCircuits({...q,electrical:{...q.electrical,assumedIzA:5}}),/FIXED_SUPPLY_CONFLICT/);
 assert.throws(()=>partitionLightingCircuits({...q,maxDropPercent:.025,maxCandidates:1}),/SEARCH_BUDGET/);
});
