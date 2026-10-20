import test from 'node:test';
import assert from 'node:assert/strict';
import {boundForTransport} from '../../src/results.mjs';
test('large pending geometry remains truthful and bounded instead of dropping verification',()=>{
 const pending=Array.from({length:20000},(_,i)=>({handle:String(i),reason:'No independent offset postcondition'})),verification={status:'partial',requiredSatisfied:false,levels:{geometry:{status:'partial',pending}},pending:pending.map(p=>({level:'geometry',reason:p.reason}))},result={ok:true,jobRoot:'job-workflow-test',drawingSaved:true,drawingSha256:'a'.repeat(64),outcome:'saved',verification,review:{pendingGeometry:pending},summary:{changed:2,skipped:[]}};
 const bounded=boundForTransport(result,32000);assert.ok(Buffer.byteLength(JSON.stringify(bounded))<=32000);assert.equal(bounded.verification.requiredSatisfied,false);assert.equal(bounded.verification.levels.geometry.pendingCount,20000);assert.equal(bounded.review.pendingGeometryCount,20000);assert.equal(bounded.drawingSaved,true);
});
test('large get-job responses retain the task identity and saved outcome with a bounded nested result',()=>{
 const result={ok:true,jobRoot:'job-project-test',outcome:'partial',items:Array.from({length:10000},()=>({payload:'x'.repeat(100)})),files:[]},record={ok:true,jobId:'job-project-test',task:{action:'project',status:'running',items:result.items},result};const bounded=boundForTransport(record,32000);assert.ok(Buffer.byteLength(JSON.stringify(bounded))<=32000);assert.equal(bounded.jobId,record.jobId);assert.equal(bounded.task.action,'project');assert.equal(bounded.task.itemCount,10000);assert.equal(bounded.result.outcome,'partial');
});
