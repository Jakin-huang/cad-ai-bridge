import test from 'node:test';import assert from 'node:assert/strict';
import {parseDxf,curveLength,deviceCategory,compareElectrical,unchangedRecords} from '../../src/dxf-audit.mjs';
const encode=pairs=>pairs.flat().join('\n')+'\n';
const drawing=name=>parseDxf(encode([[0,'SECTION'],[2,'ENTITIES'],[0,'INSERT'],[5,'A1'],[2,'REAL_SYMBOL'],[10,10],[20,20],[30,0],[1001,'fireequip'],[1000,'T'],[0,'ATTRIB'],[5,'A2'],[2,'A'],[1,name],[0,'SEQEND'],[5,'A3'],[0,'LINE'],[5,'B1'],[10,0],[20,0],[11,3],[21,4],[1001,'linenum'],[1000,'WL1'],[0,'ENDSEC'],[0,'EOF']]));
test('DXF independent audit preserves text whitespace and catches changed saved attributes',()=>{
 const dxf=drawing(' Smoke detector ');assert.equal(deviceCategory(dxf.roots[0]),'fire');assert.equal(dxf.attributes.get('A1').A,' Smoke detector ');
 const tangent={devices:[{handle:'A1',blockName:'REAL_SYMBOL',category:'fire',position:[10,20,0],attributes:{A:' Smoke detector '}}],wires:[{handle:'B1',lengthDrawingUnits:5,spec:{linenum:'WL1'}}],circuits:[{id:'WL1',wireCount:1}]};
 assert.equal(compareElectrical(dxf,tangent).ok,true);tangent.devices[0].attributes.A='different';assert.equal(compareElectrical(dxf,tangent).ok,false);
 assert.equal(unchangedRecords(dxf,drawing('changed')).ok,false);assert.equal(unchangedRecords(dxf,drawing(' Smoke detector ')).ok,true);
});
test('DXF geometry handles arc wrapping, bulges and closed routes',()=>{
 assert.ok(Math.abs(curveLength({type:'ARC',pairs:[[40,10],[50,270],[51,0]]})-5*Math.PI)<1e-10);
 assert.ok(Math.abs(curveLength({type:'LWPOLYLINE',pairs:[[10,0],[20,0],[42,1],[10,10],[20,0]]})-5*Math.PI)<1e-10);
 assert.equal(curveLength({type:'LWPOLYLINE',pairs:[[70,1],[10,0],[20,0],[10,3],[20,0],[10,3],[20,4]]}),12);
});
test('dimension-name normalization requires stable block identity and preserves geometry checks',()=>{
 const file=(name,radius,owner='B0')=>parseDxf(encode([[0,'SECTION'],[2,'BLOCKS'],[0,'BLOCK'],[5,'B1'],[330,owner],[2,name],[3,name],[0,'CIRCLE'],[5,'C1'],[40,radius],[0,'ENDBLK'],[5,'B2'],[0,'ENDSEC'],[0,'SECTION'],[2,'ENTITIES'],[0,'DIMENSION'],[5,'D1'],[2,name],[0,'ENDSEC'],[0,'EOF']]));
 assert.equal(unchangedRecords(file('*D10',2),file('*D20',2)).ok,true);assert.equal(unchangedRecords(file('*D10',2),file('*D20',3)).ok,false);assert.equal(unchangedRecords(file('*D10',2),file('*D20',2,'OTHER')).ok,false);
 assert.throws(()=>parseDxf('0\nSECTION\n2\nENTITIES\n'),/INCOMPLETE/);
});
