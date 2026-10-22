// Actual MCP transport; interpretations are test-supplied, not an AI trial.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {conditionsIntakeFixture} from './helpers/conditions-intake.mjs';
import {outsideProject} from '../src/local-paths.mjs';
const root=outsideProject(path.resolve(process.argv[2]??''));assert.ok(process.argv[2],'Supply a new private evidence directory');await fs.mkdir(root);
const report={ok:false,newAiClient:false,newNativeCad:false,semanticAcceptance:false,professionalApproval:false,cases:[]},uuid=()=>crypto.randomUUID();
for(const kind of ['ordinary-lighting','office-space-planning']){
 const folder=path.join(root,kind);await fs.mkdir(folder);const data=path.join(folder,'data'),runs=path.join(data,'runs');
 const client=new Client({name:'conditions-intake-protocol',version:'1.0.0'});
 const connect=readOnly=>client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('mcp-server.mjs')],env:{...process.env,CADBRIDGE_DATA_HOME:data,CADAGENT_ALLOWED_ROOT:folder,CADBRIDGE_READ_ONLY:readOnly?'1':'0'},stderr:'pipe'}));
 let calls=0;
 const execute=async(action,args)=>{calls++;await fs.appendFile(path.join(folder,'calls.ndjson'),JSON.stringify({action,args})+'\n');const response=await client.callTool({name:'cad_'+action,arguments:args},{timeout:180000}),result=JSON.parse(response.content.find(c=>c.type==='text').text);await fs.appendFile(path.join(folder,'calls.ndjson'),JSON.stringify({action,result})+'\n');return result;};
 try{
  await connect(false);
  const capabilities=await execute('engineering_intake',{action:'capabilities',kind,section:'conditions'});assert.ok(capabilities.ok);assert.equal(capabilities.profiles[0].baselineSchema.properties.intakeMode.const,'conditions_only');
  const f=await conditionsIntakeFixture(kind,{root:folder,runs,execute}),draft=await f.draft(await f.cover(f.parameters));assert.equal(draft.ready,true);
  const adoption=await f.commit(draft);assert.ok(adoption.ok&&adoption.committed);const t=adoption.task,bound={jobId:t.jobId,expectedProjectId:t.project.id,expectedTaskSHA256:t.taskSHA256};
  const design=await execute('engineering_task',{action:'invoke',...bound,requestId:uuid(),operation:'design',parameters:{expectedRevision:0,expectedInputSHA256:draft.inputSHA256,...(kind==='office-space-planning'?{budget:{maxNodes:50000,maxMilliseconds:10000,maxPlans:1}}:{})}});assert.ok(design.ok);assert.equal(design.current.status,'designed');assert.equal(design.current.documentEvidence.sourceCoverage.complete,true);
  const modelSHA256=design.current.modelSHA256;assert.ok(modelSHA256);
  await client.close();await connect(true);
  const fresh=await execute('engineering_task',{action:'status',...bound});assert.ok(fresh.ok);assert.equal(fresh.current.modelSHA256,modelSHA256);assert.equal(fresh.current.documentEvidence.eligible,true);
  const intake=await execute('engineering_intake',{action:'status',baseline:f.frozen.baseline});assert.ok(intake.ok);assert.equal(intake.commit.status,'complete');assert.equal(intake.commit.task.jobId,t.jobId);
  const ids=await fs.readdir(runs);assert.ok(ids.filter(s=>s.startsWith('job-')).every(s=>/^job-(docset|docpolicy|intake|intakedraft|task|design|spaceplan|docreview)-/.test(s)),'No native CAD job expected');
  report.cases.push({kind,calls,baseline:f.frozen.baseline,task:bound,inputSHA256:draft.inputSHA256,modelSHA256,sourceCoverageComplete:true,freshReadOnlyVerified:true,designStatus:design.current.status});
 }catch(e){report.error=e.stack;throw e;}finally{await client.close().catch(()=>{});await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2)+'\n');}
}
report.ok=true;await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
