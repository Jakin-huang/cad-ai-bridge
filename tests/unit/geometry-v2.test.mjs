import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyGeometry} from '../../src/geometry-checks.mjs';
test('text size and block handedness are checked even when insertion points do not change',()=>{
 const text={handle:'A',type:'TEXT',position:[0,0,0],height:10,widthFactor:.5,basisX:[5,0,0],basisY:[0,10,0],rotationRadians:0,text:'A'},op={type:'scale',handles:['A'],center:[0,0,0],factor:2},actual={...text,height:20,basisX:[10,0,0],basisY:[0,20,0]};assert.equal(verifyGeometry([text],[actual],[op]).ok,true);assert.equal(verifyGeometry([text],[{...actual,height:10}],[op]).ok,false);assert.equal(verifyGeometry([text],[actual],[op]).pending.length,0);
 const block={handle:'B',type:'INSERT',position:[0,0,0],basisX:[1,0,0],basisY:[0,1,0],basisZ:[0,0,1]},mirror={type:'mirror',handles:['B'],axisStart:[0,0,0],axisEnd:[1,0,0],copy:false};assert.equal(verifyGeometry([block],[{...block,basisY:[0,-1,0],basisZ:[0,0,-1]}],[mirror]).ok,true);assert.equal(verifyGeometry([block],[block],[mirror]).ok,false);
});
test('solid vertices, text height, arc endpoints and polyline bulges reject wrong saved geometry',()=>{
 const solid={type:'add_geometry',entities:[{kind:'solid',layer:'A',points:[[0,0,0],[10,0,0],[0,10,0]]}]},saved={handle:'A',type:'SOLID',layer:'A',vertices:[[0,0,0],[10,0,0],[0,10,0],[0,10,0]]};assert.equal(verifyGeometry([],[saved],[solid],[{created:['A']}]).ok,true);assert.equal(verifyGeometry([],[{...saved,vertices:[[0,0,0],[10,0,0],[0,1,0],[0,1,0]]}],[solid],[{created:['A']}]).ok,false);
 const before={handle:'C',type:'LWPOLYLINE',vertices:[[0,0,0],[10,0,0]],bulges:[1,0],closed:false},mirror={type:'mirror',handles:['C'],axisStart:[0,0,0],axisEnd:[1,0,0],copy:false};assert.equal(verifyGeometry([before],[{...before,bulges:[-1,0]}],[mirror]).ok,true);assert.equal(verifyGeometry([before],[before],[mirror]).ok,false);
});
