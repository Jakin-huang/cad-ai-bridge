import test from 'node:test';import assert from 'node:assert/strict';
import {frontageInput} from '../helpers/planning-frontage.mjs';
import {spacePlanningInputSchema} from '../../src/space-planning-contracts.mjs';
import {solveSpacePlan} from '../../src/space-planning-solver.mjs';
import {auditSpacePlan} from '../../src/space-planning-audit.mjs';
import {spacePlanningScene} from '../../src/space-planning-scene.mjs';
import {localFrame} from '../../src/planning-geometry.mjs';
const budget={maxNodes:30000,maxMilliseconds:5000,maxPlans:1,corridorMode:'allow_single_sided'};
const widths=(p,plan)=>plan.rooms.map(r=>r.rect.max[localFrame(p).axis]-r.rect.min[localFrame(p).axis]);
test('source-declared equal frontage changes the generated plan despite unequal area preferences',async()=>{
 const free=frontageInput({related:false}),before=await solveSpacePlan(free,budget);assert.equal(before.status,'feasible_found');assert.ok(new Set(widths(free,before.plans[0])).size>1);
 const input=frontageInput(),after=await solveSpacePlan(input,budget);assert.equal(after.status,'feasible_found');assert.equal(new Set(widths(input,after.plans[0])).size,1,'Equal frontage does not prescribe an unsupported absolute dimension');assert.equal(auditSpacePlan(input,after.plans[0]).ok,true);
 assert.deepEqual(input.program.map(r=>r.preferredAreaM2),free.program.map(r=>r.preferredAreaM2),'Constraint must not rewrite area preferences to manufacture equality');
 const oldAudit=auditSpacePlan(input,before.plans[0]);assert.ok(oldAudit.checks.some(c=>c.id.startsWith('relation_')&&!c.ok),'A previously valid unequal design must fail the new requirement');
 const {scene}=spacePlanningScene({sceneVersion:5,input,plan:after.plans[0],revision:0,audit:auditSpacePlan(input,after.plans[0])});assert.ok(scene.entities.some(e=>e.kind==='text'&&e.text.includes('开间差')&&e.text.includes('实际 0mm')));assert.equal(scene.entities.some(e=>e.kind==='text'&&e.text.includes('EQ12')&&e.text.includes('门间路径')),false);
});
test('frontage is measured in corridor direction for all four entry orientations and tolerance is enforced',async()=>{
 for(const entrySide of ['west','east','north','south']){const p=frontageInput({tolerance:100,entrySide}),r=await solveSpacePlan(p,budget);assert.equal(r.status,'feasible_found',entrySide);const plan=r.plans[0],byId=new Map(plan.rooms.map(x=>[x.id,x])),axis=localFrame(p).axis;for(const rel of p.relations){const width=id=>{const q=byId.get(id).rect;return q.max[axis]-q.min[axis];};assert.ok(Math.abs(width(rel.a)-width(rel.b))<=100);}assert.equal(auditSpacePlan(p,plan).ok,true,entrySide);}
});
test('equal frontage preserves conflicts and rejects invalid relation values without weakening existing relations',async()=>{
 const p=frontageInput();p.program[0].maxAreaM2=10;p.program[0].preferredAreaM2=9;p.program[1].minAreaM2=12;p.program[1].preferredAreaM2=13;const r=await solveSpacePlan(p,budget);assert.equal(r.plans.length,0);assert.equal(r.status,'bounded_family_exhausted');assert.equal(r.optimalityProven,false);
 for(const [kind,valueMm,valid]of [['max_frontage_difference',0,true],['max_frontage_difference',-1,false],['shared_wall',0,false],['max_door_route',0,false],['max_frontage_difference',Infinity,false]]){const q=frontageInput();q.relations[0].kind=kind;q.relations[0].valueMm=valueMm;assert.equal(spacePlanningInputSchema.safeParse(q).success,valid,kind+':'+valueMm);}
});
