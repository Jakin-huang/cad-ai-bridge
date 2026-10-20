import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateBenchmark} from '../../src/benchmarks.mjs';
const sha='a'.repeat(64),suite={schemaVersion:1,id:'fixed',version:'1',frozenAt:'2026-10-20T00:00:00Z',repetitions:1,environment:{id:'machine',hardware:'fixed',os:'Windows',cad:'2022',client:'fixed',model:'fixed',promptSha256:sha,budget:'fixed'},tasks:[{id:'text',family:'editing',inputSha256:sha,requiredChecks:['saved','correct']},{id:'plot',family:'delivery',inputSha256:sha,requiredChecks:['opened']}],participants:[{id:'bridge',revision:'commit-a',source:'local',environmentId:'machine',lane:'mcp',supportedTaskIds:['text','plot']},{id:'reference',revision:'commit-b',source:'upstream',environmentId:'machine',lane:'mcp',supportedTaskIds:['text']}]};
const attempt=(participantId,taskId,status='success')=>({participantId,taskId,repetition:1,status,elapsedMs:100,manualInterventions:0,inputSha256:sha,checks:['saved','correct','opened'].map(id=>({id,passed:true,oracle:'independent-file',evidence:'oracle.json'})),artifacts:[{file:'record.json',sha256:sha}]});
test('fixed denominator retains timeouts, refusals, unsupported and unexecuted cases',()=>{
 const r=evaluateBenchmark(suite,[attempt('bridge','text'),attempt('bridge','plot','timeout')]);assert.equal(r.participants[0].declaredSupport.firstAttemptSuccessRate,.5);assert.equal(r.participants[0].declaredSupport.failures.timeout,1);assert.equal(r.participants[1].declaredSupport.missingAttempts,1);assert.equal(r.participants[1].coverage,.5);assert.equal(r.comparable,false);assert.equal(r.competitiveSuperiority,'not_established');
});
test('host success with missing oracle checks fails; duplicate attempts cannot replace first failures',()=>{
 const a=attempt('bridge','text');a.checks=a.checks.filter(c=>c.id!=='correct');const r=evaluateBenchmark(suite,[a,attempt('reference','text')]);assert.equal(r.participants[0].commonSupport.successes,0);assert.equal(r.rows[0].status,'oracle_failed');assert.equal(r.comparable,true);assert.throws(()=>evaluateBenchmark(suite,[a,a]),/DUPLICATE_ATTEMPT/);
});
test('different lanes are not pooled into a misleading comparison and source identities must match',()=>{
 const s=structuredClone(suite);s.participants[1].lane='desktop';assert.equal(evaluateBenchmark(s,[attempt('bridge','text'),attempt('reference','text')]).comparable,false);assert.throws(()=>evaluateBenchmark(suite,[{...attempt('bridge','text'),inputSha256:'b'.repeat(64)}]),/INPUT_MISMATCH/);
});
