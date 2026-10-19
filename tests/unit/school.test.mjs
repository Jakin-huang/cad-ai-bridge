import {schoolRequirements} from '../local-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {makeSchoolDesign,validateSchool} from '../../src/school-design.mjs';
import {schemas} from '../../src/contracts.mjs';
const requirements=schoolRequirements();
const localTest=(name,fn)=>test(name,{skip:!requirements&&'External school requirements are not configured'},fn);

localTest('school business model reconciles room areas, lighting and phase loads',()=>{
 const m=makeSchoolDesign(requirements);
 assert.equal(m.validation.ok,true);assert.equal(m.sheets.length,14);assert.equal(m.calculations.grossAreaM2,974.4);assert.equal(m.calculations.installedWatts,10296);
 assert.equal(m.devices.filter(d=>d.blockName==='SCH_LIGHT').length,72);assert.equal(m.devices.filter(d=>d.blockName==='SCH_BOARD').length,18);
 assert.equal(m.circuits.filter(c=>c.system==='power').length,18);assert.equal(m.calculations.emergency[0].loadWatts,130);
 assert.ok(Math.abs(m.calculations.classroomLux-327.272727)<0.001);
 assert.ok(Math.max(...m.circuits.filter(c=>c.system==='power').map(c=>c.totalDropPercent))<5);
 assert.ok(schemas.create_drawing.safeParse({scene:m.scene}).success);
});
localTest('school preflight blocks undersized protection, insufficient light and equipment capacity',()=>{
 const low=structuredClone(requirements);low.lighting.luminaireLumens=1000;assert.equal(makeSchoolDesign(low).validation.ok,false);
 const bad=structuredClone(requirements);bad.electrical.mainBreakerA=10;assert.equal(makeSchoolDesign(bad).validation.ok,false);
 const emergency=structuredClone(requirements);emergency.emergency.supplyRatedWattsPerFloor=100;assert.equal(makeSchoolDesign(emergency).validation.ok,false);
});
localTest('school graph validation catches missing membership and disconnected persisted routes',()=>{
 const m=makeSchoolDesign(requirements);m.routes[0].vertices[0][0]+=1;assert.equal(validateSchool(m).ok,false);
 const n=makeSchoolDesign(requirements);n.circuits[0].deviceIds.pop();assert.equal(validateSchool(n).ok,false);
});
localTest('school requirements are bounded and recalculation supports another building',()=>{
 const r=structuredClone(requirements);r.floors=1;r.classroomsPerFloor=2;const m=makeSchoolDesign(r);assert.equal(m.devices.filter(d=>d.blockName==='SCH_LIGHT').length,24);assert.equal(m.sheets.length,10);assert.equal(m.validation.ok,true);
 assert.throws(()=>makeSchoolDesign({...requirements,floors:20}));
});
localTest('declarative CAD scene rejects executable input, absent layers and conflicting definitions',()=>{
 const scene=makeSchoolDesign(requirements).scene;
 assert.equal(schemas.create_drawing.safeParse({scene,command:'anything'}).success,false);
 const bad=structuredClone(scene);bad.entities[0].layer='UNDECLARED';assert.equal(schemas.create_drawing.safeParse({scene:bad}).success,false);
 const dup=structuredClone(scene);dup.symbols.push(dup.symbols[0]);assert.equal(schemas.create_drawing.safeParse({scene:dup}).success,false);
 const point=structuredClone(scene);point.entities[0].points[0][2]=1;assert.equal(schemas.create_drawing.safeParse({scene:point}).success,false);
 const views=structuredClone(scene);views.views.push(views.views[0]);assert.equal(schemas.create_drawing.safeParse({scene:views}).success,false);
 const invalidView=structuredClone(scene);invalidView.view.height=Infinity;assert.equal(schemas.create_drawing.safeParse({scene:invalidView}).success,false);
});
