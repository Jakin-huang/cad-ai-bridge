// Explicit private hospital-project acceptance. The source package contains no case.
// Usage: node tests/engineering-project-integration.mjs CASE-MANIFEST.json
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {dataHome,projectPath} from '../src/local-paths.mjs';
import {hashFile} from '../src/drawings.mjs';
import {engineeringDigest} from '../src/engineering-design.mjs';
import {auditEngineeringDesign,compareEngineeringReference} from '../src/engineering-verification.mjs';

const manifestFile=path.resolve(process.argv[2]||'');assert.ok(process.argv[2],'Supply the private case manifest');
const read=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,'')),manifest=await read(manifestFile),folder=path.dirname(manifestFile),project=await read(manifest.projectFile),checks=[],observations={};
for(const file of manifest.files)assert.equal(await hashFile(file.file),file.sha256);
const client=new Client({name:'engineering-project-acceptance',version:'1.0.0'}),transport=new StdioClientTransport({command:process.execPath,args:[projectPath('mcp-server.mjs')],env:{...process.env,CADAGENT_ALLOWED_ROOT:folder},stderr:'pipe'});
const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);console.log('PASS '+name);};
const call=async args=>{const reply=await client.callTool({name:'cad_design_project',arguments:args},{timeout:600000});const r=JSON.parse(reply.content.find(c=>c.type==='text').text);if(r.ok===false)throw Error(JSON.stringify(r));return r;};
try{
 await client.connect(transport);check('Actual MCP discovers the typed engineering project tool',(await client.listTools()).tools.some(t=>t.name==='cad_design_project'));
 const prepared=observations.prepared=await call({action:'prepare',requestId:crypto.randomUUID(),project});check('Project intake retains six source-linked spaces and explicit assumptions',prepared.status==='prepared'&&prepared.rooms===project.rooms.length&&prepared.issues.some(i=>i.code==='RETROSPECTIVE_INPUT'));
 const designed=observations.designed=await call({action:'design',jobId:prepared.jobId,expectedRevision:0});check('Actual MCP generates a design with independent subset checks and pending review',designed.status==='designed'&&designed.checks.failed===0&&designed.checks.pending>0);
 const job=path.join(dataHome(),'runs',prepared.jobId),modelFile=path.join(job,'model-0.json'),model=await read(modelFile);assert.equal(engineeringDigest(model),designed.modelSHA256);
 check('Three bounded standard checks bind to imported local PDF source identity and page evidence',model.standardEvidence.length===3&&model.standardEvidence.every(e=>e.page===19)&&auditEngineeringDesign(model).checks.filter(c=>c.id.startsWith('standard_')).length===3);
 const modelFreeze={modelSHA256:designed.modelSHA256,frozenAt:new Date().toISOString(),inputSources:model.input.sources.map(s=>s.id)};await fs.writeFile(path.join(folder,'model-freeze.json'),JSON.stringify(modelFreeze,null,2));
 const reference=await read(manifest.referenceFile),comparison=compareEngineeringReference(model,reference);await fs.writeFile(path.join(folder,'reference-comparison.json'),JSON.stringify(comparison,null,2));check('Evaluator reads reference only after model hash freeze; comparison never certifies professional correctness',comparison.professionalApproval===false&&!model.input.sources.some(s=>s.role==='reference'));
 const requestId=crypto.randomUUID(),delivered=observations.delivered=await call({action:'deliver',jobId:prepared.jobId,requestId,expectedModelSHA256:designed.modelSHA256});
 check('Native CAD creates, places, saves, independently reopens and verifies the design',delivered.status==='delivered'&&delivered.delivery.verification.ok);
 const state=await read(path.join(job,'engineering.json'));observations.nativeSteps=state.nativeSteps;
 const files=state.delivery.files;check('All five coordinated sheets have actual PDF and PNG outputs',files.filter(f=>f.kind==='pdf').length===model.sheets.length&&files.filter(f=>f.kind==='png').length===model.sheets.length);for(const file of files)assert.equal(await hashFile(file.file),file.sha256);
 const replay=await call({action:'deliver',jobId:prepared.jobId,requestId,expectedModelSHA256:designed.modelSHA256});check('Replaying delivery returns identical registered outputs without native creation again',replay.replayed&&JSON.stringify((await read(path.join(job,'engineering.json'))).nativeSteps)===JSON.stringify(state.nativeSteps));
 const review=await call({action:'review',jobId:prepared.jobId,expectedModelSHA256:designed.modelSHA256,origin:'simulation',reviewer:'Automated workflow test',comments:[{id:'SIM_CHANGE',target:'TEACH',decision:'revise',text:'模拟审核：改变示教室目标并重新核算，不能算实际人工签审。'}]});check('Simulated reviewer feedback remains awaiting human review',review.professionalApproval===false&&review.reviewStatus==='awaiting_human_review');
 const target=project.requirements.find(r=>r.rule==='target_lux'&&r.roomIds.includes('TEACH'))||project.requirements.find(r=>r.rule==='target_lux');
 const revised=await call({action:'revise',jobId:prepared.jobId,expectedRevision:0,changes:[{requirementId:target.id,value:target.value+50,reason:'模拟审核要求提高目标；仍为明确验证假设',sourceId:target.sourceIds[0]}]});const infeasible=await call({action:'design',jobId:prepared.jobId,expectedRevision:1});check('Infeasible higher illuminance versus product/LPD is reported blocked, never silently relaxed',infeasible.status==='blocked'&&infeasible.issues.some(i=>i.code==='NO_FEASIBLE_LIGHTING_LAYOUT'));
 await call({action:'revise',jobId:prepared.jobId,expectedRevision:1,changes:[{requirementId:target.id,value:400,reason:'独立模拟审核变体改为400lx；不是引擎自动放宽要求',sourceId:target.sourceIds[0]}]});const redesigned=await call({action:'design',jobId:prepared.jobId,expectedRevision:2}),revisionModel=await read(path.join(job,'model-2.json'));
 check('Requirement editing creates a new model revision, recalculates and invalidates previous review',revised.revision===1&&redesigned.modelSHA256!==designed.modelSHA256&&auditEngineeringDesign(revisionModel).ok&&(await read(path.join(job,'engineering.json'))).review.length===0&&revisionModel.devices.length!==model.devices.length);
 const revisionDelivery=await call({action:'deliver',jobId:prepared.jobId,requestId:crypto.randomUUID(),expectedModelSHA256:redesigned.modelSHA256});check('Revised design is regenerated through actual CAD and all drawings reverified',revisionDelivery.status==='delivered'&&revisionDelivery.delivery.verification.ok);
 for(const file of manifest.files)assert.equal(await hashFile(file.file),file.sha256);check('Original hospital drawings, isolated reference and supplied evidence remain unchanged',true);
 const report={ok:true,checkedAt:new Date().toISOString(),checks,scope:manifest.scope,jobId:prepared.jobId,jobRoot:job,deliveredRevision:2,currentDesignRevision:2,modelSHA256:designed.modelSHA256,revisionModelSHA256:redesigned.modelSHA256,rooms:model.roomCalculations.map(c=>({roomId:c.roomId,count:c.count,areaM2:c.areaM2,estimatedLux:c.estimatedLux,targetLux:c.targetLux,lpd:c.lpd})),devices:model.devices.length,revisedDevices:revisionModel.devices.length,circuits:model.circuits.length,sheets:model.sheets.length,automatedChecks:designed.checks,initialDelivery:state.delivery,delivery:revisionDelivery.delivery,comparison,observations,acceptance:{currentMachinePipeline:true,independentProspectiveDesign:false,humanProfessionalReview:false,constructionApproval:false}};
 await fs.writeFile(path.join(folder,'engineering-integration-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,checks:checks.length,jobId:prepared.jobId,jobRoot:job,files:files.length}));
}catch(error){await fs.writeFile(path.join(folder,'engineering-integration-failure-'+Date.now()+'.json'),JSON.stringify({ok:false,error:error.stack,checks,observations},null,2));throw error;}finally{await client.close();}
