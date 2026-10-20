// Paired current-machine measurement, not an external productivity benchmark.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execute} from '../bridge.mjs';
import {hashFile} from '../src/drawings.mjs';
import {localPath,projectPath} from '../src/local-paths.mjs';
const evidence=JSON.parse(await fs.readFile(localPath('artifacts','v2-integration-report.json'),'utf8')),drawing=evidence.results.block.drawing,inputSha256=await hashFile(drawing),records=[];
const items=[{name:'a4',format:'pdf',plot:{paper:'A4',orientation:'portrait'}},{name:'a3',format:'pdf',plot:{paper:'A3',orientation:'landscape'}},{name:'preview',format:'png'}];
for(const mode of ['single','batch','batch','single']){
 const started=performance.now(),results=[];
 if(mode==='single')for(const {name,...item}of items)results.push(await execute('export',{drawing,...item}));else results.push(await execute('export_many',{drawing,items}));
 assert.ok(results.every(r=>r.ok),JSON.stringify(results.map(r=>r.error)));const exports=mode==='single'?results.map(r=>r.exported):results[0].exports.map(r=>r.exported);assert.equal(exports.length,3);assert.ok(exports.every(e=>e.verification.ok&&e.bytes>100));
 const record={mode,elapsedMs:Math.round(performance.now()-started),hostLaunches:results.reduce((n,r)=>n+r.metrics.hostLaunches,0),outputs:exports.map(e=>({format:e.format,sha256:e.sha256,verification:e.verification})),jobs:results.map(r=>r.jobRoot)};assert.equal(record.hostLaunches,mode==='single'?3:1);records.push(record);console.log(JSON.stringify({mode,elapsedMs:record.elapsedMs,hostLaunches:record.hostLaunches}));
}
assert.equal(await hashFile(drawing),inputSha256);const report={ok:true,checkedAt:new Date().toISOString(),pluginSHA256:JSON.parse(await fs.readFile(projectPath('plugin/bin/build.json'),'utf8')).sha256,inputSha256,records,checks:['Same input, paper requests and output checks in all four measurements','Paired order single/batch/batch/single; 3 vs 1 CAD host launches','Source SHA-256 unchanged'],scope:'Two observations per mode on the existing Windows/AutoCAD 2022 account. Native export execution only; no AI latency, human verification, external users or competitive superiority conclusion.'};await fs.writeFile(localPath('artifacts','batch-export-performance-report.json'),JSON.stringify(report,null,2));
