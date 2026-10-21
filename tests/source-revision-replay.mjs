// Audits already completed synthetic source revisions; never starts AI or CAD.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {projectPath,dataHome} from '../src/local-paths.mjs';
import {hashFile} from '../src/drawings.mjs';
import {parseTrace,normalizeClientEvents,unwrapDeferredCalls} from './helpers/client-trace.mjs';
const [reportFile,failedTrial,successfulTrial,outputFile]=process.argv.slice(2);
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const report=await read(reportFile);
const oldRequest=await read(path.join(failedTrial,'replace-request.json'));
assert.equal(report.developmentCase,true);assert.equal(report.heldOutProject,false);
assert.ok(report.scope.includes('非客户'));assert.equal(report.sourceVersionTest,true);
const events=unwrapDeferredCalls(normalizeClientEvents(parseTrace(await fs.readFile(path.join(successfulTrial,'events.ndjson'),'utf8'))));
const args=e=>typeof e.arguments==='string'?JSON.parse(e.arguments):e.arguments;
const reconcile=events.find(e=>e.type==='function_call'&&e.name?.endsWith('cad_design_project')&&args(e).action==='reconcile_brief');
assert.ok(reconcile);
const client=new Client({name:'source-version-replay-audit',version:'1.0.0'});
const call=async q=>{const response=await client.callTool({name:'cad_design_project',arguments:q});if(response.isError)throw Error(response.content[0].text);return JSON.parse(response.content[0].text);};
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[projectPath('mcp-server.mjs')],env:{...process.env,CADAGENT_ALLOWED_ROOT:dataHome()},stderr:'pipe'}));
 const before=await call({action:'status',jobId:report.jobId});
 assert.equal(before.status,'delivered');assert.equal(before.revision,report.deliveredRevision);assert.equal(before.modelSHA256,report.modelSHA256);
 await assert.rejects(()=>call(oldRequest),/BRIEF_CHANGE_REPLAY_SUPERSEDED/);
 const replay=await call(args(reconcile));assert.equal(replay.replayed,true);assert.equal(replay.status,'delivered');assert.equal(replay.revision,before.revision);assert.equal(replay.modelSHA256,before.modelSHA256);
 for(const f of [...report.delivery.files,...report.oldDelivery.files])assert.equal(await hashFile(f.file),f.sha256);
 let denied=0;const reads=[];
 for(const event of events.filter(e=>e.type==='function_call'&&e.name==='Read')){
  const file=path.resolve(successfulTrial,args(event).file_path),relative=path.relative(path.resolve(successfulTrial),file).replaceAll('\\','/').toLowerCase();
  const allowed=['brief-v2.txt','project-context.json'].includes(relative)||relative.startsWith('.codebuddy/skills/');
  const result=events.find(e=>e.type==='function_call_result'&&e.callId===event.callId);assert.ok(result);
  if(!allowed){assert.equal(result.status,'failed','Unauthorized read must be denied');denied++;}
  reads.push({relative,allowed,status:result.status});
 }
 const proof={ok:true,checkedAt:new Date().toISOString(),oldSourceRequestRejected:true,latestReconcileReplayedWithoutRevertingCurrentDelivery:true,revision:replay.revision,modelSHA256:replay.modelSHA256,oldAndNewNativeFilesUnchanged:true,unauthorizedReadDeniedAttempts:denied,reads,professionalApproval:false};
 await fs.writeFile(outputFile,JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
}finally{await client.close();}
