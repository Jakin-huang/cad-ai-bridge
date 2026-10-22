import test from 'node:test';
import assert from 'node:assert/strict';
import {exportEngineeringSheets} from '../../src/engineering-sheet-export.mjs';
test('55 sheets export in ordered native-sized batches and stop before later batches on failure',async()=>{
 const sheets=Array.from({length:55},(_,i)=>({id:'E'+i,paper:'A3',paperDenominator:100,region:{min:[i*40000,0,0],max:[i*40000+39000,26000,0]}})),calls=[];
 const result=await exportEngineeringSheets(async(a,q)=>{assert.equal(a,'export_many');calls.push(q);return {ok:true,exports:q.items.map(x=>({name:x.name,format:x.format}))};},'test.dwg',sheets);
 assert.deepEqual(calls.map(c=>c.items.length),[20,20,20,20,20,10]);assert.deepEqual(result.exports,sheets.flatMap(s=>[{name:s.id,format:'pdf'},{name:s.id,format:'png'}]));assert.ok(calls.every(c=>c.drawing==='test.dwg'));
 let count=0;await assert.rejects(()=>exportEngineeringSheets(async(a,q)=>({ok:++count!==2,exports:q.items.map(x=>({name:x.name,format:x.format}))}), 'test.dwg',sheets),/BATCH_FAILED/);assert.equal(count,2);
 await assert.rejects(()=>exportEngineeringSheets(async()=>({ok:true,exports:[]}), 'test.dwg',sheets),/BATCH_INCOMPLETE/);
 const original={ok:true,exports:[{name:'E0',format:'pdf'},{name:'E0',format:'png'}],jobRoot:'native'};assert.equal(await exportEngineeringSheets(async()=>original,'test.dwg',sheets.slice(0,1)),original);
});
