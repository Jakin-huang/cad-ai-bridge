import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {schemas,publicWorkflowSchema} from '../../src/contracts.mjs';
import {createExecutor} from '../../src/runner.mjs';
import {buildQueryIndex,indexedRows,matchesRow} from '../../src/query-index.mjs';
import {readResultPage,boundForTransport} from '../../src/results.mjs';
import {hashFile} from '../../src/drawings.mjs';
import {verifyGeometry} from '../../src/geometry-checks.mjs';
import {parseDxf,unchangedRecords} from '../../src/dxf-audit.mjs';
import {verifyPlotBytes} from '../../src/plot-checks.mjs';
import {toolResponse} from '../../src/tool-response.mjs';

test('first-task layer 0 is legal exactly once and session status has a declared schema',()=>{
 const scene={layers:[{name:'0',color:7}],symbols:[],entities:[]};assert.equal(schemas.create_drawing.safeParse({scene}).success,true);assert.equal(schemas.create_drawing.safeParse({scene:{...scene,layers:[...scene.layers,...scene.layers]}}).success,false);assert.equal(schemas.session.safeParse({action:'status'}).success,true);
});
test('large capture remains bounded independently of legacy query limits',()=>{
 assert.equal(schemas.scan.parse({drawing:'test.dwg'}).limit,100000);assert.equal(schemas.scan.safeParse({drawing:'test.dwg',limit:100001}).success,false);assert.equal(schemas.query_entities.safeParse({drawing:'test.dwg',limit:5001}).success,false);
});
test('legacy result pages do not receive an implicit indexed filter from schema defaults',async t=>{
 const args=schemas.read_result.parse({jobId:'job-old',kind:'devices'});assert.equal(args.filter,undefined);const root=await fs.mkdtemp(path.join(os.tmpdir(),'cad-legacy-page-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,args.jobId));await fs.writeFile(path.join(root,args.jobId,'result.json'),JSON.stringify({tangent:{devices:[{handle:'A',category:'lighting'}]}}));const result=await readResultPage(root,args);assert.equal(result.ok,true);assert.equal(result.items[0].handle,'A');
});
test('compact advertised edit requests still pass strict executable validation before configuration or CAD',async()=>{
 const request={drawing:'test.dwg',requestId:crypto.randomUUID(),plan:{type:'edit',operations:[{type:'run_command',command:'ERASE ALL'}]}};assert.equal(publicWorkflowSchema.safeParse(request).success,true);const execute=createExecutor({getSettings:async()=>{throw Error('Configuration must not be reached');},launch:async()=>{throw Error('CAD must not be reached');}});const result=await execute('workflow',request);assert.equal(result.ok,false);assert.equal(result.error.code,'INVALID_ARGUMENT');
});
test('indexed filtering preserves stable order, repeated nested handles and explicit scope',()=>{
 const rows=Array.from({length:10002},(_,i)=>({handle:(i%1000+1).toString(16),instancePath:[String(i),String(i%1000+1)],type:i%2?'TEXT':'LINE',layer:i%3?'PLAN':'LEGEND',text:i%2?'标题':'',bounds:{min:[i,0,0],max:[i+1,1,0]}}));
 const index=buildQueryIndex(rows),filter={types:['LINE'],layers:['plan'],region:{min:[100,0,0],max:[200,2,0],mode:'contains'}};assert.deepEqual(indexedRows(rows,index,filter),rows.filter(row=>matchesRow(row,filter)));assert.equal(indexedRows(rows,index,{handles:['1']}).length,11);assert.equal(index.count,10002);
 const identities=[{handle:'A',id:'device'},{handle:'B',id:'DEVICE'}];assert.deepEqual(indexedRows(identities,buildQueryIndex(identities),{ids:['device']}),[identities[0]]);
});
test('saved index pages bind snapshot hashes, project fields and reject changed indices',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cad-index-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const jobId='job-scan',job=path.join(root,jobId);await fs.mkdir(job);const rows=Array.from({length:6100},(_,i)=>({handle:(i+1).toString(16),type:i%2?'TEXT':'LINE',layer:'PLAN',text:'x'.repeat(100)})),indexFile=path.join(job,'query-index.json');await fs.writeFile(indexFile,JSON.stringify(buildQueryIndex(rows)));await fs.writeFile(path.join(job,'result.json'),JSON.stringify({inputSha256:'a'.repeat(64),query:{entities:rows,total:rows.length,returned:rows.length,truncated:false},queryIndex:{sha256:await hashFile(indexFile)}}));
 const first=await readResultPage(root,{jobId,kind:'entities',filter:{types:['LINE']},fields:['type'],limit:100});assert.equal(first.total,3050);assert.equal(first.items.length,100);assert.deepEqual(Object.keys(first.items[0]),['handle','type']);const second=await readResultPage(root,{jobId,kind:'entities',filter:{types:['LINE']},offset:first.nextOffset,expectedResultSha256:first.resultSha256});assert.notEqual(second.items[0].handle,first.items[0].handle);assert.equal(second.coverage.captured,6100);
 await assert.rejects(readResultPage(root,{jobId,kind:'entities',expectedResultSha256:'0'.repeat(64)}),/RESULT_CHANGED/);await fs.appendFile(indexFile,' ');await assert.rejects(readResultPage(root,{jobId,kind:'entities',filter:{types:['LINE']}}),/QUERY_INDEX_CHANGED/);
});
test('already compact scan replies remain reachable when a large managed snapshot exceeds the transport budget',()=>{
 const result=boundForTransport({ok:true,jobRoot:path.join(os.tmpdir(),'job-scan'),query:{retainedEntityCount:6000,total:6000,truncated:false},snapshot:{devices:Array.from({length:1000},(_,i)=>({id:i,text:'x'.repeat(1000)})),routes:[]}});assert.equal(result.ok,true);assert.equal(result.responseTruncated,true);assert.equal(result.query.retainedEntityCount,6000);assert.ok(result.details.kinds.includes('entities'));assert.ok(result.details.kinds.includes('managedDevices'));
});
test('image presentation failures retain committed DWG identity and prohibit write retries',async()=>{
 const reply=await toolResponse('workflow',{response:'summary'},{ok:true,jobRoot:path.join(os.tmpdir(),'job-saved'),drawing:'output.dwg',drawingSha256:'a'.repeat(64),drawingSaved:true,mutationCommitted:true,outcome:'saved',files:[{kind:'png',file:'missing.png',bytes:100}]},{readFile:async()=>{throw Error('IMAGE_UNAVAILABLE');}});assert.equal(reply.isError,true);const result=JSON.parse(reply.content[0].text);assert.equal(result.drawing,'output.dwg');assert.equal(result.drawingSaved,true);assert.equal(result.mutationCommitted,true);assert.equal(result.outcome,'saved');assert.equal(result.safeToRetry,false);assert.equal(result.error.stage,'presentation');
});
test('preservation exempts selected instance attributes and SEQEND but protects other instances and definitions',()=>{
 const encode=records=>parseDxf(['0','SECTION','2','ENTITIES',...records.flat(),'0','ENDSEC','0','EOF',''].join('\n'));
 const original=[['0','INSERT','5','A','8','OLD'],['0','ATTRIB','5','B','330','A','1','OLD'],['0','SEQEND','5','C','330','A','8','OLD'],['0','LINE','5','D','10','1','20','2']];
 const changed=structuredClone(original);changed[0][5]='NEW';changed[1][7]='NEW';changed[2][7]='NEW';assert.equal(unchangedRecords(encode(original),encode(changed),{excludedHandles:['A']}).ok,true);assert.equal(unchangedRecords(encode(original),encode(changed)).ok,false);changed[3][5]='999';assert.equal(unchangedRecords(encode(original),encode(changed),{excludedHandles:['A']}).ok,false);
});
test('geometry verification rejects a host success with wrong saved coordinates and composes transforms',()=>{
 const before=[{handle:'A',type:'LINE',start:[0,0,0],end:[100,0,0],length:100}];const ops=[{type:'move',handles:['A'],delta:[10,20,0]},{type:'scale',handles:['A'],center:[0,0,0],factor:2}];assert.equal(verifyGeometry(before,[{...before[0],start:[20,40,0],end:[220,40,0],length:200}],ops).ok,true);assert.equal(verifyGeometry(before,before,ops).ok,false);assert.equal(verifyGeometry(before,before,[{type:'erase',handles:['A']}]).ok,false);
});
test('preservation catches appended geometry inside an existing block even if original records survive',()=>{
 const encode=extra=>parseDxf(['0','SECTION','2','BLOCKS','0','BLOCK','5','A','330','F','2','SYMBOL','0','LINE','5','B','330','F','10','1','20','2',...extra,'0','ENDBLK','5','C','330','F','0','ENDSEC','0','EOF',''].join('\n'));const before=encode([]),after=encode(['0','LINE','5','D','330','F','10','3','20','4']);assert.equal(unchangedRecords(before,after,{protectExistingBlockMembership:true}).ok,false);assert.equal(unchangedRecords(before,after,{protectExistingBlockMembership:true}).differences[0].kind,'unexpected-addition-to-existing-block');
});
test('array checks retained copy geometry and counts; unsupported geometric checks stay explicit',()=>{
 const before=[{handle:'A',type:'LINE',start:[0,0,0],end:[100,0,0],length:100}],after=[...before,{handle:'B',type:'LINE',start:[0,20,0],end:[100,20,0],length:100}];const op={type:'array',handles:['A'],rows:2,columns:1,rowSpacing:20,columnSpacing:0};assert.equal(verifyGeometry(before,after,[op],[{created:['B']}]).ok,true);assert.equal(verifyGeometry(before,after,[op],[{created:[]}]).ok,false);assert.equal(verifyGeometry(before,after,[{type:'offset',handles:['A'],distance:10}]).pending.length,1);
});
test('block rotation at its own insertion point checks the angle and does not accept unchanged geometry',()=>{
 const before=[{handle:'A',type:'INSERT',position:[0,0,0],rotationRadians:0,blockName:'BLOCK',attributes:{MODEL:'A'}}],op={type:'rotate',handles:['A'],center:[0,0,0],angleRadians:Math.PI/2};assert.equal(verifyGeometry(before,[{...before[0],rotationRadians:Math.PI/2}],[op]).ok,true);assert.equal(verifyGeometry(before,before,[op]).ok,false);const text=[{handle:'B',type:'TEXT',position:[0,0,0],text:'A'}];assert.ok(verifyGeometry(text,text,[{...op,handles:['B']}]).pending.some(p=>p.reason.includes('rotation')));
});
test('polyline scaling checks actual variable segment widths as well as centerline length',()=>{
 const before=[{handle:'A',type:'LWPOLYLINE',vertices:[[0,0,0],[10,0,0]],start:[0,0,0],end:[10,0,0],length:10,segmentWidths:[[0,5],[5,5]],variableWidth:true}],op={type:'scale',handles:['A'],center:[0,0,0],factor:2},after=[{...before[0],vertices:[[0,0,0],[20,0,0]],end:[20,0,0],length:20,segmentWidths:[[0,10],[10,10]]}];assert.equal(verifyGeometry(before,after,[op]).ok,true);assert.equal(verifyGeometry(before,[{...after[0],segmentWidths:before[0].segmentWidths}],[op]).ok,false);
});
test('saved layer postconditions honor CAD layer-name case insensitivity',()=>{
 const before=[{handle:'A',type:'TEXT',position:[0,0,0],layer:'OLD',text:'A'}],after=[{...before[0],layer:'PLAN'}];assert.equal(verifyGeometry(before,after,[{type:'set_layer',handles:['A'],layer:'plan'}]).ok,true);
});
test('PDF contract verifies actual page size and orientation rather than file existence',()=>{
 const pdf=Buffer.from('%PDF-1.7\n1 0 obj << /Type /Page /MediaBox [0 0 1190.551181 841.889764] >> endobj\n%%EOF');assert.equal(verifyPlotBytes(pdf,'pdf',{paper:'A3',orientation:'landscape'}).requestedPaperVerified,true);assert.throws(()=>verifyPlotBytes(pdf,'pdf',{paper:'A4',orientation:'portrait'}),/PLOT_PAPER_MISMATCH/);assert.throws(()=>verifyPlotBytes(Buffer.from('%PDF-1.7\n%%EOF'),'pdf',{paper:'A3',orientation:'landscape'}),/PLOT_PAPER_UNVERIFIED/);
 const rotated=Buffer.from(pdf.toString().replace('>> endobj','/Rotate 270 >> endobj'));assert.throws(()=>verifyPlotBytes(rotated,'pdf',{paper:'A3',orientation:'landscape'}),/PLOT_PAPER_MISMATCH/);assert.equal(verifyPlotBytes(rotated,'pdf',{paper:'A3',orientation:'portrait'}).requestedPaperVerified,true);
 const inherited=Buffer.from('%PDF-1.7\n1 0 obj << /Type /Pages /MediaBox [0 0 1190.551181 841.889764] /Rotate -90 >> endobj\n2 0 obj << /Type /Page /Parent 1 0 R >> endobj');assert.equal(verifyPlotBytes(inherited,'pdf',{paper:'A3',orientation:'portrait'}).requestedPaperVerified,true);assert.throws(()=>verifyPlotBytes(inherited,'pdf',{paper:'A3',orientation:'landscape'}),/PLOT_PAPER_MISMATCH/);
 assert.equal(schemas.export.safeParse({drawing:'test.dwg',format:'pdf',plot:{style:'../escape.ctb'}}).success,false);assert.equal(schemas.export.safeParse({drawing:'test.dwg',format:'png',plot:{paper:'A3'}}).success,false);
});
test('compound delivery does not change write scope, accepts explicit exclusions and rejects duplicate destinations',()=>{
 const base={drawing:'test.dwg',requestId:crypto.randomUUID(),plan:{type:'replace_text',search:'OLD',replacement:'NEW'}};assert.equal(schemas.workflow.safeParse({...base,response:'summary',exclude:{layers:['LEGEND']},delivery:{csv:true,exports:[{name:'preview',format:'png'},{name:'sheet',format:'pdf',plot:{paper:'A3',orientation:'landscape',scale:'fixed',denominator:100}}]}}).success,true);assert.equal(schemas.workflow.safeParse({...base,delivery:{exports:[{name:'P',format:'png'},{name:'p',format:'png'}]}}).success,false);
});
