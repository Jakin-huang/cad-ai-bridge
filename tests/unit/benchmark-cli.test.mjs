import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {hashFile} from '../../src/drawings.mjs';
test('benchmark CLI verifies retained bytes and refuses altered evidence before producing a report',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cad-benchmark-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const artifact=path.join(root,'oracle.json');await fs.writeFile(artifact,JSON.stringify({checked:true}));const sha=await hashFile(artifact),suite={schemaVersion:1,id:'cli',version:'1',frozenAt:'2026-10-20T00:00:00Z',repetitions:1,environment:{id:'test',hardware:'test',os:'test',cad:'test',client:'test',model:'test',promptSha256:sha,budget:'test'},tasks:[{id:'task',family:'test',inputSha256:sha,requiredChecks:['correct']}],participants:[{id:'test',revision:'unit',source:'unit',environmentId:'test',lane:'executor',supportedTaskIds:['task']}]},attempts=[{participantId:'test',taskId:'task',repetition:1,status:'success',elapsedMs:1,manualInterventions:0,inputSha256:sha,checks:[{id:'correct',passed:true,oracle:'independent-file',evidence:'oracle.json'}],artifacts:[{file:'oracle.json',sha256:sha}]}];
 const s=path.join(root,'suite.json'),a=path.join(root,'attempts.json'),report=path.join(root,'report.json');await fs.writeFile(s,JSON.stringify(suite));await fs.writeFile(a,JSON.stringify(attempts));const run=()=>spawnSync(process.execPath,['scripts/evaluate-benchmark.mjs',s,a,report],{encoding:'utf8',windowsHide:true});assert.equal(run().status,0);const result=JSON.parse(await fs.readFile(report,'utf8'));assert.equal(result.artifactsVerified,true);assert.equal(result.comparable,false);assert.equal(result.competitiveSuperiority,'not_established');await fs.writeFile(artifact,'changed');const failed=run();assert.notEqual(failed.status,0);assert.ok(failed.stderr.includes('BENCHMARK_ARTIFACT_CHANGED'));
});
