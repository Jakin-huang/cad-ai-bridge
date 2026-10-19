import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createExecutor,launchHost} from '../src/runner.mjs';
import {root,execute} from '../bridge.mjs';
const checks=[],results={};
for(const [name,block,code,outcome]of [['dxf','output.dxf','DXF_EXPORT_FAILED','saved'],['save','output.dwg','DWG_SAVE_FAILED','modified_not_saved']]){
 const injected=createExecutor({launch:async(exe,args)=>{const job=args[args.indexOf('-JobRoot')+1];await fs.mkdir(path.join(job,block));return launchHost(exe,args);}});
 const result=results[name]=await injected('create_test_drawing');assert.equal(result.ok,false);assert.equal(result.error.code,code);assert.equal(result.outcome,outcome);assert.equal(result.safeToRetry,false);
 if(name==='dxf'){assert.ok(result.drawing);assert.equal(result.dxf,undefined);const fresh=await execute('inspect',{drawing:result.drawing});assert.equal(fresh.ok,true);assert.ok(fresh.snapshot.symbols.some(s=>s.name==='EA_LIGHT'));assert.equal(result.drawingSaved,true);}
 checks.push(name+': real host reports the correct failure phase and output state');console.log('PASS '+checks.at(-1));
 const recovery=await execute('get_job',{jobId:path.basename(result.jobRoot)});assert.equal(recovery.result.error.code,code);
}
const timeout=createExecutor({launch:(exe,args)=>launchHost(exe,[...args,'-TimeoutSeconds','1'])});
const timed=results.timeout=await timeout('create_test_drawing');assert.equal(timed.ok,false);assert.equal(timed.error.code,'TIMEOUT_STATE_UNKNOWN');assert.equal(timed.outcome,'unconfirmed');
const metadata=JSON.parse((await fs.readFile(path.join(timed.jobRoot,'process.json'),'utf8')).replace(/^\uFEFF/,''));let alive=true;try{process.kill(metadata.pid,0);}catch{alive=false;}assert.equal(alive,false);checks.push('Timed-out owned CAD process exits and its unknown outcome remains queryable');console.log('PASS '+checks.at(-1));
const next=await execute('create_test_drawing');assert.equal(next.ok,true);checks.push('Next CAD job succeeds after timeout and configuration restoration');console.log('PASS '+checks.at(-1));
await fs.writeFile(path.join(root,'artifacts/maintenance-host-faults-report.json'),JSON.stringify({ok:true,checkedAt:new Date().toISOString(),checks,results},null,2));
