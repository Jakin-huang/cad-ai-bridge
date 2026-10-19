import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createExecutor} from '../../src/runner.mjs';
import {createConfigLoader} from '../../src/config.mjs';
import {getJob} from '../../src/jobs.mjs';
import {mergeClientConfiguration,verifyPlugin} from '../../src/setup.mjs';
import {hashFile} from '../../src/drawings.mjs';
import {boundForTransport,readResultPage} from '../../src/results.mjs';
import {schemas} from '../../src/contracts.mjs';

async function temporary(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cadbridge-maintenance-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
test('importing bridge requires neither a configured workspace nor CAD',async()=>{const bridge=await import('../../bridge.mjs');assert.equal(typeof bridge.execute,'function');});
test('config discovery cache expires, refreshes and invalidates on config changes',async t=>{
 const dir=await temporary(t),config=path.join(dir,'config.json'),before=process.env.CADBRIDGE_CONFIG;process.env.CADBRIDGE_CONFIG=config;t.after(()=>{if(before===undefined)delete process.env.CADBRIDGE_CONFIG;else process.env.CADBRIDGE_CONFIG=before;});
 await fs.writeFile(config,JSON.stringify({workspace:dir}));let calls=0,clock=0;
 const load=createConfigLoader({ttlMs:10,now:()=>clock,discoverInstallations:async()=>{calls++;return{cads:[{root:dir,verifiedTarget:true,language:'en-US',profiles:[]}],tangent:[],powershell:'pwsh.exe'};}});
 assert.equal((await load()).discoveryCacheHit,false);assert.equal((await load()).discoveryCacheHit,true);assert.equal(calls,1);
 await fs.writeFile(config,JSON.stringify({workspace:dir,language:'zh-CN'}));assert.equal((await load()).language,'zh-CN');assert.equal(calls,2);
 await fs.writeFile(path.join(dir,'acad.exe'),'changed host');await load();assert.equal(calls,3);
 clock=20;await load();assert.equal(calls,4);await load({refresh:true});assert.equal(calls,5);
 await fs.writeFile(config,'invalid');await assert.rejects(load(),/CONFIG_INVALID/);
});
test('client configuration merge preserves unrelated services and exact backup',async t=>{
 const dir=await temporary(t),file=path.join(dir,'客户端 配置.json'),text='{"other":{"setting":1},"mcpServers":{"existing":{"command":"keep"}}}\n';await fs.writeFile(file,text);
 const result=await mergeClientConfiguration(file,{mcpServers:{'cad-ai-bridge':{command:'node'}}});assert.equal(await fs.readFile(result.backup,'utf8'),text);
 const merged=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(merged.other.setting,1);assert.equal(merged.mcpServers.existing.command,'keep');assert.equal(merged.mcpServers['cad-ai-bridge'].command,'node');
 await fs.writeFile(file,'{"mcpServers":[]}');await assert.rejects(mergeClientConfiguration(file,{mcpServers:{}}),/CLIENT_CONFIG_INVALID/);assert.equal(await fs.readFile(file,'utf8'),'{"mcpServers":[]}');
});
test('plugin reuse requires target, version, binary hash and current source hashes',async t=>{
 const dir=await temporary(t);await fs.mkdir(path.join(dir,'plugin/bin'),{recursive:true});await fs.writeFile(path.join(dir,'package.json'),'{"version":"0.2.0"}');await fs.writeFile(path.join(dir,'plugin/Test.cs'),'source');await fs.writeFile(path.join(dir,'plugin/bin/CadAgent.dll'),'binary');
 const build={version:'0.2.0',target:'AutoCAD 2022 x64, CLR4 / .NET Framework 4.8',sha256:await hashFile(path.join(dir,'plugin/bin/CadAgent.dll')),sourceDigests:[{file:'Test.cs',sha256:await hashFile(path.join(dir,'plugin/Test.cs'))}]};await fs.writeFile(path.join(dir,'plugin/bin/build.json'),JSON.stringify(build));assert.equal((await verifyPlugin(dir)).ok,true);
 await fs.writeFile(path.join(dir,'plugin/Test.cs'),'new source');await assert.rejects(verifyPlugin(dir),/PLUGIN_SOURCE_CHANGED/);await fs.writeFile(path.join(dir,'plugin/bin/CadAgent.dll'),'different');await assert.rejects(verifyPlugin(dir),/PLUGIN_DIGEST_MISMATCH/);
});
test('invalid input and configuration failures do not launch CAD',async t=>{
 const dir=await temporary(t);let launches=0;const execute=createExecutor({runs:dir,getSettings:async()=>{throw Error('CONFIG_INVALID: missing config');},launch:async()=>{launches++;}});
 assert.equal((await execute('apply',{})).error.code,'INVALID_ARGUMENT');const result=await execute('inspect',{drawing:'x.dwg'});assert.equal(result.error.stage,'configuration');assert.equal(result.safeToRetry,true);assert.equal(launches,0);
});
test('saved DWG survives a later export failure and is available through recovery',async t=>{
 const dir=await temporary(t);let launches=0;const execute=createExecutor({runs:dir,getSettings:async()=>({workspace:dir,cadRoot:dir,powershell:'fake'}),launch:async(_exe,args)=>{
  launches++;const job=args[args.indexOf('-JobRoot')+1];await fs.writeFile(path.join(job,'output.dwg'),'saved');await fs.writeFile(path.join(job,'response.json'),JSON.stringify({ok:false,mutationCommitted:true,drawingSaved:true,failureStage:'dxf',error:{code:'DXF_EXPORT_FAILED',message:'export failed'}}));return{code:0,stderr:'',stdout:''};
 }});
 const result=await execute('create_test_drawing');assert.equal(result.ok,false);assert.equal(result.outcome,'saved');assert.equal(result.error.stage,'dxf');assert.equal(await fs.readFile(result.drawing,'utf8'),'saved');assert.equal(result.safeToRetry,false);assert.equal(result.dxf,undefined);
 const recovered=await execute('get_job',{jobId:path.basename(result.jobRoot)});assert.equal(recovered.result.drawingSha256,result.drawingSha256);assert.equal(launches,1);
});
test('cleanup error preserves successful plugin response and saved output',async t=>{
 const dir=await temporary(t);const execute=createExecutor({runs:dir,getSettings:async()=>({workspace:dir,cadRoot:dir,powershell:'fake'}),launch:async(_exe,args)=>{const job=args[args.indexOf('-JobRoot')+1];await fs.writeFile(path.join(job,'output.dwg'),'saved');await fs.writeFile(path.join(job,'response.json'),JSON.stringify({ok:true,drawingSaved:true,mutationCommitted:true,snapshot:{revision:1}}));return{code:1,stderr:'TRUST_RESTORE_CONFLICT',stdout:''};}});
 const r=await execute('create_test_drawing');assert.equal(r.ok,false);assert.equal(r.error.code,'HOST_CLEANUP_FAILED');assert.equal(r.outcome,'saved');assert.equal(r.snapshot.revision,1);assert.ok(r.drawing);
});
test('host timeout is retained as unknown state and evidence queries bypass the busy queue',async t=>{
 const dir=await temporary(t);let release,entered;const ready=new Promise(resolve=>{entered=resolve;});
 const execute=createExecutor({runs:dir,getSettings:async()=>({workspace:dir,cadRoot:dir,powershell:'fake'}),launch:async()=>{entered();await new Promise(resolve=>{release=resolve;});return{code:1,stderr:'TIMEOUT_STATE_UNKNOWN',stdout:''};}});
 const pending=execute('create_test_drawing');await ready;const jobId=(await fs.readdir(dir)).find(n=>n.startsWith('job-'));
 const recovery=await execute('get_job',{jobId});assert.equal(recovery.status,'unconfirmed');release();const r=await pending;assert.equal(r.error.code,'TIMEOUT_STATE_UNKNOWN');assert.equal(r.outcome,'unconfirmed');assert.equal(r.safeToRetry,false);assert.equal((await getJob(dir,{jobId})).result.error.code,'TIMEOUT_STATE_UNKNOWN');
});
test('request lookup finds separate DWG branch attempts without executing them',async t=>{
 const dir=await temporary(t),requestId=crypto.randomUUID();for(const jobId of ['job-a','job-b']){await fs.mkdir(path.join(dir,jobId));await fs.writeFile(path.join(dir,jobId,'request.json'),JSON.stringify({requestId}));}
 assert.equal((await getJob(dir,{requestId})).total,2);assert.equal(schemas.get_job.safeParse({jobId:'../escape'}).success,false);assert.equal(schemas.get_job.safeParse({jobId:'job-a',requestId}).success,false);
 const outside=await temporary(t);await fs.writeFile(path.join(outside,'result.json'),'{}');await fs.symlink(outside,path.join(dir,'job-link'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(getJob(dir,{jobId:'job-link'}),/OUTSIDE/);
});
test('managed snapshot pages keep oversized successful results reachable',async t=>{
 const dir=await temporary(t),job=path.join(dir,'job-managed');await fs.mkdir(job);const snapshot={documentId:'d',revision:1,devices:Array.from({length:1000},(_,id)=>({id,text:'x'.repeat(700)})),routes:[{id:'R'}],symbols:[],issues:[]};
 const full={ok:true,jobRoot:job,snapshot};await fs.writeFile(path.join(job,'result.json'),JSON.stringify(full));const bounded=boundForTransport(full);assert.equal(bounded.responseTruncated,true);assert.ok(bounded.details.kinds.includes('managedDevices'));
 const page=await readResultPage(dir,{jobId:'job-managed',kind:'managedDevices',offset:20,limit:2});assert.equal(page.items[0].id,20);assert.equal(page.total,1000);assert.equal((await readResultPage(dir,{jobId:'job-managed',kind:'routes',offset:0,limit:2})).items[0].id,'R');
});
