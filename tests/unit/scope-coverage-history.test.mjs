import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {hashFile} from '../../src/drawings.mjs';
import {verifyScopeHistory} from '../helpers/scope-coverage-history.mjs';

test('mutable current summary never exempts historical native receipts or mismatched identities',async t=>{
 const child=await fs.mkdtemp(path.join(os.tmpdir(),'cad-scope-history-'));
 t.after(()=>fs.rm(child,{recursive:true,force:true}));
 const write=(f,v)=>fs.writeFile(path.join(child,f),JSON.stringify(v));
 await fs.mkdir(path.join(child,'native'));
 await write('native/result.json',{ok:true});await write('model-1.json',{revision:1});
 const state={jobId:'job-design-test',revision:2,status:'designed',inputSHA256:'input',modelSHA256:'model'};
 await write('result.json',{...state,revision:1});
 const experiment={context:{designJobId:state.jobId},oldFiles:await Promise.all(['result.json','native/result.json','model-1.json'].map(async name=>({file:path.join(child,name),sha256:await hashFile(path.join(child,name))})))};
 await write('engineering.json',state);await write('result.json',state);
 const verified=await verifyScopeHistory(experiment,child);assert.equal(verified.immutableFiles,2);assert.equal(verified.mutableSummaries[0].changed,true);
 await write('native/result.json',{ok:false});await assert.rejects(verifyScopeHistory(experiment,child));await write('native/result.json',{ok:true});
 await write('result.json',{...state,jobId:'another-task'});await assert.rejects(verifyScopeHistory(experiment,child));
 await write('result.json',{...state,modelSHA256:'different'});await assert.rejects(verifyScopeHistory(experiment,child));
});
