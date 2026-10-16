import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {schemas} from '../../src/contracts.mjs';
import {snapshotDrawing,hashFile,isWithin} from '../../src/drawings.mjs';
import {summarize,readResultPage,boundForTransport} from '../../src/results.mjs';
import {atomicJson,csvCell} from '../../src/files.mjs';
import {selectInstallation} from '../../src/config.mjs';
async function temporary(t){const d=await fs.mkdtemp(path.join(os.tmpdir(),'cadbridge-test-'));t.after(()=>fs.rm(d,{recursive:true,force:true}));return d;}
test('write contract rejects off-plane geometry, arbitrary code and overwrite destinations',()=>{
 const base={drawing:'fixture.dwg',expectedSha256:'a'.repeat(64),documentId:'202a2572-0b4a-4de4-95c0-138f250c0d83',expectedRevision:0,requestId:'293040de-26b0-4b1b-9e3f-98697c348ba0',units:'mm',operations:[{type:'place_symbols',blockName:'EA_LIGHT',instances:[{id:'x',position:[0,0,0]}]}]};
 assert.ok(schemas.apply.safeParse(base).success);
 assert.equal(schemas.apply.safeParse({...base,output:'original.dwg'}).success,false);
 assert.equal(schemas.apply.safeParse({...base,operations:[{type:'run_lisp',code:'anything'}]}).success,false);
 assert.equal(schemas.apply.safeParse({...base,operations:[{...base.operations[0],instances:[{id:'x',position:[0,0,1]}]}]}).success,false);
});
test('result contract bounds page size and rejects path traversal',()=>{
 assert.equal(schemas.read_result.safeParse({jobId:'../outside',kind:'devices'}).success,false);
 assert.equal(schemas.read_result.safeParse({jobId:'job-a',kind:'devices',limit:101}).success,false);
 assert.equal(schemas.read_result.safeParse({jobId:'job-a',kind:'devices',offset:-1}).success,false);
 assert.equal(schemas.read_result.parse({jobId:'job-a',kind:'devices'}).limit,25);
});
test('installation selection refuses unknown and ambiguous host versions',()=>{
 const inventory={cads:[{root:'/cad/a',verifiedTarget:true},{root:'/cad/b',verifiedTarget:true},{root:'/cad/2025',verifiedTarget:false}]};
 assert.throws(()=>selectInstallation(inventory),/SELECTION_REQUIRED/);
 assert.equal(selectInstallation(inventory,'/cad/b').root,'/cad/b');
 assert.throws(()=>selectInstallation(inventory,'/cad/2025'),/NOT_SUPPORTED/);
});
test('snapshot preserves source, is exclusive and rejects stale content',async t=>{
 const d=await temporary(t),job=path.join(d,'job');await fs.mkdir(job);const source=path.join(d,'source.dwg');await fs.writeFile(source,'original');const digest=await hashFile(source);
 assert.equal(await snapshotDrawing(source,d,job,digest),digest);await fs.writeFile(path.join(job,'input.dwg'),'modified copy');assert.equal(await fs.readFile(source,'utf8'),'original');
 await assert.rejects(snapshotDrawing(source,d,job,digest),{code:'EEXIST'});
 const next=path.join(d,'next');await fs.mkdir(next);await assert.rejects(snapshotDrawing(source,d,next,'0'.repeat(64)),/STALE_FILE/);
});
test('snapshot rejects files beyond the allowed root, wrong extensions and junction escapes',async t=>{
 const d=await temporary(t),work=path.join(d,'work'),outside=path.join(d,'outside'),job=path.join(work,'job');await fs.mkdir(job,{recursive:true});await fs.mkdir(outside);const foreign=path.join(outside,'source.dwg');await fs.writeFile(foreign,'x');
 await assert.rejects(snapshotDrawing(foreign,work,job),/within/);const text=path.join(work,'not-a-drawing.txt');await fs.writeFile(text,'x');await assert.rejects(snapshotDrawing(text,work,job),/within/);
 const link=path.join(work,'linked');await fs.symlink(outside,link,process.platform==='win32'?'junction':'dir');await assert.rejects(snapshotDrawing(path.join(link,'source.dwg'),work,job),/within/);
 assert.equal(isWithin(work,path.join(d,'work-other','a.dwg')),false);
});
test('owned configuration replacement backs up exact bytes',async t=>{
 const d=await temporary(t),file=path.join(d,'local.json');await fs.writeFile(file,'{"previous":1}\n');const r=await atomicJson(file,{next:2},{backup:true});assert.equal(await fs.readFile(r.backup,'utf8'),'{"previous":1}\n');assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),{next:2});assert.equal((await fs.readdir(d)).filter(n=>n.includes('.tmp-')).length,0);
});
test('separate user workspace can reopen owned outputs while unrelated and linked paths remain denied',async t=>{
 const d=await temporary(t),work=path.join(d,'work'),runs=path.join(d,'runs'),outside=path.join(d,'outside'),job=path.join(runs,'next');
 for(const dir of [work,runs,outside,job])await fs.mkdir(dir,{recursive:true});
 const output=path.join(runs,'output.dwg');await fs.writeFile(output,'generated drawing');
 assert.equal(await snapshotDrawing(output,[work,runs],job),await hashFile(output));
 const foreign=path.join(outside,'foreign.dwg');await fs.writeFile(foreign,'not allowed');
 await assert.rejects(snapshotDrawing(foreign,[work,runs],job),/within/);
 const link=path.join(runs,'linked');await fs.symlink(outside,link,process.platform==='win32'?'junction':'dir');
 await assert.rejects(snapshotDrawing(path.join(link,'foreign.dwg'),[work,runs],job),/within/);
});
test('summary retains coverage and exposes bounded preview without mutating full evidence',()=>{
 const devices=Array.from({length:100},(_,i)=>({id:i})),wires=devices.map(x=>({...x}));const r={jobRoot:path.join('runs','job-test'),snapshot:{documentId:'d',revision:2,symbols:[]},tangent:{deviceCount:100,wireCount:100,devices,wires,circuits:[{id:'WL1'}],coverage:{scope:'root'}}};const s=summarize(r);
 assert.equal(s.tangent.devices,undefined);assert.equal(s.tangent.preview.devices.length,3);assert.deepEqual(s.tangent.coverage,r.tangent.coverage);assert.equal(s.details.jobId,'job-test');assert.equal(r.tangent.devices.length,100);
});
test('saved result pagination reads only owned evidence and verifies its digest',async t=>{
 const d=await temporary(t),runs=path.join(d,'runs'),job=path.join(runs,'job-test');await fs.mkdir(job,{recursive:true});const file=path.join(job,'result.json');await fs.writeFile(file,JSON.stringify({tangent:{devices:[{id:1},{id:2},{id:3}]}}));const r=await readResultPage(runs,{jobId:'job-test',kind:'devices',offset:1,limit:1});assert.deepEqual(r.items,[{id:2}]);assert.equal(r.total,3);assert.equal(r.hasMore,true);assert.equal(r.resultSha256,await hashFile(file));await assert.rejects(readResultPage(runs,{jobId:'job-test',kind:'wires'}),/UNAVAILABLE/);
 const outside=path.join(d,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'result.json'),'{"tangent":{"devices":[]}}');await fs.symlink(outside,path.join(runs,'job-escape'),process.platform==='win32'?'junction':'dir');await assert.rejects(readResultPage(runs,{jobId:'job-escape',kind:'devices'}),/OUTSIDE/);
});
test('CSV cells quote content and prevent formula interpretation',()=>{
 assert.equal(csvCell('WL1'),'"WL1"');assert.equal(csvCell('=HYPERLINK("x")'),'"\'=HYPERLINK(""x"")"');assert.equal(csvCell('A\nB'),'"A\nB"');assert.equal(csvCell(null),'""');
});
test('large full-detail results stay within MCP transport budget and retain small managed snapshots',()=>{
 const devices=Array.from({length:1000},(_,id)=>({id,raw:'x'.repeat(1000)}));const result={ok:true,jobRoot:path.join('runs','job-large'),snapshot:{documentId:'d',revision:1,devices:[{id:'new'}],symbols:[]},tangent:{devices,wires:[],circuits:[],coverage:{scope:'roots'}}};const limited=boundForTransport(result);
 assert.equal(limited.responseTruncated,true);assert.ok(Buffer.byteLength(JSON.stringify(limited))<512*1024);assert.deepEqual(limited.snapshot.devices,[{id:'new'}]);assert.equal(limited.details.jobId,'job-large');assert.equal(result.tangent.devices.length,1000);
 const failed=boundForTransport({ok:false,error:{code:'NUMBER_CONFLICT',message:'Duplicate number'},drawingSaved:false,jobRoot:result.jobRoot,afterFailure:{raw:'x'.repeat(1000000)}});assert.equal(failed.error.code,'NUMBER_CONFLICT');assert.equal(failed.drawingSaved,false);assert.equal(failed.details.jobId,'job-large');assert.ok(Buffer.byteLength(JSON.stringify(failed))<512*1024);
});
test('result pages cap bytes and provide a reachable continuation for large records',async t=>{
 const d=await temporary(t),job=path.join(d,'job-large');await fs.mkdir(job);await fs.writeFile(path.join(job,'result.json'),JSON.stringify({audit:{definitions:Array.from({length:12},(_,i)=>({i,text:'x'.repeat(50000)}))}}));
 const page=await readResultPage(d,{jobId:'job-large',kind:'definitions',offset:0,limit:100});assert.ok(Buffer.byteLength(JSON.stringify(page))<300000);assert.ok(page.items.length>0&&page.items.length<12);assert.equal(page.nextOffset,page.items.length);assert.equal(page.hasMore,true);
 const next=await readResultPage(d,{jobId:'job-large',kind:'definitions',offset:page.nextOffset,limit:100});assert.equal(next.items[0].i,page.nextOffset);
});
