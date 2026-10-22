import test from 'node:test';import assert from 'node:assert/strict';
import {spaceTestInput,planningBrief} from '../helpers/space-input.mjs';
import {solveSpacePlan} from '../../src/space-planning-solver.mjs';
import {auditSpacePlan} from '../../src/space-planning-audit.mjs';
import {planningBudgetSchema} from '../../src/space-planning-contracts.mjs';
import {dependencyDigest as digest} from '../../src/task-dependencies.mjs';
const options={maxNodes:5000,maxMilliseconds:10000,maxPlans:3};
test('budgeted search preserves demands and reports honest improvement or incumbent retention with area-allocation guard',async()=>{
 const p=spaceTestInput(),original=structuredClone(p),first=await solveSpacePlan(p,options),r=await solveSpacePlan(p,{...options,searchMode:'improve'});
 assert.deepEqual(p,original);assert.equal(r.status,'feasible_found');assert.equal(r.improvement.initialBestScore,first.plans[0].score);assert.ok(r.plans[0].score<=first.plans[0].score);assert.ok(r.nodes<=options.maxNodes);assert.equal(r.improvement.variantsVisited,9);assert.equal(r.exhaustive,false);assert.equal(r.optimalityProven,false);assert.equal(r.improvement.automaticImprovementFound,r.plans[0].score<first.plans[0].score);
 for(const plan of r.plans){assert.equal(auditSpacePlan(p,plan).ok,true);const areaDeviation=plan.rooms.reduce((n,room)=>n+Math.abs((room.rect.max[0]-room.rect.min[0])*(room.rect.max[1]-room.rect.min[1])/1e6-p.program.find(x=>x.id===room.id).preferredAreaM2),0);assert.ok(Math.abs(plan.score-areaDeviation-.1*plan.unassignedM2)<1e-5);assert.deepEqual(auditSpacePlan(p,plan).pending,auditSpacePlan(p,first.plans[0]).pending);}
 assert.ok(r.improvement.selectedAllocation.roomsNetM2>=r.improvement.baselineAllocation.roomsNetM2);assert.ok(r.improvement.selectedAllocation.circulationM2<=r.improvement.baselineAllocation.circulationM2);assert.ok(r.improvement.selectedAllocation.partitionAndThresholdM2<=r.improvement.baselineAllocation.partitionAndThresholdM2);assert.ok(r.tradeoffPlans.length);for(const p2 of r.tradeoffPlans)assert.equal(auditSpacePlan(p,p2).ok,true);let best=r.improvement.initialBestScore;for(const round of r.improvement.rounds){assert.ok(round.bestScore<=best);best=round.bestScore;}
 for(const mutate of [a=>a.score-=1,a=>a.objective.unassignedWeight=0,a=>a.objective.roomAreaDeviationM2=0]){const a=structuredClone(r.plans[0]);mutate(a);const {id,...body}=a;a.id=digest(body);assert.equal(auditSpacePlan(p,a).ok,false);}
});
test('node exhaustion retains feasible incumbents without claiming improvement or changing legacy default output',async()=>{
 const p=spaceTestInput(),budget={maxNodes:100,maxMilliseconds:5000,maxPlans:3},first=await solveSpacePlan(p,budget),r=await solveSpacePlan(p,{...budget,searchMode:'improve'}),explicit=await solveSpacePlan(p,{...budget,searchMode:'first_feasible_variants'});
 assert.deepEqual(first.plans,explicit.plans);assert.ok(r.plans[0].score<=first.plans[0].score);assert.ok(r.nodes<=100);assert.equal(r.improvement.variantsVisited,0);assert.equal(r.improvement.scoreReduction,0);assert.ok(r.plans.length>=1&&r.plans.length<=first.plans.length);assert.equal(r.optimalityProven,false);
});
test('changed axis and unknown/blocking conditions retain independent geometry and refusal rules',async()=>{
 const p=spaceTestInput();p.shell.entry.side='north';p.shell.rect.max=[18000,24000];p.shell.windows=p.shell.windows.map(w=>({...w,side:w.side==='south'?'west':'east'}));p.shell.keepouts=[{id:'CORE',description:'Rotated retained source footprint',rect:{min:[16000,20000],max:[17000,21000]}}];p.title='任意机构项目';p.program.forEach((r,i)=>r.name='非医院空间'+i);planningBrief(p);
 const r=await solveSpacePlan(p,{...options,maxNodes:1500,searchMode:'improve'});assert.ok(r.plans.length);for(const plan of r.plans)assert.equal(auditSpacePlan(p,plan).ok,true);
 p.missingInputs.push({id:'UNVERIFIED',description:'Unknown independent boundary authority remains blocking',severity:'blocking',sourceIds:['SHELL']});const blocked=await solveSpacePlan(p,{...options,searchMode:'improve'});assert.equal(blocked.status,'blocked_input');assert.equal(blocked.nodes,0);assert.equal(blocked.plans.length,0);assert.equal(planningBudgetSchema.safeParse({...options,searchMode:'guaranteed_optimal'}).success,false);
});
test('progress storage failure aborts improvement instead of returning an unchecked successful model',async()=>{
 await assert.rejects(solveSpacePlan(spaceTestInput(),{...options,searchMode:'improve'},async()=>{throw Error('PROGRESS_STORAGE_FAILED');}),/PROGRESS_STORAGE_FAILED/);
});
