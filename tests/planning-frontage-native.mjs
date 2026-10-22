// Declared development geometry only. Independent-source inspiration is not project acceptance.
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/client';import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {frontageInput,frontageRevisionInput} from './helpers/planning-frontage.mjs';import {auditSpacePlan} from '../src/space-planning-audit.mjs';import {localFrame} from '../src/planning-geometry.mjs';import {hashFile} from '../src/drawings.mjs';import {dataHome,outsideProject,projectPath} from '../src/local-paths.mjs';
const root=outsideProject(path.resolve(process.argv[2]??''));assert.ok(process.argv[2]);await fs.mkdir(root);
const write=(name,value)=>fs.writeFile(path.join(root,name),JSON.stringify(value,null,2)+'\n'),read=async file=>JSON.parse(await fs.readFile(file,'utf8')),uuid=()=>crypto.randomUUID();
const client=new Client({name:'frontage-native-development-check',version:'1'}),report={ok:false,actualAiClient:false,independentProjectAcceptance:false,professionalApproval:false,scope:'One declared shell; original unequal preferences preserved; explicit equal frontage relation added in revision 1',revisions:[]};
const call=async q=>{await fs.appendFile(root+'/calls.ndjson',JSON.stringify({q})+'\n');const raw=await client.callTool({name:'cad_engineering_task',arguments:q},{timeout:600000}),r=JSON.parse(raw.content.find(c=>c.type==='text').text);await fs.appendFile(root+'/calls.ndjson',JSON.stringify({result:r})+'\n');assert.equal(r.ok,true,JSON.stringify(r));return r;};
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[projectPath('mcp-server.mjs')],env:{...process.env,CADAGENT_ALLOWED_ROOT:dataHome()},stderr:'pipe'}));
 const input=frontageInput({related:false}),revised=frontageInput();await write('input-r0.json',input);await write('input-r1.json',revised);
 assert.deepEqual(input.shell,revised.shell);assert.deepEqual(input.program,revised.program);assert.deepEqual(input.parameters,revised.parameters);
 const prepared=await call({action:'prepare',requestId:uuid(),project:{id:uuid(),name:input.title,type:'synthetic-development'},task:{kind:'office-space-planning',title:input.title,objective:'Generate, revise and deliver a source-declared equal-frontage design while retaining all original physical and area requirements.'},parameters:{input}}),binding={jobId:prepared.jobId,expectedProjectId:prepared.project.id,expectedTaskSHA256:prepared.taskSHA256};report.task=binding;
 const invoke=(operation,parameters)=>call({action:'invoke',...binding,requestId:uuid(),operation,parameters});let current=prepared.current;
 for(const revision of [0,1]){
  if(revision)current=(await invoke('revise_program',{expectedRevision:0,expectedInputSHA256:current.inputSHA256,brief:revised.brief,program:revised.program,relations:revised.relations,parameters:revised.parameters,reason:'Add explicit zero frontage difference between the three rooms; do not replace area preferences or original physical conditions.'})).current;
  const designed=await invoke('design',{expectedRevision:revision,expectedInputSHA256:current.inputSHA256,budget:{maxNodes:30000,maxMilliseconds:5000,maxPlans:1,corridorMode:'allow_single_sided'}});current=designed.current;
  const modelFile=path.join(dataHome(),'runs',current.jobId,'model-'+revision+'.json'),model=await read(modelFile),p=revision?frontageRevisionInput(input,revised,'Add explicit zero frontage difference between the three rooms; do not replace area preferences or original physical conditions.'):input;assert.deepEqual(model.input,p);assert.equal(auditSpacePlan(p,model.plan).ok,true);
  const widths=model.plan.rooms.map(r=>({id:r.id,frontageMm:r.rect.max[localFrame(p).axis]-r.rect.min[localFrame(p).axis]}));assert.equal(new Set(widths.map(r=>r.frontageMm)).size===1,!!revision);
  const delivered=await invoke('deliver',{expectedModelSHA256:current.modelSHA256});assert.equal(delivered.current.delivery.verification.ok,true);
  const pdf=await invoke('review_pdfs',{expectedModelSHA256:current.modelSHA256,expectedSourceSHA256:delivered.current.pdfReviewSourceSHA256});current=pdf.current;
  for(const f of current.files)assert.equal(await hashFile(f.file),f.sha256,f.file);
  report.revisions.push({revision,modelFile,modelSHA256:current.modelSHA256,inputSHA256:current.inputSHA256,widths,audit:model.audit,files:current.files,reviewStatus:current.reviewStatus,pdfReview:current.pdfReview,delivery:current.delivery});await write('report.json',report);
 }
 for(const f of report.revisions[0].files)assert.equal(await hashFile(f.file),f.sha256,'Original file changed: '+f.file);
 await client.close();await client.connect(new StdioClientTransport({command:process.execPath,args:[projectPath('mcp-server.mjs')],env:{...process.env,CADAGENT_ALLOWED_ROOT:dataHome(),CADBRIDGE_READ_ONLY:'1'},stderr:'pipe'}));const fresh=await call({action:'status',...binding});assert.equal(fresh.current.modelSHA256,current.modelSHA256);assert.equal(fresh.current.reviewStatus,'awaiting_human_review');
 report.ok=true;report.oldFilesUnchanged=true;report.freshReadonlyVerified=true;report.visualReviewPending=true;await write('report.json',report);console.log(JSON.stringify({ok:true,revisions:report.revisions.map(r=>({revision:r.revision,widths:r.widths,files:r.files.length})),visualReviewPending:true}));
}catch(e){report.error=e.stack;await write('report.json',report);throw e;}finally{await client.close().catch(()=>{});}
