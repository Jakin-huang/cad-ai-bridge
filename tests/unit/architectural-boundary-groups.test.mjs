import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {compileArchitecturalSpaces} from '../../src/architectural-spaces.mjs';
import {architectureInspectionSchema} from '../../src/architectural-contracts.mjs';
import {assembleBoundaryGroup} from '../../src/architectural-boundary-groups.mjs';

const vertices=[[0,0,0],[6000,0,0],[6000,3000,0],[3000,3000,0],[3000,6000,0],[0,6000,0]];
function fixture(){
 const edges=vertices.map((p,i)=>({type:'LINE',handle:(i+10).toString(16),instancePath:['A',(i+10).toString(16)],layer:'ROOM',start:p,end:vertices[(i+1)%vertices.length]}));
 const q={units:'Millimeters',errors:[],truncated:false,traversal:{completeLocalScope:true,excludedXrefs:[]},entities:[...edges,{type:'TEXT',handle:'20',instancePath:['A','20'],layer:'NAME',position:[1000,1000,0],text:'Studio'},{type:'POINT',handle:'21',instancePath:['A','21'],layer:'ENTRY',position:[1000,0,0]}]};
 const o=architectureInspectionSchema.parse({action:'inspect_architecture',requestId:crypto.randomUUID(),drawing:'synthetic.dwg',expectedSha256:'a'.repeat(64),sourceId:'ARCH',sourceOrigin:'declared_architecture',inventoryOrigin:'project_schedule',boundaryLayers:['ROOM'],labelLayers:['NAME'],boundaryGroups:[{id:'STUDIO_BOUNDARY',instancePaths:edges.map(e=>e.instancePath)}],expectedRooms:[{id:'STUDIO',name:'Studio',entryInstancePaths:[['A','21']]}]});
 return {q,o};
}
test('explicit connected source lines preserve concavity, exact area, source identities and entry anchors',()=>{
 const {q,o}=fixture(),before=structuredClone(q),p=compileArchitecturalSpaces(q,o),r=p.rooms[0];
 assert.equal(p.coverage.geometryComplete,true);assert.equal(r.areaM2,27);assert.deepEqual(r.polygon,vertices.map(p=>p.slice(0,2)));assert.equal(r.geometryStatus,'observed_closed_boundary');
 assert.equal(r.boundaryInstancePath,undefined);assert.equal(r.boundaryGroupId,'STUDIO_BOUNDARY');assert.deepEqual(r.boundaryInstancePaths,o.boundaryGroups[0].instancePaths.map(p=>p.map(h=>h.toUpperCase())));assert.deepEqual(r.entries[0].position,[1000,0]);assert.equal(p.architecture.length,6);assert.deepEqual(q,before);assert.equal(p.professionalApproval,false);
 // Source segment direction and caller order are not room shape assumptions.
 const shuffled=structuredClone(q);shuffled.entities[2].start=q.entities[2].end;shuffled.entities[2].end=q.entities[2].start;
 o.boundaryGroups[0].instancePaths.reverse();const b=compileArchitecturalSpaces(shuffled,o);assert.equal(b.coverage.geometryComplete,true);assert.equal(b.rooms[0].areaM2,27);
});
test('line groups reject gaps without snapping, branches, missing/reused objects, curves, nonplanarity and self intersections',()=>{
 const cases=[
  q=>{q.entities[0].start=[0.000001,0,0];},
  q=>{q.entities[1].start=[100,100,0];},
  q=>{q.entities[0].type='ARC';},
  q=>{q.entities[0].layer='OTHER';},
  q=>{q.entities.push(structuredClone(q.entities[0]));},
  q=>{q.entities[1].end=[6000,3000,50];q.entities[2].start=[6000,3000,50];},
  q=>{q.entities[0].start=[NaN,0,0];},
  q=>{q.entities[0].end=q.entities[0].start;},
 ];
 for(const mutate of cases){const {q,o}=fixture();mutate(q);const p=compileArchitecturalSpaces(q,o);assert.equal(p.coverage.geometryComplete,false);assert.ok(p.issues.some(i=>i.code==='BOUNDARY_GROUP_INVALID'));}
 const {q,o}=fixture();o.boundaryGroups[0].instancePaths[1]=o.boundaryGroups[0].instancePaths[0];assert.equal(compileArchitecturalSpaces(q,o).coverage.geometryComplete,false);
 const bow=[[0,0],[4000,4000],[0,4000],[4000,0]];q.entities=bow.map((p,i)=>({type:'LINE',layer:'ROOM',handle:String(i+1),start:p,end:bow[(i+1)%4]}));o.boundaryGroups[0].instancePaths=q.entities.map(e=>[e.handle]);assert.ok(compileArchitecturalSpaces(q,o).issues.some(i=>i.code==='BOUNDARY_GROUP_INVALID'&&i.message.includes('Self-intersecting')));
});
test('disconnected cycles and unassigned source entities cannot be hidden by a valid group',()=>{
 const {q,o}=fixture(),group=o.boundaryGroups[0];const second=q.entities.slice(0,6).map((e,i)=>({...e,handle:(i+30).toString(16),instancePath:['B',(i+30).toString(16)],start:e.start.map((v,k)=>k===0?v+10000:v),end:e.end.map((v,k)=>k===0?v+10000:v)}));
 assert.equal(assembleBoundaryGroup([...q.entities,...second],{instancePaths:[...group.instancePaths,...second.map(e=>e.instancePath)]},['ROOM']).ok,false);
 q.entities.push(...second);assert.equal(compileArchitecturalSpaces(q,o).coverage.geometryComplete,false);
 const fresh=fixture();fresh.o.boundaryGroups.push({...fresh.o.boundaryGroups[0],id:'DUPLICATE_LOOP'});assert.ok(compileArchitecturalSpaces(fresh.q,fresh.o).issues.some(i=>i.code==='ROOM_BOUNDARY_AMBIGUOUS'));
});
test('two adjacent spaces may explicitly share a source edge without overlapping interiors',()=>{
 const {q,o}=fixture();const points=[[0,0],[4000,0],[4000,4000],[0,4000],[8000,0],[8000,4000]],pairs=[[0,1],[1,2],[2,3],[3,0],[1,4],[4,5],[5,2]];
 q.entities=pairs.map(([a,b],i)=>({type:'LINE',handle:String(i+1),layer:'ROOM',start:points[a],end:points[b]}));q.entities.push({type:'TEXT',handle:'10',layer:'NAME',text:'Left',position:[1000,1000]},{type:'TEXT',handle:'11',layer:'NAME',text:'Right',position:[5000,1000]});
 o.boundaryGroups=[{id:'LEFT',instancePaths:[['1'],['2'],['3'],['4']]},{id:'RIGHT',instancePaths:[['5'],['6'],['7'],['2']]}];o.expectedRooms=[{id:'LEFT',name:'Left'},{id:'RIGHT',name:'Right'}];
 const p=compileArchitecturalSpaces(q,o);assert.equal(p.coverage.geometryComplete,true);assert.deepEqual(p.rooms.map(r=>r.areaM2),[16,16]);assert.equal(p.coverage.unmappedBoundaries.length,0);
 o.expectedRooms.pop();assert.equal(compileArchitecturalSpaces(q,o).coverage.completeInventory,false);
});
