import test from 'node:test';import assert from 'node:assert/strict';
import {agentScenario} from '../helpers/agent-scenarios.mjs';import {makeEngineeringDesign,engineeringDigest} from '../../src/engineering-design.mjs';import {projectEngineeringRoomLabels} from '../../src/engineering-room-label-projection.mjs';
test('multiple regional control labels use bounded room-wide search without moving the physical design',()=>{
 const input=agentScenario('school').parameters.project,model=makeEngineeringDesign(input),before=engineeringDigest(model),result=projectEngineeringRoomLabels(model);assert.equal(engineeringDigest(model),before);assert.ok(result.manifest.annotations.extendedSearches>0);
 assert.deepEqual(result.scene.entities.filter(e=>e.kind!=='text'&&e.layer!=='E-TEXT'),model.scene.entities.filter(e=>e.kind!=='text'&&e.layer!=='E-TEXT'));assert.ok(result.manifest.annotations.changes.some(c=>c.kind==='control'));
 const sheet=model.sheets.find(s=>s.id==='E03'),texts=result.scene.entities.filter(e=>e.kind==='text'&&e.position[0]>=sheet.region.min[0]&&e.position[0]<=sheet.region.max[0]);
 const boxes=model.controls.map(c=>{const rows=texts.filter(t=>t.text===c.label);assert.equal(rows.length,1);const t=rows[0],width=[...t.text].reduce((n,c)=>n+(c.codePointAt(0)>255?1.05:.7),0)*t.height*(t.widthFactor??1);return {min:t.position.slice(0,2),max:[t.position[0]+width,t.position[1]+t.height]};});
 for(let i=0;i<boxes.length;i++)for(const b of boxes.slice(i+1))assert.ok(!boxes[i].min.every((v,k)=>Math.min(boxes[i].max[k],b.max[k])>Math.max(v,b.min[k])),'Control text boxes overlap');
});
