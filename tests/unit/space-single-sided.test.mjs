import test from 'node:test';
import assert from 'node:assert/strict';
import {singleSidedSpaceInput} from '../helpers/single-sided-space-input.mjs';
import {spaceTestInput,planningBrief} from '../helpers/space-input.mjs';
import {solveSpacePlan} from '../../src/space-planning-solver.mjs';
import {auditSpacePlan} from '../../src/space-planning-audit.mjs';
import {spacePlanningScene} from '../../src/space-planning-scene.mjs';
import {dependencyDigest} from '../../src/task-dependencies.mjs';
const budget={maxNodes:20000,maxMilliseconds:5000,maxPlans:3},expanded={...budget,corridorMode:'allow_single_sided'};
test('a source-constrained narrow office becomes feasible with an opt-in single-sided corridor and no relaxed requirements',async()=>{
 const p=singleSidedSpaceInput(),before=structuredClone(p),old=await solveSpacePlan(p,budget),r=await solveSpacePlan(p,expanded);
 assert.equal(old.plans.length,0);assert.equal(old.status,'bounded_family_exhausted');assert.equal(r.status,'feasible_found');assert.deepEqual(p,before);
 for(const plan of r.plans){const audit=auditSpacePlan(p,plan);assert.equal(audit.ok,true,JSON.stringify(audit.checks.filter(c=>!c.ok)));assert.equal(plan.method,'bounded_single_sided_corridor_bays');assert.equal(plan.rooms.length,2);assert.equal(plan.rooms.reduce((n,r)=>n+r.furniture.seats.length,0),4);assert.deepEqual(plan.corridor,{min:[0,0],max:[14000,2000]});assert.ok(plan.unassignedM2<=10);assert.equal(audit.professionalApproval,false);
 const scene=spacePlanningScene({sceneVersion:3,input:p,plan,audit,revision:0,inputSHA256:dependencyDigest(p)});assert.ok(scene.scene.entities.some(e=>e.text?.includes('单侧矩形房间族')));}
});
test('single-sided layouts retain source identity under translation and all entry directions',async()=>{
 for(const side of ['west','east','south','north']){
  const p=singleSidedSpaceInput();p.shell.entry.side=side;
  if(side==='south'||side==='north'){p.shell.rect.max=[6000,14000];p.shell.windows=p.shell.windows.map(w=>({...w,side:'east'}));}
  for(const k of ['min','max'])p.shell.rect[k]=p.shell.rect[k].map((v,i)=>v+[11000,-5000][i]);planningBrief(p);
  const r=await solveSpacePlan(p,expanded);assert.ok(r.plans.length>0,side+': '+r.status);for(const plan of r.plans)assert.equal(auditSpacePlan(p,plan).ok,true,side);
 }
});
test('retained cores, window demand and impossible entry/depth conditions stay binding in the expanded family',async()=>{
 for(const change of [p=>p.shell.keepouts.push({id:'CORE',rect:{min:[6000,0],max:[7000,6000]},description:'Retained full-depth structural footprint'}),p=>p.program.forEach(r=>r.minDepthMm=5000),p=>p.program.forEach(r=>r.minWindowMm=10000),p=>p.shell.entry.offsetMm=3000]){
  const p=singleSidedSpaceInput();change(p);planningBrief(p);const r=await solveSpacePlan(p,expanded);assert.equal(r.plans.length,0);
 }
 const p=singleSidedSpaceInput(),plan=(await solveSpacePlan(p,expanded)).plans[0],bad=structuredClone(plan);bad.walls[0].max[1]+=300;assert.equal(auditSpacePlan(p,bad).ok,false);
});
test('default and explicit two-sided budgets preserve old plan IDs; improved search also accepts the new family',async()=>{
 const p=spaceTestInput(),a=await solveSpacePlan(p,budget),b=await solveSpacePlan(p,{...budget,corridorMode:'two_sided'});assert.deepEqual(a.plans,b.plans);
 const narrow=singleSidedSpaceInput(),r=await solveSpacePlan(narrow,{...expanded,searchMode:'improve'});assert.ok(r.plans.length>0);for(const plan of r.plans)assert.equal(auditSpacePlan(narrow,plan).ok,true);assert.equal(r.optimalityProven,false);
});
test('version five separates the overall dimension, explanatory notes and footer on both plan sheets',async()=>{
 const input=singleSidedSpaceInput(),plan=(await solveSpacePlan(input,expanded)).plans[0],audit=auditSpacePlan(input,plan),base={input,plan,audit,revision:0,inputSHA256:dependencyDigest(input)};
 const old=spacePlanningScene({...base,sceneVersion:3}),now=spacePlanningScene({...base,sceneVersion:5});
 for(const sheet of now.sheets.filter(s=>['SP02','SP03'].includes(s.id))){
  const texts=now.scene.entities.filter(e=>e.kind==='text'&&e.position[0]>=sheet.region.min[0]&&e.position[0]<=sheet.region.max[0]);
  const dimension=texts.find(e=>e.text==='14000'),note=texts.find(e=>e.text.startsWith('净边界/房间/隔墙')),lower=texts.find(e=>e.text.startsWith('双线短段')),footer=texts.find(e=>e.text.includes('非签审施工文件'));
  assert.ok(note.position[1]+note.height+100<=dimension.position[1]);assert.ok(lower.position[1]+lower.height+100<=note.position[1]);assert.ok(footer.position[1]+footer.height+100<=lower.position[1]);
 }
 assert.ok(old.scene.entities.some(e=>e.text?.startsWith('双线短段')&&e.position[1]===2650));assert.deepEqual(spacePlanningScene({...base,sceneVersion:3}),old);
});
