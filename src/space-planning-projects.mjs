import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {atomicJson} from './files.mjs';
import {jobDirectory,jobJson} from './jobs.mjs';
import {hashFile,isWithin} from './drawings.mjs';
import {dependencyDigest} from './task-dependencies.mjs';
import {spacePlanningInputSchema,planningInputIssues} from './space-planning-contracts.mjs';
import {solveSpacePlan} from './space-planning-solver.mjs';
import {auditSpacePlan} from './space-planning-audit.mjs';
import {spacePlanningScene} from './space-planning-scene.mjs';
import {deliverSpacePlan} from './space-planning-delivery.mjs';
const textSHA=s=>crypto.createHash('sha256').update(s).digest('hex');
async function fresh(dir,name,value){await fs.writeFile(path.join(dir,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
// The enclosing generic task owns the durable request/lock. Native uncertainty is
// also retained here so callers cannot bypass it through a different request.
export function createSpacePlanningManager({runs,execute}){
 async function save(dir,s){s.updatedAt=new Date().toISOString();await atomicJson(path.join(dir,'space-planning.json'),s);await atomicJson(path.join(dir,'task.json'),{jobId:s.jobId,action:'engineering_task',requestId:s.requestId,status:s.status==='delivered'?'completed':s.status==='delivery_unconfirmed'?'blocked':'partial',phase:s.status,ownerPid:process.pid,updatedAt:s.updatedAt});}
 async function verifyFiles(dir,files){for(const f of files??[]){const file=await fs.realpath(f.file),root=await fs.realpath(runs);if(!isWithin(root,file)||await hashFile(file)!==f.sha256)throw Error('PLANNING_OUTPUT_CHANGED');}}
 async function load(binding){if(!/^job-spaceplan-[a-f0-9-]{36}$/.test(binding.childJobId))throw Error('PLANNING_CHILD_ID_INVALID');const dir=await jobDirectory(runs,binding.childJobId),s=await jobJson(dir,'space-planning.json');if(s.jobId!==binding.childJobId||s.initialInputSHA256!==binding.initialInputSHA256||dependencyDigest(await jobJson(dir,'input-0.json'))!==binding.initialInputSHA256)throw Error('PLANNING_CHILD_IDENTITY_CHANGED');const input=spacePlanningInputSchema.parse(await jobJson(dir,'input-'+s.revision+'.json'));if(dependencyDigest(input)!==s.inputSHA256)throw Error('PLANNING_INPUT_CHANGED');let model;if(s.modelSHA256){model=await jobJson(dir,'model-'+s.revision+'.json');if(dependencyDigest(model)!==s.modelSHA256||dependencyDigest(model.input)!==s.inputSHA256||model.inputSHA256!==s.inputSHA256||dependencyDigest(auditSpacePlan(input,model.plan))!==dependencyDigest(model.audit))throw Error('PLANNING_MODEL_CHANGED');const projection=spacePlanningScene(model);for(const key of ['scene','placements','sheets','roomCodes'])if(dependencyDigest(projection[key])!==dependencyDigest(model[key]))throw Error('PLANNING_PROJECTION_CHANGED');}await verifyFiles(dir,s.files);return {dir,s,input,model};}
 const summary=s=>({ok:true,jobId:s.jobId,revision:s.revision,status:s.status,inputSHA256:s.inputSHA256,modelSHA256:s.modelSHA256,programCount:s.programCount,study:s.study,audit:s.audit?{passed:s.audit.checks.filter(c=>c.ok).length,failed:s.audit.checks.filter(c=>!c.ok).length,pending:s.audit.pending.length}:undefined,delivery:s.delivery,review:s.review,files:s.files??[],reviewStatus:'awaiting_human_review',professionalApproval:false});
 async function prepare({input},requestId){input=spacePlanningInputSchema.parse(input);if(input.shell.status==='source_bound')throw Error('PLANNING_CAPTURE_BINDING_REQUIRED: declared geometry cannot claim native source binding');const active=input.sources.filter(s=>s.role==='brief'&&!s.supersededBy);if(!active.length||active.some(s=>s.sha256.toLowerCase()!==textSHA(input.brief)))throw Error('PLANNING_BRIEF_BYTES_MISMATCH');const jobId='job-spaceplan-'+requestId,dir=path.join(runs,jobId);await fs.mkdir(dir);const sha=dependencyDigest(input),issues=planningInputIssues(input),s={schemaVersion:1,jobId,requestId,initialInputSHA256:sha,inputSHA256:sha,revision:0,status:issues.ok?'ready':'blocked_input',programCount:input.program.length,history:[{event:'prepared',revision:0,inputSHA256:sha}],review:[]};await fresh(dir,'input-0.json',input);await save(dir,s);return {childJobId:jobId,initialInputSHA256:sha};}
 async function inspect(binding){return summary((await load(binding)).s);}
 async function invoke(binding,operation,q,requestId){const {dir,s,input,model}=await load(binding);try{
  if(['delivering','delivery_unconfirmed'].includes(s.status))throw Error('PLANNING_DELIVERY_UNCONFIRMED');
  if(['design','revise_program'].includes(operation)&&(q.expectedRevision!==s.revision||q.expectedInputSHA256.toLowerCase()!==s.inputSHA256))throw Error('PLANNING_REVISION_CONFLICT');
  if(['deliver','review'].includes(operation)&&(!model||q.expectedModelSHA256.toLowerCase()!==s.modelSHA256))throw Error('PLANNING_MODEL_CONFLICT');
  if(operation==='design'){
   if(s.modelSHA256)throw Error('PLANNING_MODEL_ALREADY_PUBLISHED: revise requirements before a new design');
   const study=await solveSpacePlan(input,q.budget),name='study-'+s.revision+'-'+requestId+'.json';await fresh(dir,name,study);s.studyFile=name;s.study={status:study.status,nodes:study.nodes,candidates:study.plans.length,optimalityProven:false};s.files=[{kind:'json',file:path.join(dir,name),sha256:await hashFile(path.join(dir,name))}];
   const candidates=study.plans.map(plan=>({plan,audit:auditSpacePlan(input,plan)}));if(candidates.some(c=>!c.audit.ok))throw Error('PLANNING_INDEPENDENT_AUDIT_FAILED');const selected=candidates.sort((a,b)=>a.plan.score-b.plan.score)[0];
   if(!selected){s.status=study.status;await save(dir,s);return {...summary(s),ok:false,error:{code:'PLANNING_NO_FEASIBLE_CANDIDATE',message:'No feasible candidate in this bounded family/budget; no global infeasibility claim'}};}
   const base={schemaVersion:1,sceneVersion:2,revision:s.revision,inputSHA256:s.inputSHA256,input,...selected,alternatives:candidates.map(c=>({id:c.plan.id,score:c.plan.score,variant:c.plan.variant,auditPassed:c.audit.ok})),professionalApproval:false},next={...base,...spacePlanningScene(base)};if(Buffer.byteLength(JSON.stringify({action:'create_drawing',scene:next.scene,requestId,units:'mm'}))>1024*1024)throw Error('PLANNING_NATIVE_REQUEST_TOO_LARGE');
   await fresh(dir,'model-'+s.revision+'.json',next);s.modelSHA256=dependencyDigest(next);s.audit=next.audit;s.status='designed';s.files.push({kind:'json',file:path.join(dir,'model-'+s.revision+'.json'),sha256:await hashFile(path.join(dir,'model-'+s.revision+'.json'))});s.history.push({event:'designed',revision:s.revision,modelSHA256:s.modelSHA256});await save(dir,s);return summary(s);
  }
  if(operation==='revise_program'){
   const n=s.revision+1,sourceId='BRIEF_R'+n,oldIds=new Set(input.sources.filter(a=>a.role==='brief'&&!a.supersededBy).map(a=>a.id)),rebind=item=>({...item,sourceIds:[...item.sourceIds.filter(id=>!oldIds.has(id)),sourceId]});if(input.sources.some(a=>a.id===sourceId))throw Error('PLANNING_REVISION_SOURCE_ID_CONFLICT');
   if(input.parameters.status==='assumed'&&q.parameters.status!=='assumed')throw Error('PLANNING_ASSUMPTION_UPGRADE');for(const old of [...input.program,...input.relations]){const changed=[...q.program,...q.relations].find(a=>a.id===old.id);if(old.status==='assumed'&&changed&&changed.status!=='assumed')throw Error('PLANNING_ASSUMPTION_UPGRADE');}
   const next=spacePlanningInputSchema.parse({...input,brief:q.brief,sources:[...input.sources.map(a=>oldIds.has(a.id)?{...a,supersededBy:sourceId}:a),{id:sourceId,role:'brief',sha256:textSHA(q.brief),description:q.reason,derivedFromFinalDrawing:input.sources.some(a=>oldIds.has(a.id)&&a.derivedFromFinalDrawing)}],program:q.program.map(rebind),relations:q.relations.map(rebind),parameters:rebind(q.parameters),shell:rebind(input.shell),missingInputs:input.missingInputs.map(rebind)});
   // Keep the source shell untouched; program changes cannot quietly change geometry.
   await fresh(dir,'input-'+n+'.json',next);s.history.push({event:'program_revised',fromRevision:s.revision,revision:n,priorInputSHA256:s.inputSHA256,priorModelSHA256:s.modelSHA256,priorDelivery:s.delivery,priorReview:s.review,reason:q.reason});s.revision=n;s.inputSHA256=dependencyDigest(next);s.status=planningInputIssues(next).ok?'ready':'blocked_input';s.programCount=next.program.length;for(const key of ['modelSHA256','audit','delivery','study','studyFile'])delete s[key];s.review=[];s.files=[];await save(dir,s);return summary(s);
  }
  if(operation==='review'){const targets=new Set(['project',...input.program.map(r=>r.id),...input.relations.map(r=>r.id)]);if(q.comments.some(c=>!targets.has(c.target)))throw Error('PLANNING_REVIEW_TARGET_UNKNOWN');const record={...q,requestId,revision:s.revision,recordedAt:new Date().toISOString(),professionalApproval:false};await fresh(dir,'review-'+s.revision+'-'+requestId+'.json',record);s.review.push(record);const reviewFile=path.join(dir,'review-'+s.revision+'-'+requestId+'.json');s.files.push({kind:'json',file:reviewFile,sha256:await hashFile(reviewFile)});s.history.push({event:'review_recorded',revision:s.revision,requestId});await save(dir,s);return summary(s);}
  if(operation==='deliver'){
   if(s.delivery)return {...summary(s),reusedDelivery:true};if(!model.audit.ok||!auditSpacePlan(input,model.plan).ok)throw Error('PLANNING_AUDIT_REQUIRED');s.status='delivering';s.nativeSteps=[];await save(dir,s);
   try{s.delivery=await deliverSpacePlan({model,state:s,dir,execute,save:()=>save(dir,s)});s.files=s.delivery.files;s.status='delivered';s.history.push({event:'delivered',revision:s.revision,modelSHA256:s.modelSHA256});await save(dir,s);return summary(s);}catch(e){s.status='delivery_unconfirmed';s.history.push({event:'delivery_interrupted',message:e.message,steps:s.nativeSteps});await save(dir,s);return {...summary(s),ok:false,outcome:'unknown',safeToRetry:false,error:{code:'PLANNING_DELIVERY_UNCONFIRMED',message:e.message}};}
  }
  throw Error('PLANNING_OPERATION_UNSUPPORTED');
 }catch(e){return {...summary(s),ok:false,error:{code:'PLANNING_OPERATION_FAILED',message:e.message},safeToRetry:false};}}
 return {prepare,inspect,invoke,load};
}
