import {projectPath,parseLocalJSON,resolveLocalPath} from '../src/local-paths.mjs';
// Read-only acceptance of an explicitly supplied desktop task; never launches CAD or changes client settings.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {projectRoot as root} from '../src/config.mjs';
import {hashFile} from '../src/drawings.mjs';
import {readDxf,tag,curveLength,xdata,field} from '../src/dxf-audit.mjs';
const [sessionFile,desktopLog]=process.argv.slice(2);
if(!sessionFile||!desktopLog)throw Error('Supply the exact desktop session JSONL and main-thread log');
const rows=(await fs.readFile(sessionFile,'utf8')).trim().split('\n').map(line=>parseLocalJSON(line));
const calls=rows.filter(r=>r.type==='function_call'),checks=[];
const args=call=>typeof call.arguments==='string'?parseLocalJSON(call.arguments):call.arguments;
function output(reply){const block=Array.isArray(reply.output)?reply.output[0]:reply.output;return parseLocalJSON(block.text);}
assert.ok(calls.some(c=>c.name==='Skill'&&JSON.stringify(args(c)).includes('cadbridge-electrical')));
checks.push('Actual desktop task invokes the global electrical Skill');
const executions=calls.filter(c=>c.name==='DeferExecuteTool').map(c=>({call:c,...args(c)}));
const results={};
for(const execution of executions.filter(e=>/cad-ai-bridge/.test(e.toolName))){
 const reply=rows.find(r=>r.type==='function_call_result'&&r.callId===execution.call.callId);
 assert.equal(reply?.status,'completed');const result=output(reply);assert.equal(result.ok,true,JSON.stringify(result.error));
 results[execution.toolName.split('__').at(-1)]={result,params:execution.params};
}
for(const name of ['cad_doctor','cad_create_test_drawing','electrical_apply','electrical_validate'])assert.ok(results[name],name);
const fixture=results.cad_create_test_drawing.result,applied=results.electrical_apply.result;
const takeoff=results.electrical_takeoff||results.tangent_takeoff;assert.ok(takeoff);
checks.push('Desktop diagnostic, drawing creation, write, takeoff and validation succeed');
const desktop=await fs.readFile(desktopLog,'utf8');assert.match(desktop,/Connected to custom-mcp:cad-ai-bridge, 15 tools/);
for(const entry of [results.cad_create_test_drawing,results.electrical_apply,takeoff,results.electrical_validate]){
 const result=entry.result;
 const folder=await fs.realpath(result.jobRoot),relative=path.relative(projectPath('runs'),folder);
 assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Job must remain inside bridge runs');
 const task=parseLocalJSON(await fs.readFile(path.join(folder,'task.json'),'utf8'));assert.equal(task.status,'completed');
 const stored=parseLocalJSON(await fs.readFile(path.join(folder,'result.json'),'utf8'));assert.equal(stored.ok,true);
 // Tangent summaries intentionally retain only snapshot identity; full evidence stays in the job.
 for(const key of ['documentId','revision','units'])assert.equal(stored.snapshot[key],result.snapshot[key]);
 for(const key of ['devices','routes','issues'])if(Array.isArray(result.snapshot[key]))assert.deepEqual(stored.snapshot[key],result.snapshot[key]);
 entry.persisted=stored;
 assert.ok(task.ownerPid>0);
}
// The client truncates logged response bodies; read-only job IDs may be absent there.
for(const name of ['cad_doctor','cad_create_test_drawing','electrical_apply',takeoff===results.electrical_takeoff?'electrical_takeoff':'tangent_takeoff','electrical_validate'])assert.ok(desktop.includes('originalToolName='+name),'Missing desktop proxy route: '+name);
for(const result of [fixture,applied])assert.ok(desktop.includes(path.basename(result.jobRoot)),'Desktop follow-up calls must reference the actual saved branch');
checks.push('Desktop proxy records correlate with completed bridge jobs');
const writes=executions.filter(e=>e.toolName.endsWith('__electrical_apply'));assert.equal(writes.length,1);assert.equal(writes[0].params.operations.length,3);
assert.equal(writes[0].params.drawing,fixture.drawing);assert.equal(writes[0].params.expectedSha256,fixture.drawingSha256);
for(const result of [applied,takeoff.persisted,results.electrical_validate.result]){
 const snapshot=result.snapshot;assert.equal(snapshot.devices.length,2);assert.equal(snapshot.routes.length,1);assert.equal(snapshot.routeLengthMm,3000);
 assert.deepEqual(snapshot.devices.map(d=>d.attributes.DEVICE_ID).sort(),['L-001','L-002']);assert.deepEqual(snapshot.issues,[]);
}
assert.equal(takeoff.result.tangent.deviceCount,2);assert.equal(takeoff.result.tangent.statistics.lengthMm,3000);
assert.equal(takeoff.params.drawing,applied.drawing);assert.equal(results.electrical_validate.params.drawing,applied.drawing);
checks.push('One atomic placement/route/numbering call and fresh saved-DWG readback agree');
assert.equal(await hashFile(fixture.drawing),fixture.drawingSha256);assert.equal(await hashFile(applied.drawing),applied.drawingSha256);
assert.ok((await fs.stat(applied.dxf)).size>0);checks.push('New DWG/DXF exist, saved digest matches, and original fixture is unchanged');
const dxf=await readDxf(applied.dxf),devices=dxf.roots.filter(e=>e.type==='INSERT'&&tag(e,2)==='EA_LIGHT');
assert.equal(devices.length,2);assert.deepEqual(devices.map(d=>dxf.attributes.get(d.handle).DEVICE_ID).sort(),['L-001','L-002']);
assert.deepEqual(devices.map(d=>[Number(tag(d,10)),Number(tag(d,20)),Number(tag(d,30,0))]).sort((a,b)=>a[0]-b[0]),[[0,0,0],[3000,0,0]]);
const routes=dxf.roots.filter(e=>e.type==='LWPOLYLINE'&&field(xdata(e),'linenum')==='WL1');assert.equal(routes.length,1);assert.ok(Math.abs(curveLength(routes[0])-3000)<1e-6);
checks.push('Independent DXF parser confirms two lights, positions, numbering and WL1 length');
const presentation=calls.findLast(c=>c.name==='present_files');assert.ok(presentation);
const presented=output(rows.find(r=>r.type==='function_call_result'&&r.callId===presentation.callId));
assert.equal(presented.type,'present_files_result');assert.ok(presented.files.includes(applied.drawing));assert.ok(presented.files.includes(applied.dxf));
checks.push('Desktop present_files succeeds for the actual DWG and DXF');
const sessionId=rows.find(r=>r.sessionId)?.sessionId;
let review;try{review=parseLocalJSON(await fs.readFile(projectPath('artifacts/workbuddy-desktop-user-review.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(review?.sessionId!==sessionId||review?.drawingSha256!==applied.drawingSha256)review=undefined;
const manualChecks=[];
if(review?.filesVisible===true)manualChecks.push('User confirms actual desktop file cards are visible');
if(review?.manualDwgOpen===true)manualChecks.push('User confirms the delivered DWG can be opened manually in local CAD');
const report={ok:true,acceptanceComplete:manualChecks.length===2,checkedAt:new Date().toISOString(),scope:'User-assisted desktop task, verified from its session, desktop proxy log, saved files, independent DXF and separately recorded user observations',checks,manualChecks,sessionId,drawing:applied.drawing,dxf:applied.dxf,drawingSha256:applied.drawingSha256,statistics:{deviceCount:2,routeCount:1,routeLengthMm:3000,numbers:['L-001','L-002']},jobIds:[fixture,applied,takeoff.result,results.electrical_validate.result].map(r=>path.basename(r.jobRoot)),presentation:{files:presented.files,previewed:presented.previewed||[],userOpenVerified:review?.manualDwgOpen===true,cardDirectOpenVerified:review?.cardDirectOpenVerified??null,embeddedCadPreviewVerified:review?.embeddedCadPreviewVerified===true}};
await fs.writeFile(projectPath('artifacts/workbuddy-desktop-task-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({ok:true,checks,drawing:applied.drawing,previewed:report.presentation.previewed}));
