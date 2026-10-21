// Recheck saved source/model/native bytes without launching CAD or changing tasks.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {dataHome,parseLocalJSON} from '../src/local-paths.mjs';
import {hashFile} from '../src/drawings.mjs';
import {dependencyDigest} from '../src/task-dependencies.mjs';
import {engineeringDigest} from '../src/engineering-design.mjs';
import {auditEngineeringDesign,verifyEngineeringCad} from '../src/engineering-verification.mjs';
import {auditSpacePlan} from '../src/space-planning-audit.mjs';
import {verifySceneCapture} from '../src/scene-capture-verification.mjs';
import {verifyCapturedShell} from '../src/captured-geometry.mjs';
import {loadPlanningHandoff} from '../src/space-planning-handoff.mjs';
import {verifyLightingSpaceProgram,frozenLightingSpaceConditions} from '../src/lighting-space-program.mjs';
import {projectEngineeringRoomLabels} from '../src/engineering-room-label-projection.mjs';
import {createExecutor} from '../src/runner.mjs';
const folders=process.argv.slice(2).map(p=>path.resolve(p));assert.equal(folders.length,5,'Five retained trials required');
const runs=path.join(dataHome(),'runs'),read=async p=>parseLocalJSON(await fs.readFile(p,'utf8'));
const execute=createExecutor({runs,getSettings:async()=>{throw Error('Read-only evidence audit must not launch CAD');}});
const final=folders.at(-1),journal=await read(path.join(final,'journal.json'));
assert.equal(journal.ok,true);assert.equal(journal.checks.length,15);
const data=await read(path.join(final,'mcp-data-readback.json'));assert.equal(data.ok,true);assert.equal(data.checks.length,7);assert.equal(data.calls.length,20);
const report={schemaVersion:1,professionalApproval:false,independentCustomerAcceptance:false,knownDeveloperCase:true,models:[],retainedTrials:[],sourceFiles:[],frozen:[],filesVerified:0};
for(const discipline of ['space','lighting']){
 const task=journal[discipline+'Task'],identity={jobId:task.jobId,expectedProjectId:task.project.id,expectedTaskSHA256:task.taskSHA256};
 const current=await execute('engineering_task',{action:'status',...identity});assert.equal(current.ok,true,JSON.stringify(current));assert.equal(current.current.modelSHA256,journal[discipline+'Design1'].current.modelSHA256);
 const child=path.join(runs,current.current.jobId),inputs=[];
 for(const revision of [0,1]){
  const input=await read(path.join(child,`input-${revision}.json`)),model=await read(path.join(child,`model-${revision}.json`)),d=journal[discipline+'Deliver'+revision].current.delivery;
  inputs.push(input);const digest=discipline==='space'?dependencyDigest:engineeringDigest;
  assert.equal(digest(input),model.inputSHA256);assert.equal(digest(model),d.modelSHA256);assert.equal(digest(model.input),model.inputSHA256);
  const scan=await read(path.join(d.verification.scanJob,'result.json'));assert.equal(scan.inputSha256,d.drawingSHA256);
  let audit,native,extra={};
  if(discipline==='space'){
   audit=auditSpacePlan(input,model.plan);assert.deepEqual(audit,model.audit);
   native=verifySceneCapture(model.scene,model.placements,scan.query);
   const source=await verifyCapturedShell(input,{runs});assert.equal(source.boundEntities,15);
   const ref=journal['handoff'+revision].current.sharedSpaces.ref,loaded=await loadPlanningHandoff(ref,{runs,expectedProjectId:task.project.id});assert.equal(loaded.current,revision===1);assert.equal(loaded.pack.spaces.length,11);
   extra={spaces:loaded.pack.spaces.length,seats:input.program.reduce((n,p)=>n+p.occupants,0),officeA:input.program.find(p=>p.id==='OFFICE_A'),sourceEntities:source.boundEntities,unassignedM2:model.plan.unassignedM2};
  }else{
   audit=auditEngineeringDesign(model);
   const scene=await read(path.join(child,`delivery-layout-scene-${revision}.json`)),layout=await read(path.join(child,`delivery-room-labels-${revision}.json`)),projection=projectEngineeringRoomLabels(model);
   assert.deepEqual(scene,projection.scene);assert.deepEqual(layout,projection.manifest);assert.equal(engineeringDigest(scene),d.layout.sceneSHA256);assert.equal(layout.sourceModelSHA256,d.modelSHA256);
   native=verifyEngineeringCad({...model,scene},scan.query,scan.snapshot);
   const source=await verifyLightingSpaceProgram(input,{runs,requireCurrent:revision===1});assert.equal(source.current,revision===1);assert.equal(source.availableSpaces,11);assert.equal(source.selectedSpaces.length,5);
   extra={selectedSpaces:source.selectedSpaces,lights:model.devices.length,circuits:model.circuits.length,roomCalculations:model.roomCalculations.map(({roomId,count,areaM2,estimatedLux,targetLux,lpd,method})=>({roomId,count,areaM2,estimatedLux,targetLux,lpd,method})),annotationChanges:layout.annotations,physicalLightingQualityAccepted:false};
  }
  assert.equal(audit.ok,true);assert.equal(native.ok,true,JSON.stringify(native));
  for(const f of d.files){assert.equal(await hashFile(f.file),f.sha256);report.filesVerified++;}
  report.models.push({discipline,revision,inputSHA256:model.inputSHA256,modelSHA256:d.modelSHA256,auditChecks:audit.checks.length,nativeChecks:native.checks.length,...extra});
 }
 if(discipline==='lighting'){
  assert.equal(frozenLightingSpaceConditions(inputs[0]),frozenLightingSpaceConditions(inputs[1]));assert.equal(inputs[1].spaceProgramChanges.length,1);
  const c=inputs[1].spaceProgramChanges[0];assert.equal(c.priorInputSHA256,engineeringDigest(inputs[0]));assert.equal(c.carryForward.expectedConditionsSHA256,frozenLightingSpaceConditions(inputs[0]));assert.deepEqual(c.from,inputs[0].spaceProgram);assert.deepEqual(c.to,inputs[1].spaceProgram);
  assert.notDeepEqual(inputs[0].rooms.find(r=>r.id==='OFFICE_A').polygon,inputs[1].rooms.find(r=>r.id==='OFFICE_A').polygon);
 }
}
for(const f of journal.oldFiles)assert.equal(await hashFile(f.file),f.sha256);
let frozenConditions;
for(const [index,folder]of folders.entries()){
 const j=await read(path.join(folder,'journal.json')),entry={folder,ok:j.ok===true,checks:j.checks?.length??0,professionalApproval:false};
 if(index>0){const input=await read(path.join(runs,j.lightingTask.current.jobId,'input-0.json')),sha=frozenLightingSpaceConditions(input);if(frozenConditions)assert.equal(sha,frozenConditions);frozenConditions=sha;entry.frozenLightingConditionsSHA256=sha;}
 if(index<2){assert.notEqual(j.ok,true);entry.outcome=index===0?'declared corridor local control conflict retained':'source supersession proof missing retained';}
 else {assert.equal(j.ok,true);const qa=await read(path.join(folder,'pdf-review.json'));entry.visualReview=qa.visualReview;entry.pagesInspected=qa.pagesInspected;}
 report.retainedTrials.push(entry);
}
const visual=await read(path.join(final,'pdf-review.json'));assert.equal(visual.visualReview,'agent_visual_passed');assert.equal(visual.pagesInspected,20);report.finalPdfPagesInspected=20;
for(const file of (await fs.readdir('src')).filter(f=>/^(captured-geometry|shared-space|space-planning-|lighting-space|engineering-(annotation|room-label|task|projects|contracts|source-revisions))/.test(f)))report.sourceFiles.push({file:'src/'+file,sha256:await hashFile(path.join('src',file))});
for(const [file,expected]of [[path.join(dataHome(),'dist','cad-ai-bridge-2.0.0-preview.1-windows-x64.zip'),'20e12d2d2d9081390bbb21ee1915d535c75487e85e431fd633ece164cd27a2d2'],['plugin/bin/CadAgent.dll','4f97fdc91a365dcc76809408954a9a171857a928f05c9ad18d14a9d6d360db34'],[path.join(dataHome(),'artifacts','engineering-floor-quality-20261021','通用质量与失败边界-证据包.zip'),'c4ba28c53f9586639340b76b457444ba78940af0427be25837f20e387e8593f2'],[path.join(dataHome(),'artifacts','engineering-task-reconciliation-20261021','父子任务恢复-证据包.zip'),'c8408e8d8fd035a55e16de5c40b6cb9bc1e4814a76d21812ae56b81b2551c340'],[path.join(dataHome(),'artifacts','office-space-planning-20261021-final','第二设计包-证据包.zip'),'4c67079caa2fca756d52c2bf72efd733673ad5c3af21baf777728ee837d5da42']]){const sha256=await hashFile(file);assert.equal(sha256,expected);report.frozen.push({file,sha256});}
report.ok=true;await fs.writeFile(path.join(final,'final-source-audit.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({ok:true,models:report.models.map(({discipline,revision,auditChecks,nativeChecks})=>({discipline,revision,auditChecks,nativeChecks})),filesVerified:report.filesVerified,frozen:report.frozen.length,retainedTrials:report.retainedTrials.length}));
