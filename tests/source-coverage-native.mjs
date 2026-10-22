// Continue a successful real-client source review into CAD, without repairing
// its interpreted requirements or changing any source/model values.
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/client';import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {outsideProject,projectPath} from '../src/local-paths.mjs';import {hashFile} from '../src/drawings.mjs';import {engineeringDigest} from '../src/engineering-design.mjs';import {auditEngineeringDesign} from '../src/engineering-verification.mjs';
const [clientFolder,target]=process.argv.slice(2),root=outsideProject(path.resolve(target)),read=async f=>JSON.parse(await fs.readFile(f,'utf8')),prior=await read(path.join(clientFolder,'client-report.json')),experiment=await read(path.join(clientFolder,'experiment.json'));
assert.ok(prior.ok&&prior.wholeClientTrialPassed&&prior.finalEngineeringStatePassed);await fs.mkdir(root);
const report={ok:false,newAiClient:false,actualAiClientInput:true,professionalApproval:false,calls:[],protectedFiles:[...experiment.protectedFiles]},save=()=>fs.writeFile(root+'/native-report.json',JSON.stringify(report,null,2)+'\n');
const c=new Client({name:'source-coverage-native',version:'1'});
async function call(q){report.calls.push(q);await save();const raw=await c.callTool({name:'cad_engineering_task',arguments:q},{timeout:1800000}),r=JSON.parse(raw.content.find(x=>x.type==='text').text);await fs.appendFile(root+'/calls.ndjson',JSON.stringify({q,result:r})+'\n');assert.ok(r.ok,JSON.stringify(r));return r;}
try{
 await c.connect(new StdioClientTransport({command:process.execPath,args:[projectPath('mcp-server.mjs')],env:{...process.env,CADBRIDGE_DATA_HOME:path.join(clientFolder,'data'),CADAGENT_ALLOWED_ROOT:path.join(clientFolder,'workspace'),CADBRIDGE_READ_ONLY:'0'},stderr:'pipe'}));
 const status=await call({action:'status',...prior.task});assert.equal(status.current.modelSHA256,prior.modelSHA256);assert.equal(status.current.documentEvidence.sourceCoverage.complete,true);
 report.modelPath=path.join(clientFolder,'data','runs',status.current.jobId,'model-'+status.current.revision+'.json');const model=await read(report.modelPath);assert.equal(engineeringDigest(model),prior.modelSHA256);assert.ok(auditEngineeringDesign(model).ok);report.protectedFiles.push({file:report.modelPath,sha256:await hashFile(report.modelPath)});
 report.design={rooms:model.input.rooms.length,lights:model.devices.length,circuits:model.circuits.length,sheets:model.sheets.length,sourceCoverage:model.sourceDocuments.sourceCoverage.summary,modelSHA256:prior.modelSHA256};await save();
 const invoke=(operation,parameters)=>({action:'invoke',...prior.task,requestId:crypto.randomUUID(),operation,parameters});
 report.delivered=await call(invoke('deliver',{expectedModelSHA256:prior.modelSHA256}));assert.ok(report.delivered.current.delivery.verification.ok);
 report.reviewed=await call(invoke('review_pdfs',{expectedModelSHA256:prior.modelSHA256,expectedSourceSHA256:report.delivered.current.pdfReviewSourceSHA256}));report.files=report.reviewed.files;
 report.finalStatus=await call({action:'status',...prior.task});assert.equal(report.finalStatus.current.modelSHA256,prior.modelSHA256);assert.equal(report.finalStatus.current.documentEvidence.sourceCoverage.complete,true);
 for(const f of [...report.files,...report.protectedFiles])assert.equal(await hashFile(f.file),f.sha256);report.ok=true;report.visualReview='pending';await save();console.log(JSON.stringify({ok:true,...report.design,files:report.files.length,jobId:status.current.jobId}));
}catch(error){report.error=error.stack;await save();throw error;}finally{await c.close().catch(()=>{});}
