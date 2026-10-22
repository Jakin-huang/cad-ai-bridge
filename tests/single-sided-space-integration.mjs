// Controlled developer case. Real native output; no actual AI or customer acceptance.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {singleSidedSpaceInput} from './helpers/single-sided-space-input.mjs';
import {solveSpacePlan} from '../src/space-planning-solver.mjs';
import {auditSpacePlan} from '../src/space-planning-audit.mjs';
import {dataHome,outsideProject,projectPath} from '../src/local-paths.mjs';
import {publicFiles} from '../scripts/public-files.mjs';
import {hashFile} from '../src/drawings.mjs';
const folder=outsideProject(path.resolve(process.argv[2]??''));assert.ok(process.argv[2]);await fs.mkdir(folder);
const read=async f=>JSON.parse(await fs.readFile(f,'utf8')),write=(f,v)=>fs.writeFile(path.join(folder,f),JSON.stringify(v,null,2)+'\n');
const client=new Client({name:'single-sided-native-acceptance',version:'1'}),report={ok:false,actualAiClient:false,independentCustomerAcceptance:false,professionalApproval:false};
const call=async args=>{await fs.appendFile(path.join(folder,'calls.ndjson'),JSON.stringify({args})+'\n');const reply=await client.callTool({name:'cad_engineering_task',arguments:args},{timeout:600000});const r=JSON.parse(reply.content.find(c=>c.type==='text').text);await fs.appendFile(path.join(folder,'calls.ndjson'),JSON.stringify({result:r})+'\n');assert.equal(r.ok,true,JSON.stringify(r));return r;};
try{
 const manifest=[];for(const file of await publicFiles()){const to=path.join(folder,'source',file);await fs.mkdir(path.dirname(to),{recursive:true});await fs.copyFile(projectPath(file),to,fs.constants.COPYFILE_EXCL);manifest.push({file,sha256:await hashFile(to)});}await write('source-manifest.json',manifest);
 const input=singleSidedSpaceInput(),budget={maxNodes:20000,maxMilliseconds:10000,maxPlans:3};await write('input.json',input);
 const old=await solveSpacePlan(input,budget);await write('two-sided-study.json',old);assert.equal(old.plans.length,0);assert.equal(old.status,'bounded_family_exhausted');report.originalFamily=old.status;
 await client.connect(new StdioClientTransport({command:process.execPath,args:[projectPath('mcp-server.mjs')],env:{...process.env,CADAGENT_ALLOWED_ROOT:dataHome()},stderr:'pipe'}));
 const task=await call({action:'prepare',requestId:crypto.randomUUID(),project:{id:crypto.randomUUID(),name:input.title,type:'synthetic-development'},task:{kind:'office-space-planning',title:input.title,objective:'Design a narrow office suite against unchanged source conditions and independently inspect its native output'},parameters:{input}});
 const binding={jobId:task.jobId,expectedProjectId:task.project.id,expectedTaskSHA256:task.taskSHA256},invoke=(operation,parameters)=>({action:'invoke',...binding,requestId:crypto.randomUUID(),operation,parameters});report.task=binding;await write('report.json',report);
 const designed=await call(invoke('design',{expectedRevision:0,expectedInputSHA256:task.current.inputSHA256,budget:{...budget,corridorMode:'allow_single_sided'}}));report.designed=designed.current;await write('report.json',report);
 const dir=path.join(dataHome(),'runs',designed.current.jobId),model=await read(path.join(dir,'model-0.json'));assert.deepEqual(model.input,input);assert.equal(model.plan.method,'bounded_single_sided_corridor_bays');assert.equal(auditSpacePlan(input,model.plan).ok,true);
 const delivered=await call(invoke('deliver',{expectedModelSHA256:designed.current.modelSHA256}));assert.equal(delivered.current.delivery.verification.ok,true);report.delivered=delivered.current;await write('report.json',report);
 const reviewed=await call(invoke('review_pdfs',{expectedModelSHA256:designed.current.modelSHA256,expectedSourceSHA256:delivered.current.pdfReviewSourceSHA256}));report.reviewed=reviewed.current;await write('report.json',report);
 const state=await read(path.join(dir,'space-planning.json'));report.nativeSteps=state.nativeSteps;report.modelPath=path.join(dir,'model-0.json');report.files=reviewed.current.files;
 for(const f of report.files)assert.equal(await hashFile(f.file),f.sha256);
 await client.close();await client.connect(new StdioClientTransport({command:process.execPath,args:[projectPath('mcp-server.mjs')],env:{...process.env,CADBRIDGE_READ_ONLY:'1',CADAGENT_ALLOWED_ROOT:dataHome()},stderr:'pipe'}));const again=await call({action:'status',...binding});assert.equal(again.current.modelSHA256,designed.current.modelSHA256);assert.equal(again.current.reviewStatus,'awaiting_human_review');
 report.ok=true;report.inputUnchanged=true;report.sourceDeclaredOnly=true;report.rooms=model.plan.rooms.length;report.seats=model.plan.rooms.reduce((n,r)=>n+r.furniture.seats.length,0);report.audit=model.audit;report.metrics={roomAreaM2:model.plan.rooms.reduce((n,r)=>n+(r.rect.max[0]-r.rect.min[0])*(r.rect.max[1]-r.rect.min[1])/1e6,0),corridorAreaM2:28,unassignedM2:model.plan.unassignedM2};report.visualReviewPending=true;report.fullEngineeringAcceptance=false;await write('report.json',report);console.log(JSON.stringify({ok:true,rooms:report.rooms,seats:report.seats,metrics:report.metrics,modelSHA256:designed.current.modelSHA256}));
}catch(e){report.error=e.stack;await write('report.json',report);throw e;}finally{await client.close().catch(()=>{});}
