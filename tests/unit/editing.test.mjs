import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {schemas} from '../../src/contracts.mjs';
import {boundForTransport,readResultPage} from '../../src/results.mjs';
const base={drawing:'drawing.dwg',expectedSha256:'a'.repeat(64),documentId:'202a2572-0b4a-4de4-95c0-138f250c0d83',expectedRevision:0,requestId:'293040de-26b0-4b1b-9e3f-98697c348ba0',units:'mm'};
test('native tray edits reject command text, mixed batches, core hosts and invalid sizes',()=>{
 const tray={type:'create_native_tray',fromPoint:[0,0,0],toPoint:[3000,0,0],width:400,height:150};
 assert.equal(schemas.edit.safeParse({...base,operations:[tray]}).success,true);
 const label={type:'add_native_tray_label',handle:'A',position:[1500,800,0],landingPoint:[2500,800,0]};
 assert.equal(schemas.edit.safeParse({...base,operations:[label]}).success,true);
 assert.equal(schemas.edit.safeParse({...base,operations:[{...label,landingPoint:label.position}]}).success,false);
 assert.equal(schemas.edit.safeParse({...base,operations:[{...tray,nativeModel:'injected'}]}).success,false);
 for(const request of [{...base,host:'core',operations:[tray]},{...base,operations:[tray,{type:'erase',handles:['A']}]},{...base,operations:[{...tray,toPoint:[0,0,0]}]},{...base,operations:[{...tray,height:0}]},{...base,operations:[{...tray,toPoint:[1e-10,0,0]}]},{...base,operations:[{...tray,command:'tel_set'}]}])assert.equal(schemas.edit.safeParse(request).success,false);
});
test('editing cannot accept code, output overrides, ambiguous handles or non-planar transforms',()=>{
 for(const operation of [{type:'run_command',command:'ERASE ALL'},{type:'move',handles:['A','a'],delta:[0,0,0]},{type:'move',handles:['A'],delta:[0,0,1]},{type:'scale',handles:['A'],center:[0,0,0],factor:0},{type:'mirror',handles:['A'],axisStart:[0,0,0],axisEnd:[0,0,0]}])assert.equal(schemas.edit.safeParse({...base,operations:[operation]}).success,false);
 assert.equal(schemas.edit.safeParse({...base,output:'source.dwg',operations:[{type:'erase',handles:['A']}]}).success,false);
 assert.equal(schemas.apply.safeParse({...base,operations:[{type:'erase',handles:['A']}]}).success,false);
});
test('query is bounded and uses exact filters instead of executable selectors',()=>{
 const q=schemas.query_entities.parse({drawing:'source.dwg',filter:{layers:['照明'],attributes:{MODEL:'LED'}}});assert.equal(q.limit,1000);
 for(const filter of [{region:{min:[10,10,0],max:[0,0,0]}},{selector:'*'},{handles:['../file']},{types:['PROXY']}])assert.equal(schemas.query_entities.safeParse({drawing:'source.dwg',filter}).success,false);
 assert.equal(schemas.query_entities.safeParse({drawing:'source.dwg',limit:5001}).success,false);
});
test('array work and export destinations stay bounded',()=>{
 assert.equal(schemas.edit.safeParse({...base,operations:[{type:'array',handles:['A'],rows:100,columns:100,rowSpacing:1,columnSpacing:1}]}).success,false);
 assert.equal(schemas.export.safeParse({drawing:'source.dwg',format:'png',output:'overwrite.png'}).success,false);
 assert.equal(schemas.export.safeParse({drawing:'source.dwg',format:'exe'}).success,false);
});
test('electrical route editing requires explicit known fields and forbids implicit endpoint guessing',()=>{
 assert.equal(schemas.edit.safeParse({...base,operations:[{type:'move_devices',ids:['A','A'],delta:[1,0,0]}]}).success,false);
 assert.equal(schemas.edit.safeParse({...base,operations:[{type:'update_route',id:'R',circuitId:'   '}]}).success,false);
 assert.equal(schemas.edit.safeParse({...base,operations:[{type:'update_route',id:'R',wireSpec:{nativeCode:'X'}}]}).success,false);
 assert.equal(schemas.edit.safeParse({...base,operations:[{type:'move_devices',ids:['L1'],delta:[100,0,0]},{type:'update_route',id:'R',vertices:[[0,0,0],[100,0,0]],circuitId:'WL2'}]}).success,true);
});
test('large queries retain a reachable entity paging entry with unchanged input identity',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cad-query-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const job=path.join(dir,'job-test');await fs.mkdir(job);
 const query={total:1000,truncated:false,entities:Array.from({length:1000},(_,i)=>({handle:i.toString(16),text:'x'.repeat(1000)}))};const record={ok:true,jobRoot:job,inputSha256:'f'.repeat(64),query};await fs.writeFile(path.join(job,'result.json'),JSON.stringify(record));
 const bounded=boundForTransport(record);assert.equal(bounded.responseTruncated,true);assert.deepEqual(bounded.details.kinds,['entities']);assert.equal(bounded.inputSha256,record.inputSha256);assert.equal(bounded.query.retainedEntityCount,1000);assert.ok(Buffer.byteLength(JSON.stringify(bounded))<512*1024);
 const combined=boundForTransport({...record,snapshot:{documentId:'d',revision:1,devices:Array.from({length:1000},(_,id)=>({id,text:'x'.repeat(500)}))}});assert.ok(combined.details.kinds.includes('entities'));assert.ok(combined.details.kinds.includes('managedDevices'));assert.equal(combined.inputSha256,record.inputSha256);
 const page=await readResultPage(dir,{jobId:'job-test',kind:'entities',offset:20,limit:2});assert.equal(page.items[0].handle,'14');assert.equal(page.total,1000);assert.equal(page.nextOffset,22);
});
