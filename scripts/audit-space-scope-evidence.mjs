// Independent saved-byte audit. It must never launch CAD or amend a task.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {dataHome,parseLocalJSON} from '../src/local-paths.mjs';
import {hashFile} from '../src/drawings.mjs';
import {dependencyDigest} from '../src/task-dependencies.mjs';
import {engineeringSchema} from '../src/engineering-contracts.mjs';
import {engineeringDigest} from '../src/engineering-design.mjs';
import {auditEngineeringDesign,verifyEngineeringCad} from '../src/engineering-verification.mjs';
import {auditSpacePlan} from '../src/space-planning-audit.mjs';
import {verifySceneCapture} from '../src/scene-capture-verification.mjs';
import {verifyCapturedShell} from '../src/captured-geometry.mjs';
import {loadPlanningHandoff} from '../src/space-planning-handoff.mjs';
import {verifyLightingSpaceProgram} from '../src/lighting-space-program.mjs';
import {verifyLightingScopeRevision} from '../src/lighting-space-revisions.mjs';
import {spaceScopeDelta} from '../src/space-scope-decisions.mjs';
import {projectEngineeringRoomLabels} from '../src/engineering-room-label-projection.mjs';
import {createExecutor} from '../src/runner.mjs';
const folder=path.resolve(process.argv[2]??'');assert.ok(process.argv[2]);
const runs=path.join(dataHome(),'runs'),read=async p=>parseLocalJSON(await fs.readFile(p,'utf8')),j=await read(path.join(folder,'journal.json'));
assert.equal(j.ok,true);const execute=createExecutor({runs,getSettings:async()=>{throw Error('Audit must not launch CAD');}}),report={schemaVersion:1,knownDeveloperCase:true,professionalApproval:false,semanticAcceptance:false,models:[],filesVerified:0,frozen:[],sourceFiles:[]};
for(const discipline of ['space','lighting']){
 const task=j[discipline+'Task'],status=await execute('engineering_task',{action:'status',jobId:task.jobId,expectedProjectId:task.project.id,expectedTaskSHA256:task.taskSHA256});assert.equal(status.ok,true,JSON.stringify(status));assert.equal(status.current.modelSHA256,j[discipline+'Design1'].current.modelSHA256);
 const child=path.join(runs,status.current.jobId),inputs=[];
 for(const revision of [0,1]){
  const input=await read(path.join(child,`input-${revision}.json`)),model=await read(path.join(child,`model-${revision}.json`)),d=j[discipline+'Deliver'+revision].current.delivery,digest=discipline==='space'?dependencyDigest:engineeringDigest;
  inputs.push(input);assert.equal(digest(input),model.inputSHA256);assert.equal(digest(model.input),model.inputSHA256);assert.equal(digest(model),d.modelSHA256);
  const scan=await read(path.join(d.verification.scanJob,'result.json'));assert.equal(scan.inputSha256,d.drawingSHA256);let audit,native,extra;
  if(discipline==='space'){
   audit=auditSpacePlan(input,model.plan);assert.deepEqual(audit,model.audit);native=verifySceneCapture(model.scene,model.placements,scan.query);const bound=await verifyCapturedShell(input,{runs});assert.equal(bound.boundEntities,15);
   const published=j['handoff'+revision].current.sharedSpaces,pack=await loadPlanningHandoff(published.ref,{runs,expectedProjectId:task.project.id});assert.equal(pack.current,revision===1);assert.equal(pack.pack.spaces.length,11);
   extra={rooms:input.program.length,programme:input.program.map(({id,name,activity,occupants})=>({id,name,activity,occupants})),sourceEntities:bound.boundEntities};
  }else{
   audit=auditEngineeringDesign(model);const scene=await read(path.join(child,`delivery-layout-scene-${revision}.json`)),projection=projectEngineeringRoomLabels(model);assert.deepEqual(scene,projection.scene);assert.equal(engineeringDigest(scene),d.layout.sceneSHA256);assert.equal(projection.manifest.sourceModelSHA256,d.modelSHA256);native=verifyEngineeringCad({...model,scene},scan.query,scan.snapshot);
   const source=await verifyLightingSpaceProgram(input,{runs,requireCurrent:revision===1});assert.equal(source.current,revision===1);assert.equal(source.selectedSpaces.length,5);
   extra={selected:input.rooms.map(({id,use})=>({id,use})),lights:model.devices.length,circuits:model.circuits.length,watts:model.devices.reduce((n,d)=>n+d.watts,0),roomCalculations:model.roomCalculations.map(({roomId,count,areaM2,estimatedLux,targetLux,lpd,method})=>({roomId,count,areaM2,estimatedLux,targetLux,lpd,method})),pending:audit.pending.length,physicalLightingQualityAccepted:false};
  }
  assert.equal(audit.ok,true);assert.equal(native.ok,true,JSON.stringify(native));for(const f of d.files){assert.equal(await hashFile(f.file),f.sha256);report.filesVerified++;}
  report.models.push({discipline,revision,inputSHA256:model.inputSHA256,modelSHA256:d.modelSHA256,auditChecks:audit.checks.length,nativeChecks:native.checks.length,...extra});
 }
 if(discipline==='space'){assert.ok(inputs[0].program.some(r=>r.id==='TEAM'));assert.ok(!inputs[1].program.some(r=>r.id==='TEAM'));assert.ok(inputs[1].program.some(r=>r.id==='STUDIO'));assert.equal(inputs[1].program.find(r=>r.id==='OFFICE_A').activity,'meeting');const shell=({sourceIds,...p})=>p;assert.deepEqual(shell(inputs[0].shell),shell(inputs[1].shell));}
 else {
  const before=inputs[0],after=inputs[1],c=after.spaceProgramChanges.at(-1),proof=await read(path.join(child,'space-scope-update-'+c.changeId+'.json'));assert.equal(c.mode,'scope_revision');assert.equal(c.priorInputSHA256,engineeringDigest(before));assert.equal(engineeringDigest(proof.nextInput),engineeringDigest(after));assert.equal(proof.nextState.inputSHA256,engineeringDigest(after));assert.equal(proof.status,'committed');assert.equal(proof.payloadSHA256,engineeringDigest(engineeringSchema.parse({action:'revise_space_scope',jobId:path.basename(child),...j.scopeRevisionRequest.parameters,requestId:j.scopeRevisionRequest.requestId})));
  const impact=await verifyLightingScopeRevision(before,after,c,{runs});assert.deepEqual(impact.added,['STUDIO']);assert.deepEqual(impact.removed,['TEAM']);assert.deepEqual(impact.usesChanged,[{roomId:'OFFICE_A',from:'office',to:'teaching'}]);
  const delta=spaceScopeDelta(before,after);report.amendment={conditions:delta.length,dispositions:Object.fromEntries(['added','removed','revised','retained'].map(kind=>[kind,delta.filter(d=>d.disposition===kind).length])),added:impact.added,removed:impact.removed,usesChanged:impact.usesChanged,allSelectedRecomputed:impact.recomputedScope.length};
  for(const roomId of ['OFFICE_A','STUDIO'])assert.equal(after.requirements.find(r=>r.rule==='target_lux'&&r.roomIds.includes(roomId)).value,500);assert.ok(!after.requirements.some(r=>r.roomIds.includes('TEAM')));
 }
}
for(const f of j.oldFiles)assert.equal(await hashFile(f.file),f.sha256);
const qa=await read(path.join(folder,'pdf-review.json'));assert.equal(qa.visualReview,'agent_visual_passed');const reviewed=new Set(qa.directlyInspectedRenders);assert.equal(reviewed.size,qa.pagesInspected);for(const row of qa.identicalReviewedRenders??[]){assert.equal(await hashFile(path.join(folder,'待审图册',row.file)),row.sha256);assert.equal(await hashFile(row.previousFile),row.sha256);assert.equal(await hashFile(row.previousReviewFile),row.previousReviewSHA256);const prior=await read(row.previousReviewFile);assert.equal(prior.visualReview,'agent_visual_passed');assert.equal(prior.pagesInspected,20);assert.ok(!reviewed.has(row.file));reviewed.add(row.file);}assert.equal(reviewed.size,20);report.pdfReview={pagesCovered:20,finalPagesDirectlyInspected:qa.pagesInspected,identicalToPreviouslyInspectedRenders:(qa.identicalReviewedRenders??[]).length};
const interpretationFile=path.join(folder,'input-interpretation-review.json'),interpretation=await read(interpretationFile);assert.equal(interpretation.status,'agent_reviewed_coherent_developer_explanation');assert.equal(interpretation.semanticAcceptance,false);report.developerExplanationReviewSHA256=await hashFile(interpretationFile);
if(process.argv[3]){const prior=await read(path.join(path.resolve(process.argv[3]),'journal.json'));for(const key of ['program','relations','parameters'])assert.deepEqual(j.frozenRevisionProgram[key],prior.frozenRevisionProgram[key]);const shell=p=>({rect:p.shell.rect,entry:p.shell.entry,windows:p.shell.windows,keepouts:p.shell.keepouts});assert.deepEqual(shell(j.frozenRevisionProgram),shell(prior.frozenRevisionProgram));assert.equal(j.frozenLightingProposal.project.brief,prior.frozenLightingProposal.project.brief);for(const key of ['rooms','requirements','luminaires','electrical'])assert.deepEqual(j.frozenLightingProposal.project[key],prior.frozenLightingProposal.project[key]);report.frozenProgrammeAndLightingConditionsUnchangedAcrossTrials=true;}
const pages=await read(path.join(folder,'mcp-data-readback.json'));assert.equal(pages.ok,true);assert.equal(pages.checks.length,7);assert.equal(pages.calls.length,20);report.nativePipelineChecks=j.checks.length;report.readOnlyDataChecks=7;
for(const file of (await fs.readdir('src')).filter(f=>/^(captured-geometry|shared-space|space-scope|space-planning-|lighting-space|engineering-(annotation|room-label|task|projects|contracts|source-revisions))/.test(f)))report.sourceFiles.push({file:'src/'+file,sha256:await hashFile(path.join('src',file))});
for(const [file,expected]of [[path.join(dataHome(),'dist','cad-ai-bridge-2.0.0-preview.1-windows-x64.zip'),'20e12d2d2d9081390bbb21ee1915d535c75487e85e431fd633ece164cd27a2d2'],['plugin/bin/CadAgent.dll','4f97fdc91a365dcc76809408954a9a171857a928f05c9ad18d14a9d6d360db34'],[path.join(dataHome(),'artifacts','shared-space-coordination-20261021-annotations','空间与照明联动-证据包.zip'),'17c4798b475569d235da0281eb28e00e8923e3ec78aa265a1c9db0c21274a0d5'],[path.join(dataHome(),'artifacts','engineering-floor-quality-20261021','通用质量与失败边界-证据包.zip'),'c4ba28c53f9586639340b76b457444ba78940af0427be25837f20e387e8593f2']]){const sha256=await hashFile(file);assert.equal(sha256,expected);report.frozen.push({file,sha256});}
report.ok=true;await fs.writeFile(path.join(folder,'final-source-audit.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({ok:true,models:report.models.map(({discipline,revision,auditChecks,nativeChecks,lights})=>({discipline,revision,auditChecks,nativeChecks,lights})),amendment:report.amendment,filesVerified:report.filesVerified,nativePipelineChecks:report.nativePipelineChecks}));
