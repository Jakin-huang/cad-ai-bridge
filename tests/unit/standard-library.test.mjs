import test from 'node:test';import assert from 'node:assert/strict';
import {flattenBlock,selectV02Cable} from '../../src/standard-library.mjs';import {sceneSchema} from '../../src/contracts.mjs';
const entity=(type,pairs,handle='A')=>({type,pairs,handle});
const blocks=entities=>new Map([['TEST',{name:'TEST',origin:[0,0],entities}]]);
test('standard block flattening applies nested origin, rotation, scale and mirror',()=>{
 const b=blocks([entity('LINE',[[10,'0'],[20,'0'],[11,'1'],[21,'0']])]);b.set('ROOT',{name:'ROOT',origin:[10,0],entities:[entity('INSERT',[[2,'TEST'],[10,'12'],[20,'3'],[41,'2'],[42,'2'],[50,'90']])]});
 const g=flattenBlock(b,'ROOT').geometry[0];assert.ok(Math.abs(g.points[0][0]-2)<1e-9);assert.ok(Math.abs(g.points[1][1]-5)<1e-9);
});
test('standard solid hatches preserve filled area and reject unsupported holes',()=>{
 const e=entity('HATCH',[[2,'SOLID'],[91,'1'],[92,'7'],[93,'4'],[10,'0'],[20,'0'],[10,'10'],[20,'0'],[10,'10'],[20,'5'],[10,'0'],[20,'5'],[97,'0']]);
 const g=flattenBlock(blocks([e]),'TEST').geometry;assert.equal(g.length,2);const area=g.reduce((s,t)=>{const[a,b,c]=t.points;return s+Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;},0);assert.equal(area,50);
 const bad=structuredClone(e);bad.pairs.find(p=>p[0]===91)[1]='2';assert.throws(()=>flattenBlock(blocks([bad]),'TEST'),/holes/);
});
test('standard curves are tessellated to the declared output chord tolerance',()=>{
 const g=flattenBlock(blocks([entity('ARC',[[10,'0'],[20,'0'],[40,'100'],[50,'0'],[51,'90']])]),'TEST',{scale:2,tolerance:.05}).geometry[0];
 for(let i=1;i<g.points.length;i++){const[a,b]=[g.points[i-1],g.points[i]];assert.ok(200-Math.hypot((a[0]+b[0])/2,(a[1]+b[1])/2)<=.050001);}
});
test('unknown, cyclic and non-planar source inserts fail rather than become missing geometry',()=>{
 assert.throws(()=>flattenBlock(blocks([entity('SPLINE',[])]),'TEST'),/Unsupported/);
 assert.throws(()=>flattenBlock(blocks([entity('INSERT',[[2,'TEST']])]),'TEST'),/Cyclic/);
 assert.throws(()=>flattenBlock(blocks([entity('INSERT',[[2,'TEST'],[230,'0']])]),'TEST'),/extrusion/);
});
test('template cable selection binds matching row, ampacity and conduit and refuses changed installation',()=>{
 const source=text=>({handle:'A',text}),r={wire:{type:'WIRE',source:source('WIRE')},ordinaryCable:{type:'CABLE',source:source('CABLE')},wireMatch:[{ratingA:16,singlePhase:source('2x2.5+E2.5')}],cableMatch:[{ratingA:20,conduit:source('5x4')}],ampacity:[{sectionMm2:2.5,wireTwoLoaded:source('31')},{sectionMm2:4,cableConcealedA:source('30')}],wireConduits:[{sectionMm2:2.5,source:source('2x2.5+E2.5.SC20')}],ordinaryConduits:[{sectionMm2:4,source:source('5x4.SC32')}]};
 assert.equal(selectV02Cable(r,{ratingA:10}).sectionMm2,2.5);assert.equal(selectV02Cable(r,{ratingA:20,kind:'cable',phase:3}).conduit,'SC32');assert.throws(()=>selectV02Cable(r,{ratingA:20,installation:'bundled-tray'}),/not verified/);assert.throws(()=>selectV02Cable(r,{ratingA:999}),/range/);assert.throws(()=>selectV02Cable(r,{ratingA:20,kind:'cable',phase:1}),/three-phase/);
});
test('solid, width and text width scene limits reject malformed primitive data',()=>{
 const make=entities=>({layers:[{name:'E-LIGHT',color:2}],symbols:[],entities});assert.equal(sceneSchema.safeParse(make([{kind:'solid',layer:'0',points:[[0,0,0],[1,0,0],[0,1,0]]}])).success,true);
 assert.equal(sceneSchema.safeParse(make([{kind:'solid',layer:'0',points:[[0,0,0],[1,0,0]]}])).success,false);assert.equal(sceneSchema.safeParse(make([{kind:'polyline',layer:'0',points:[[0,0,0],[1,0,0]],width:-1}])).success,false);
});
