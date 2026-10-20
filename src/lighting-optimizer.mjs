import fs from 'node:fs/promises';
import path from 'node:path';
import {atomicJson} from './files.mjs';
import {hashFile} from './drawings.mjs';
import {engineeringDigest,engineeringLightingChoices,makeEngineeringDesign} from './engineering-design.mjs';
import {auditEngineeringDesign} from './engineering-verification.mjs';
import {assessLightingQuality,auditLightingQuality,lightingRoomScene,verifyLightingQualityArtifacts} from './lighting-quality.mjs';
import {resolveUgrMethod} from './ugr-evidence.mjs';
import {buildUgrReference} from './ugr-reference.mjs';
import {lightingQualityReviewHtml} from './engineering-report.mjs';

const watts=model=>model.devices.reduce((n,d)=>n+d.watts,0);
const physical=model=>engineeringDigest(model.devices.map(d=>({roomId:d.roomId,fixture:d.fixture,position:d.position})));
export function rankLightingPlans(model,baseline){
 if(baseline.modelSHA256!==engineeringDigest(model))throw Error('LIGHTING_BASELINE_MODEL_MISMATCH');
 const rooms=engineeringLightingChoices(model),coverage=[];let beam=[{selections:[],predictions:[],penalty:0,watts:0}];
 for(const {roomId,choices} of rooms){
  const previous=model.roomCalculations.find(c=>c.roomId===roomId),observed=baseline.rooms.find(r=>r.roomId===roomId)?.summary;
  if(!observed||!(previous.photometry.averageLux>0)||!Number.isFinite(observed.averageLux))throw Error('LIGHTING_BASELINE_NUMERIC_REQUIRED');
  const gain=observed.averageLux/previous.photometry.averageLux,min=previous.targetLux,max=model.input.requirements.find(r=>r.rule==='max_avg_lux'&&r.roomIds.includes(roomId)).value,u=previous.effectiveTargets?.minimumUniformity??model.input.requirements.find(r=>r.rule==='min_uniformity'&&r.roomIds.includes(roomId)).value,glareFailed=baseline.audit.checks.some(c=>!c.ok&&c.id.startsWith('ugr_')&&(c.id.endsWith('_'+roomId)||c.id.includes('_'+roomId+'_')));
  const ranked=choices.map(c=>{const predictedMean=c.photometry.averageLux*gain,power=c.count*model.input.luminaires.find(f=>f.id===c.fixture).watts,penalty=Math.max(0,min-predictedMean,predictedMean-max)/min+.1*Math.max(0,u-c.photometry.uniformity)/u+(glareFailed&&c.fixture===previous.fixture? .2:0);return {choice:c,predictedMean,power,penalty};}).sort((a,b)=>a.penalty-b.penalty||a.power-b.power||a.choice.choiceSHA256.localeCompare(b.choice.choiceSHA256));
  const diverse=[];for(const id of model.input.luminaires.map(f=>f.id)){const r=ranked.find(r=>r.choice.fixture===id);if(r)diverse.push(r);}for(const r of ranked)if(!diverse.includes(r))diverse.push(r);const shortlist=diverse.slice(0,24).sort((a,b)=>a.penalty-b.penalty||a.power-b.power||a.choice.choiceSHA256.localeCompare(b.choice.choiceSHA256));
  coverage.push({roomId,geometryAndPointChoices:choices.length,shortlisted:shortlist.length,productsRepresented:[...new Set(shortlist.map(r=>r.choice.fixture))],observedGain:gain,gainScope:'Ranking heuristic from one frozen baseline; not a valid transport factor for another product/layout or an acceptance result'});
  beam=beam.flatMap(plan=>shortlist.map(r=>({selections:[...plan.selections,{roomId,choiceSHA256:r.choice.choiceSHA256}],predictions:[...plan.predictions,{roomId,fixture:r.choice.fixture,count:r.choice.count,watts:r.power,directAverageLux:r.choice.photometry.averageLux,directUniformity:r.choice.photometry.uniformity,predictedTotalLux:r.predictedMean}],penalty:plan.penalty+r.penalty,watts:plan.watts+r.power}))).sort((a,b)=>a.penalty-b.penalty||a.watts-b.watts||engineeringDigest(a.selections).localeCompare(engineeringDigest(b.selections))).slice(0,32);
 }
 return {plans:beam.map(p=>({...p,id:engineeringDigest(p.selections)})),coverage,scope:'Bounded per-product geometry/point pool and beam32; heuristic ordering only, no proof of global infeasibility or optimality'};
}

