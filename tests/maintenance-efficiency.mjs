import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execute,root,hashFile} from '../bridge.mjs';
import {loadConfig} from '../src/config.mjs';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
const checks=[],configMs=[];
for(let i=0;i<3;i++){const t=performance.now();await loadConfig();configMs.push(Math.round(performance.now()-t));}
const client=new Client({name:'maintenance-after',version:'0.2.0'}),transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp-server.mjs')],stderr:'pipe'});
const started=performance.now();let startupMs;try{await client.connect(transport);await client.listTools();startupMs=Math.round(performance.now()-started);}finally{await client.close();}
const fixture=await execute('create_test_drawing');assert.equal(fixture.ok,true);const originalHash=await hashFile(fixture.drawing);
const operations=[{type:'place_symbols',blockName:'EA_LIGHT',instances:[{id:'A',position:[0,0,0]},{id:'B',position:[3000,0,0]}]},{type:'connect_route',id:'R',circuitId:'WL1',from:{id:'A',port:'PWR'},to:{id:'B',port:'PWR'},vertices:[[0,0,0],[3000,0,0]]},{type:'number_devices',ids:['A','B'],prefix:'L-',start:1,width:3}];
const apply=(current,ops)=>execute('apply',{drawing:current.drawing,expectedSha256:current.drawingSha256,documentId:current.snapshot.documentId,expectedRevision:current.snapshot.revision,requestId:crypto.randomUUID(),units:'mm',operations:ops});
let t=performance.now();const batch=await apply(fixture,operations),batchMs=Math.round(performance.now()-t);assert.equal(batch.ok,true);
let split=fixture;const splitResults=[];t=performance.now();for(const op of operations){split=await apply(split,[op]);assert.equal(split.ok,true);splitResults.push(split);}const splitMs=Math.round(performance.now()-t);
const project=s=>({devices:s.devices.map(d=>({id:d.id,position:d.position,attributes:d.attributes})),routes:s.routes.map(r=>({id:r.id,circuitId:r.circuitId,from:r.from,to:r.to,lengthMm:r.lengthMm,vertices:r.vertices})),issues:s.issues});
const reopenedBatch=await execute('inspect',{drawing:batch.drawing}),reopenedSplit=await execute('inspect',{drawing:split.drawing});assert.equal(reopenedBatch.ok,true);assert.equal(reopenedSplit.ok,true);assert.deepEqual(project(reopenedBatch.snapshot),project(reopenedSplit.snapshot));checks.push('One atomic batch and three separate operations persist identical devices, routes and numbering');
assert.equal(await hashFile(fixture.drawing),originalHash);checks.push('Both workflows preserve their original drawing');
const before=(await fs.readdir(path.join(root,'runs'))).length;
const recovery=await execute('get_job',{jobId:path.basename(batch.jobRoot)}),page=await execute('read_result',{jobId:path.basename(batch.jobRoot),kind:'managedDevices',limit:1});assert.equal(recovery.result.drawingSha256,batch.drawingSha256);assert.equal(page.items.length,1);assert.equal((await fs.readdir(path.join(root,'runs'))).length,before);checks.push('Recovery and managed pagination reuse results without launching CAD');
const launchCount={batch:batch.metrics.hostLaunches,separate:splitResults.reduce((n,r)=>n+r.metrics.hostLaunches,0)};assert.deepEqual(launchCount,{batch:1,separate:3});checks.push('Batching reduces host starts from three to one for the same task');
const report={ok:true,checkedAt:new Date().toISOString(),checks,configMs,mcpStartupMs:startupMs,batchMs,separateMs:splitMs,launchCount,batchPhases:batch.metrics,separatePhases:splitResults.map(r=>r.metrics),results:{fixture,batch,split,reopenedBatch,reopenedSplit}};
await fs.writeFile(path.join(root,'artifacts/maintenance-efficiency-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,results:undefined,separatePhases:undefined}));
