import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {analyzeCapture,runAnalysis} from '../../src/engineering-analysis.mjs';
import {schemas} from '../../src/contracts.mjs';
import {hashFile} from '../../src/drawings.mjs';
import {readResultPage} from '../../src/results.mjs';
const capture={ok:true,inputSha256:'a'.repeat(64),snapshot:{units:'Meters'},query:{truncated:false,entities:[
 {handle:'A',instancePath:['B1','A'],type:'INSERT',layer:'DEVICE',attributes:{ID:'D1',MODEL:'=formula'}},
 {handle:'A',instancePath:['B2','A'],type:'INSERT',layer:'DEVICE',attributes:{ID:'d1'}},
 {handle:'C',type:'LINE',layer:'WIRE',length:2},
 {handle:'D',type:'LWPOLYLINE',layer:'WIRE',definition_length:3},
 {handle:'E',type:'TEXT',layer:'TEXT',text:'OLD PROJECT',height:.05}
]}};
const request=extra=>schemas.analyze.parse({captureJobId:'job-capture',...extra});
test('quantities preserve occurrence paths and leave missing world lengths partial',()=>{
 const r=analyzeCapture(capture,request({quantities:[{id:'devices',version:'1',filter:{types:['INSERT']},measure:'count'},{id:'wire',version:'2',filter:{layers:['WIRE']},measure:'length',unit:'m',meaning:'procurement_rule',factor:2,wastePercent:10,roundUpTo:1}]}));
 assert.equal(r.quantityResults[0].total,2);assert.deepEqual(r.quantityRows.slice(0,2).map(r=>r.instancePath),[['B1','A'],['B2','A']]);const q=r.quantityResults[1];assert.equal(q.total,null);assert.equal(q.partialSubtotal,5);assert.equal(q.missing,1);assert.equal(r.quantityRows[2].value,4);assert.equal(r.quantityRows[3].status,'unavailable');
});
test('unknown units do not produce physical lengths; explicit exclusions apply before checks',()=>{
 const args=request({exclude:{handles:['A']},checks:[{id:'old',type:'forbidden_text',text:'old'},{id:'height',type:'text_height',minimumMm:10,maximumMm:40}],quantities:[{id:'wire',version:'1',measure:'length',filter:{types:['LINE']}}]});
 const r=analyzeCapture({...capture,snapshot:{units:'Undefined'}},args);assert.equal(r.coverage.excluded,2);assert.equal(r.quantityResults[0].total,null);assert.equal(r.issues.length,1);assert.equal(r.checkResults[1].pending,3);assert.equal(r.coverage.mmPerDrawingUnit,null);
});
test('attribute and literal checks report source identity without claiming engineering compliance',()=>{
 const r=analyzeCapture(capture,request({checks:[{id:'ids',type:'duplicate_attribute',tag:'ID',filter:{types:['INSERT']}},{id:'required',type:'required_attributes',tags:['MODEL'],filter:{types:['INSERT']}},{id:'old',type:'forbidden_text',text:'OLD'},{id:'short',type:'minimum_length',minimum:2100,filter:{types:['LINE']}}]}));
 assert.equal(r.issues.length,5);assert.equal(r.issues.filter(i=>i.ruleId==='ids').length,2);assert.ok(r.issues.every(i=>i.sourceSha256===capture.inputSha256));assert.ok(r.checkResults[0].authority.includes('User-supplied'));
});
test('incomplete captures and invalid rules cannot yield complete totals',()=>{
 assert.throws(()=>analyzeCapture({...capture,query:{...capture.query,truncated:true}},request({quantities:[{id:'x',version:'1',measure:'count'}]})),/CAPTURE_INCOMPLETE/);
 assert.equal(schemas.analyze.safeParse({captureJobId:'job-a',checks:[]}).success,false);assert.equal(schemas.analyze.safeParse({captureJobId:'job-a',quantities:[{id:'x',version:'1',measure:'count',factor:-1}]}).success,false);
});
test('retained analysis binds capture hash, supports pages and guards spreadsheet formulas',async t=>{
 const runs=await fs.mkdtemp(path.join(os.tmpdir(),'cad-analysis-'));t.after(()=>fs.rm(runs,{recursive:true,force:true}));const job=path.join(runs,'job-capture');await fs.mkdir(job);await fs.writeFile(path.join(job,'task.json'),JSON.stringify({action:'scan'}));await fs.writeFile(path.join(job,'result.json'),JSON.stringify(capture));
 const args=request({checks:[{id:'model',type:'duplicate_attribute',tag:'MODEL'}],quantities:[{id:'devices',version:'1',measure:'count'}]});args.expectedResultSha256=await hashFile(path.join(job,'result.json'));
 const r=await runAnalysis(runs,args);assert.equal(r.captureResultSha256,args.expectedResultSha256);assert.equal(r.quantityRows.length,5);const page=await readResultPage(runs,{jobId:path.basename(r.jobRoot),kind:'quantityRows',limit:2});assert.equal(page.total,5);assert.equal(page.items.length,2);assert.equal(page.hasMore,true);
 await fs.appendFile(path.join(job,'result.json'),' ');await assert.rejects(runAnalysis(runs,args),/RESULT_CHANGED/);
});