export async function verifyLightingOptimization(folder,report){
 for(const item of report.artifacts){const target=path.resolve(folder,item.file);if(!target.startsWith(path.resolve(folder)+path.sep)||await hashFile(target)!==item.sha256)throw Error('LIGHTING_OPTIMIZATION_ARTIFACT_CHANGED');}
}

export async function optimizeLighting(model,baseline,{folder,inputRoot,runtimeFile,ugrProfileFile,maxCandidates=4,maxMinutes=20,baselineReportSHA256,baselineReportFile,baselineFolder,onProgress,assess=assessLightingQuality}={}){
 if(!model.input.lightingEnvironment||!model.input.photometricDesign)throw Error('LIGHTING_OPTIMIZATION_REQUIRES_ENVIRONMENT');
 const method=await resolveUgrMethod(model,ugrProfileFile?{file:ugrProfileFile}:undefined),baselineSnapshot=structuredClone(baseline);
 // Recompute summaries even when the baseline failed its actual target gates.
 baseline.audit=auditLightingQuality(model,baseline,{ugrMethod:method});
 const ranked=rankLightingPlans(model,baseline),started=Date.now(),deadline=started+maxMinutes*60000,records=[];let selected,fullAssessments=0,budgetStopped=false;
 await fs.mkdir(folder);
 await atomicJson(path.join(folder,'baseline.json'),baselineSnapshot);
 if(baselineReportFile){if(await hashFile(baselineReportFile)!==baselineReportSHA256)throw Error('LIGHTING_BASELINE_REPORT_CHANGED');await fs.copyFile(baselineReportFile,path.join(folder,'baseline-source-report.json'),fs.constants.COPYFILE_EXCL);}
 if(baselineFolder)for(const item of baselineSnapshot.artifacts){const source=path.resolve(baselineFolder,item.file),dest=path.resolve(folder,'baseline-evidence',item.file);if(!source.startsWith(path.resolve(baselineFolder)+path.sep)||!dest.startsWith(path.resolve(folder,'baseline-evidence')+path.sep)||await hashFile(source)!==item.sha256)throw Error('LIGHTING_BASELINE_ARTIFACT_CHANGED');await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(source,dest,fs.constants.COPYFILE_EXCL);}
 for(const plan of ranked.plans){
  if(fullAssessments>=maxCandidates||Date.now()>=deadline){budgetStopped=true;break;}
  const candidate=makeEngineeringDesign(model.input,{revision:model.revision+1,standardEvidence:model.standardEvidence,architecturalEvidence:model.architecturalEvidence,photometricEvidence:model.photometricEvidence,lightingStandardEvidence:model.lightingStandardEvidence,layoutSelections:plan.selections}),modelSHA256=engineeringDigest(candidate),record={planId:plan.id,modelSHA256,predictions:plan.predictions,watts:plan.watts,status:'preflight'};records.push(record);
  if(engineeringDigest(candidate.input)!==engineeringDigest(model.input))throw Error('LIGHTING_OPTIMIZATION_INPUT_CHANGED');
  if(physical(candidate)===physical(model)){record.status='unchanged_baseline';continue;}
  if(candidate.devices.length>100){record.status='assessment_budget_unsupported';record.issues=[{code:'LIGHTING_ASSESSMENT_BUDGET',reason:'Candidate exceeds the verified per-assessment device budget; not an infeasibility finding'}];continue;}
  const check=auditEngineeringDesign(candidate);if(!check.ok){record.status='model_rejected';record.failedChecks=check.checks.filter(c=>!c.ok).map(c=>c.id);continue;}
  try{for(const room of candidate.input.rooms){lightingRoomScene(candidate,room,candidate.photometricEvidence);if(method){const ref=buildUgrReference(candidate,room,candidate.input.glareAssessment.rooms.find(r=>r.roomId===room.id),method.profile,candidate.photometricEvidence),issues=ref.calculations.flatMap(o=>o.issues.map(i=>({...i,observerId:o.observer.id,roomId:room.id})));if(issues.length){record.status='unsupported_conditions';record.issues=issues;break;}}}}catch(error){record.status='unsupported_conditions';record.issues=[{code:error.message.split(':')[0],reason:error.message}];}
  if(record.status==='unsupported_conditions')continue;
  const relative='candidate-'+records.length,dir=path.join(folder,relative);await fs.mkdir(dir);await atomicJson(path.join(dir,'model.json'),candidate);await atomicJson(path.join(dir,'checks.json'),check);record.modelFile=relative+'/model.json';record.checksFile=relative+'/checks.json';fullAssessments++;
  try{
   const progress=async p=>{if(Date.now()>=deadline)throw Error('LIGHTING_OPTIMIZATION_TIME_BUDGET');await onProgress?.({...p,candidateNumber:fullAssessments,candidateBudget:maxCandidates});},qualityFolder=path.join(dir,'quality'),quality=await assess(candidate,{folder:qualityFolder,inputRoot,runtimeFile,ugrProfileFile,onProgress:progress});
   const reportFile=path.join(qualityFolder,'report.json'),htmlFile=path.join(qualityFolder,'review.html');await atomicJson(reportFile,quality);await fs.writeFile(htmlFile,lightingQualityReviewHtml(candidate,quality),{flag:'wx'});
   record.qualityFile=relative+'/quality/report.json';record.qualitySHA256=await hashFile(reportFile);record.status=quality.passed?'feasible':'quality_failed';record.failedChecks=quality.audit.checks.filter(c=>!c.ok).map(c=>c.id);record.measuredRooms=quality.rooms.map(r=>({roomId:r.roomId,...r.summary}));record.measuredUgr=quality.ugr?.rooms.map(r=>({roomId:r.roomId,observers:r.observers.map(o=>({id:o.observer.id,issues:o.issues,ugr:o.result?.conservativeUgr,limit:o.result?.maximumUgr}))}));
   if(quality.passed){await verifyLightingQualityArtifacts(qualityFolder,quality);const finalMethod=await resolveUgrMethod(candidate,ugrProfileFile?{file:ugrProfileFile}:undefined);if(!auditLightingQuality(candidate,quality,{ugrMethod:finalMethod}).ok)throw Error('LIGHTING_OPTIMIZATION_FINAL_GATE_FAILED');record.qualityFiles=await Promise.all([reportFile,path.join(qualityFolder,'total-illuminance.csv'),htmlFile,...(quality.ugr?[path.join(qualityFolder,'ugr','ugr-observers.csv')]:[])].map(async file=>({file:path.relative(folder,file).replaceAll('\\','/'),sha256:await hashFile(file),kind:path.extname(file).slice(1)})));selected=record;break;}
  }catch(error){if(error.message==='LIGHTING_OPTIMIZATION_TIME_BUDGET'){record.status='incomplete_time_budget';budgetStopped=true;break;}throw error;}
 }
 const report={schemaVersion:1,method:'source_bound_finite_diffuse_feedback_search',sourceModelSHA256:engineeringDigest(model),sourceBaselineReportSHA256:baselineReportSHA256,baselineSnapshotSHA256:engineeringDigest(baselineSnapshot),inputSHA256:engineeringDigest(model.input),targetRevision:model.revision+1,limits:{maxCandidates,maxMinutes,beam:32,perProductPointPool:16},coverage:ranked.coverage,orderingScope:ranked.scope,fullAssessments,examinedPlans:records.length,generatedPlans:ranked.plans.length,elapsedMs:Date.now()-started,status:selected?'feasible_found':budgetStopped?'budget_exhausted':'bounded_pool_exhausted',selectedPlanId:selected?.planId,selectedModelSHA256:selected?.modelSHA256,baselineWatts:watts(model),selectedWatts:selected?.watts,powerChangeW:selected?selected.watts-watts(model):undefined,records,exhaustive:false,optimalityProven:false,professionalApproval:false};
 const files=[];async function inventory(relative=''){for(const e of await fs.readdir(path.join(folder,relative),{withFileTypes:true})){const name=relative?relative+'/'+e.name:e.name;if(e.isSymbolicLink())throw Error('LIGHTING_OPTIMIZATION_ARTIFACT_SYMLINK');if(e.isDirectory())await inventory(name);else files.push({file:name,sha256:await hashFile(path.join(folder,name))});}}await inventory();report.artifacts=files;return report;
}
