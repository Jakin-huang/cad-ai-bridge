import test from'node:test';import assert from'node:assert/strict';
import crypto from'node:crypto';
import{planningAssetsInput}from'../helpers/planning-assets-input.mjs';import{spaceTestInput,planningBrief}from'../helpers/space-input.mjs';
import{solveSpacePlan}from'../../src/space-planning-solver.mjs';import{auditSpacePlan}from'../../src/space-planning-audit.mjs';import{spacePlanningInputSchema}from'../../src/space-planning-contracts.mjs';import{assetGeometry,assetFrontAccess}from'../../src/planning-assets.mjs';import{auditPlanningAssets}from'../../src/planning-assets-audit.mjs';import{spacePlanningScene}from'../../src/space-planning-scene.mjs';import{auditAssetProjection}from'../../src/planning-assets-projection.mjs';
const budget={maxNodes:50000,maxMilliseconds:10000,maxPlans:1};
for(const type of ['hospital','school','office'])test(type+': declared movable and retained assets constrain the shared search without input repair',async()=>{
 const p=planningAssetsInput(type),before=structuredClone(p),result=await solveSpacePlan(p,budget);assert.equal(result.status,'feasible_found',JSON.stringify(result));const plan=result.plans[0],audit=auditSpacePlan(p,plan);assert.equal(audit.ok,true,JSON.stringify(audit.checks.filter(c=>!c.ok)));assert.deepEqual(p,before);assert.equal(plan.rooms.flatMap(r=>r.assets??[]).length,6);assert.equal(audit.professionalApproval,false);assert.ok(audit.pending.some(i=>i.code==='ASSET_ENGINEERING_AND_OPERATIONS'));
 const model={input:p,plan,audit,revision:0,inputSHA256:result.inputSHA256,sceneVersion:7},scene=spacePlanningScene(model);assert.ok(auditAssetProjection({...model,...scene}).every(c=>c.ok));assert.equal(scene.placements.filter(p=>p.symbol==='SP_ASSET_TAG').length,12);assert.ok(scene.sheets.some(s=>s.id==='SP06'));
});
test('independent checks detect moved retained assets, omitted equipment, reduced service zone, blocked aisles and missing drawing projection',async()=>{
 const p=planningAssetsInput(),result=await solveSpacePlan(p,budget),base=result.plans[0];assert.ok(base);
 for(const change of [plan=>plan.rooms.find(r=>r.assets?.some(a=>a.id==='RETAIN')).assets.find(a=>a.id==='RETAIN').position[0]+=100,plan=>plan.rooms.find(r=>r.assets?.length).assets.pop(),plan=>plan.rooms.find(r=>r.assets?.length).assets[0].clearRect.max[0]+=100,plan=>{const r=plan.rooms.find(r=>r.assets?.length);r.assets[0].rect=structuredClone(r.furniture.aisles[0].rect);}]){const plan=structuredClone(base);change(plan);assert.ok(auditPlanningAssets(p,plan).some(c=>!c.ok));}
 const model={input:p,plan:base,audit:auditSpacePlan(p,base),revision:0,inputSHA256:result.inputSHA256,sceneVersion:7},scene=spacePlanningScene(model);scene.scene.entities=scene.scene.entities.filter(e=>e.layer!=='A-ASSET');assert.ok(auditAssetProjection({...model,...scene}).some(c=>!c.ok));
});
test('unresolved inventory blocks and impossible footprint/budget never become a feasible drawing',async()=>{
 let p=planningAssetsInput();p.assets[0].status='unresolved';assert.equal((await solveSpacePlan(p,budget)).status,'blocked_input');
 p=planningAssetsInput();p.assets[0].widthMm=50000;planningBrief(p);const result=await solveSpacePlan(p,{...budget,maxNodes:100,maxMilliseconds:500});assert.equal(result.plans.length,0);assert.equal(result.optimalityProven,false);assert.ok(result.nodes<=100);
 for(const mutate of [p=>p.assets[0].roomId='MISSING',p=>p.assets[0].sourceIds=['BRIEF'],p=>p.assets[0].evidenceQuote='Absent literal text',p=>p.assets.push(structuredClone(p.assets[0]))]){p=planningAssetsInput();mutate(p);assert.equal(spacePlanningInputSchema.safeParse(p).success,false);}
});
test('front access width follows the asset front axis, not a long but narrow side contact',()=>{
 const a=planningAssetsInput().assets[1],g=assetGeometry(a,[1000,1000],0);assert.equal(assetFrontAccess(a,g,[{rect:{min:[1000,400],max:[1100,1000]}}]),false);assert.equal(assetFrontAccess(a,g,[{rect:{min:[1000,0],max:[1600,400]}}]),true);
});
test('legacy no-inventory input retains its exact plan representation',async()=>{const p=spaceTestInput(),r=await solveSpacePlan(p,budget);assert.ok(r.plans.length);assert.ok(r.plans[0].rooms.every(r=>!Object.hasOwn(r,'assets')));assert.equal(auditSpacePlan(p,r.plans[0]).ok,true);});
test('world-axis rotation and translation preserve retained asset coordinates and directional service checks',async()=>{
 for(const turns of [1,2,3]){const p=planningAssetsInput(),rotate=q=>{let [x,y]=q;for(let i=0;i<turns;i++)[x,y]=[-y,x];return[x+33000,y-27000];},box=r=>{const points=[r.min,r.max,[r.min[0],r.max[1]],[r.max[0],r.min[1]]].map(rotate);return{min:[0,1].map(i=>Math.min(...points.map(q=>q[i]))),max:[0,1].map(i=>Math.max(...points.map(q=>q[i])))};};
  for(const a of p.assets)if(a.fixed){const old=assetGeometry(a,a.fixed.position,a.fixed.orientationDegrees);a.fixed.position=box(old.rect).min;a.fixed.orientationDegrees=(a.fixed.orientationDegrees+turns*90)%360;}
  p.shell.rect=box(p.shell.rect);p.shell.entry.side=['west','south','east','north'][turns];p.sources.find(s=>s.id==='SHELL').sha256=crypto.createHash('sha256').update(JSON.stringify(p.shell)).digest('hex');planningBrief(p);
  const r=await solveSpacePlan(p,budget);assert.equal(r.status,'feasible_found',JSON.stringify({turns,failures:r.failures}));assert.equal(auditSpacePlan(p,r.plans[0]).ok,true,JSON.stringify(auditSpacePlan(p,r.plans[0]).checks.filter(c=>!c.ok)));
 }
});
test('development fixture geometry/source digest is fresh after replacing the seed shell',()=>{for(const type of ['hospital','school','office']){const p=planningAssetsInput(type);assert.equal(p.sources.find(s=>s.id==='SHELL').sha256,crypto.createHash('sha256').update(JSON.stringify(p.shell)).digest('hex'));}});
