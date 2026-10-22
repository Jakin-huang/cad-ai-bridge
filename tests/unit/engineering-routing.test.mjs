import test from 'node:test';import assert from 'node:assert/strict';
import {compileDeclaredRouter,routingAssumptionsPreserved,routingAuthority} from '../../src/engineering-routing.mjs';
import {spaceScopeDelta,spaceScopeConditions} from '../../src/space-scope-decisions.mjs';
import {frozenLightingSpaceConditions} from '../../src/lighting-space-program.mjs';
import {auditDeclaredRoutes} from '../../src/engineering-routing-verification.mjs';
import {makeEngineeringDesign,engineeringDigest} from '../../src/engineering-design.mjs';
import {inspectEngineeringInput} from '../../src/engineering-contracts.mjs';
import {auditEngineeringDesign} from '../../src/engineering-verification.mjs';
import {conditionBundles,replaceProjectBrief,sourceRevisionIssues,briefTextSHA256} from '../../src/engineering-source-revisions.mjs';
import {engineeringTestInput} from '../helpers/engineering-input.mjs';
const basis={sourceIds:['BRIEF'],status:'assumed',description:'Explicit synthetic routing geometry; not installation or professional approval.'};
const conditions=()=>({mode:'declared_rectilinear_regions',clearanceMm:100,...basis,allowedRegions:[{id:'FLOOR',min:[-500,-1500],max:[8500,6500],...basis}],exclusions:[{id:'BLOCK',min:[2000,-1000],max:[2500,2000],...basis}]});
const length=ps=>ps.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-ps[i][0],p[1]-ps[i][1]),0);
test('routing values remain in frozen shared-space and scope ledgers, with assumptions retained',()=>{
 const p=engineeringTestInput();p.routingConditions=conditions();const next=structuredClone(p);next.routingConditions.clearanceMm=200;
 assert.notEqual(frozenLightingSpaceConditions(p),frozenLightingSpaceConditions(next));assert.ok(spaceScopeConditions(p).some(r=>r.key==='routingConditions'));
 assert.equal(spaceScopeDelta(p,next).find(r=>r.key==='routingConditions').disposition,'revised');
 const upgraded=structuredClone(p.routingConditions);upgraded.exclusions[0].status='documented';assert.equal(routingAssumptionsPreserved(p.routingConditions,upgraded),false);assert.equal(routingAssumptionsPreserved(p.routingConditions,p.routingConditions),true);assert.equal(routingAuthority(upgraded),'assumed');
});
test('declared router detours around expanded exclusion with independently known shortest planar length',()=>{
 const q=conditions(),a=[1000,1000],b=[4000,1000],router=compileDeclaredRouter(q,[a,b]),electrical={panelPosition:a};
 const path=router.route([{position:b}],b,electrical);assert.equal(length(path),5200);assert.deepEqual(path[0],a);assert.deepEqual(path.at(-1),b);assert.ok(path.some(p=>p[1]===2100));
 assert.deepEqual(router.route([{position:b}],b,electrical),path);
 const reversed=compileDeclaredRouter({...q,allowedRegions:[...q.allowedRegions].reverse()},[a,b]).route([{position:b}],b,electrical);assert.deepEqual(reversed,path);
});
test('design, independent audit, source bindings and circuit lengths use the same declared route conditions',()=>{
 const p=engineeringTestInput(),legacy=makeEngineeringDesign(p);p.routingConditions=conditions();const original=structuredClone(p),m=makeEngineeringDesign(p);assert.deepEqual(p,original);assert.equal(m.engineVersion,'1.15.0');assert.deepEqual(m.devices,legacy.devices);assert.deepEqual(m.input.electrical,legacy.input.electrical);
 const audit=auditEngineeringDesign(m);assert.equal(audit.ok,true,JSON.stringify(audit.checks.filter(c=>!c.ok)));assert.ok(audit.pending.some(p=>p.code==='ROUTING_INSTALLATION_REVIEW'));assert.ok(m.routes.every(r=>Math.abs(length(r.vertices)/1000-m.circuits.find(c=>c.id===r.circuitId).routeLengthM)<=0.0000005));
 const changed=structuredClone(m);changed.routes[0].vertices=[[500,-500],[4000,-500],[4000,5000]];assert.ok(auditDeclaredRoutes(changed).some(c=>c.id.startsWith('routing_regions_')&&!c.ok));
 const omitted=structuredClone(m);delete omitted.routingBasis;assert.equal(auditDeclaredRoutes(omitted).find(c=>c.id==='routing_source_basis').ok,false);
 const constraint=structuredClone(m);constraint.input.routingConditions.clearanceMm=500;assert.equal(auditDeclaredRoutes(constraint).find(c=>c.id==='routing_source_basis').ok,false);
 assert.equal(engineeringDigest(makeEngineeringDesign(engineeringTestInput())),'b995ef30d746543902743397c7f1c9e25146bfbf081819696e875494efbfe9f3');
});
test('disconnected allowed union, excluded terminal and explicit computation budgets never silently use schematic fallback',()=>{
 const q=conditions(),a=[0,0],b=[4000,0],split={...q,exclusions:[],allowedRegions:[{id:'LEFT',min:[-500,-500],max:[500,500],...basis},{id:'RIGHT',min:[3500,-500],max:[4500,500],...basis}]};
 const router=compileDeclaredRouter(split,[a,b]);assert.throws(()=>router.route([{position:b}],b,{panelPosition:a}),/ROUTING_NO_DECLARED_PATH/);
 assert.throws(()=>compileDeclaredRouter(q,[[2200,0]]),/ROUTING_TERMINAL_OUTSIDE_ALLOWED/);
 assert.throws(()=>compileDeclaredRouter(q,[a,b],{maxNodes:2}),/ROUTING_GRID_BUDGET/);
 assert.throws(()=>compileDeclaredRouter(q,[a,b],{maxSearchWork:1}).route([{position:b}],b,{panelPosition:a}),/ROUTING_SEARCH_BUDGET/);
});
test('segment verifier catches interior allowed-region gaps even when endpoints lie in permitted areas',()=>{
 const p=engineeringTestInput();p.routingConditions=conditions();const m=makeEngineeringDesign(p);m.input.routingConditions.allowedRegions=[{id:'LEFT',min:[-500,-1500],max:[1800,6500],...basis},{id:'RIGHT',min:[3000,-1500],max:[8500,6500],...basis}];m.input.routingConditions.exclusions=[];m.routes[0].vertices=[[500,-500],[4000,-500]];
 assert.equal(auditDeclaredRoutes(m).find(c=>c.id.startsWith('routing_regions_')).ok,false);
});
test('routing source conditions participate in brief invalidation and reject missing or retired sources',()=>{
 const p=engineeringTestInput();p.routingConditions=conditions();p.sources[0].sha256=briefTextSHA256(p.brief);assert.ok(conditionBundles(p).some(b=>b.key==='routingConditions'));
 const change=replaceProjectBrief(p,{changeId:'9655b1ad-8f12-4033-9f36-bd8ea69b8434',sourceId:'NEXT',supersededSourceId:'BRIEF',text:p.brief+' New source requires a separate routing review.',description:'Synthetic task brief replacement',priorInputSHA256:engineeringDigest(p)});
 assert.ok(change.input.briefRevision.requiredConditionKeys.includes('routingConditions'));assert.ok(sourceRevisionIssues(change.input).some(i=>i.code==='SUPERSEDED_SOURCE_STILL_USED'));assert.ok(inspectEngineeringInput(change.input).issues.some(i=>i.code==='ROUTING_SOURCE_NOT_CURRENT'));
 const missing=structuredClone(p);missing.routingConditions.exclusions[0].sourceIds=['MISSING'];assert.equal(inspectEngineeringInput(missing).ok,false);
});
