import test from 'node:test';import assert from 'node:assert/strict';
import {perimeterInfillLayouts} from '../../src/lighting-infill-layouts.mjs';
import {engineeringLightingChoices,makeEngineeringDesign,engineeringDigest} from '../../src/engineering-design.mjs';
import {auditEngineeringDesign} from '../../src/engineering-verification.mjs';
import {initialFixture} from '../helpers/lighting-solver-fixture.mjs';
const box={min:[10000,20000],max:[19000,26000]},positions=Array.from({length:5},(_,x)=>[10900+x*1800,21500]).flatMap(p=>[p,[p[0],24500]]),args={positions,nx:5,ny:2,bounds:box,maxCount:18,validPoint:()=>true};
test('perimeter infill derives all positions from translated source geometry and preserves the base grid',()=>{
 const layouts=perimeterInfillLayouts(args);assert.deepEqual(layouts.map(l=>l.positions.length),[12,18]);assert.deepEqual(layouts[0].positions.slice(0,10),positions);assert.deepEqual(layouts[0].positions.slice(10),[[10900,23000],[18100,23000]]);assert.deepEqual(layouts[0].infill,{axis:'between_rows',baseGrid:[5,2],addedCount:2});
 for(const l of layouts){assert.equal(new Set(l.positions.map(p=>p.join(','))).size,l.positions.length);assert.ok(l.positions.every(p=>p.every((n,k)=>n>box.min[k]&&n<box.max[k])));}
 assert.deepEqual(perimeterInfillLayouts(args),layouts,'Enumeration must be deterministic for source-choice replay');
});
test('power budget, incomplete base geometry and obstacles cannot be bypassed by infill',()=>{
 assert.deepEqual(perimeterInfillLayouts({...args,maxCount:11}),[]);assert.deepEqual(perimeterInfillLayouts({...args,positions:positions.slice(1)}),[]);assert.deepEqual(perimeterInfillLayouts({...args,validPoint:p=>p[1]!==23000}).map(l=>l.infill.axis),['between_columns']);
});
test('total-light source choice can select and replay infill without changing input or weakening independent checks',async()=>{
 const f=await initialFixture();f.input.requirements.find(r=>r.rule==='max_lpd').value=8;const inputDigest=engineeringDigest(f.input),choices=engineeringLightingChoices(f.context,{preflight:(_room,c)=>c.layoutSearch==='perimeter_infill_grid'})[0];assert.ok(choices.choices.length,'Infill is a declared source family, not manual coordinates');const choice=choices.choices[0],layoutSelections=[{roomId:f.input.rooms[0].id,choiceSHA256:choice.choiceSHA256}],options={...f.context,layoutSelections},model=makeEngineeringDesign(f.input,options);
 assert.equal(model.roomCalculations[0].layoutSearch,'perimeter_infill_grid');assert.deepEqual(model.roomCalculations[0].positions,choice.positions);assert.equal(engineeringDigest(model.input),inputDigest);assert.equal(auditEngineeringDesign(model).ok,true);assert.equal(engineeringDigest(makeEngineeringDesign(f.input,options)),engineeringDigest(model));
});
