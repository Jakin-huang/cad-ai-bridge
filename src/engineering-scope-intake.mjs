// Original-document scope review before geometry or a formal design task exists.
// Interpretations are supplied by the caller; no keyword routing or authority claim.
import fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {dependencyDigest as digest} from './task-dependencies.mjs';
import {loadDocumentSet,readDocumentText,documentSetSourceBlocks,documentLock} from './project-document-store.mjs';
import {sourceCoverageSchema,checkSourceCoverage} from './document-source-coverage.mjs';
import {documentSetRefSchema} from './project-document-contracts.mjs';
import {jobDirectory,jobJson} from './jobs.mjs';
import {atomicJson} from './files.mjs';
import {hashFile} from './drawings.mjs';
import {scopeTaskEvidence,scopeExecutionStates,scopePrerequisitePins,scopeDependencyBlockers} from './scope-task-evidence.mjs';
import {scopeEvidenceSchema as evidence,scopeFactSchema,scopeWhenSchema,scopeInactiveDependencySchema,validateScopeConditions,scopeApplicability} from './scope-applicability.mjs';
const sha=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
export const scopeReviewRefSchema=z.strictObject({jobId:z.string().regex(/^job-scopereview-[a-f0-9-]{36}$/),sha256:sha});
export const scopeSelectionSchema=z.strictObject({review:scopeReviewRefSchema,workItemId:id});
export const bindScopeTaskSchema=z.strictObject({action:z.literal('bind_scope_task'),requestId:z.uuid(),review:scopeReviewRefSchema,workItemId:id,task:z.strictObject({jobId:z.string().regex(/^job-task-[a-f0-9-]{36}$/),expectedProjectId:z.uuid(),expectedTaskSHA256:sha}),expectedModelSHA256:sha});
export const reviewScopeSchema=z.strictObject({action:z.literal('review_scope'),requestId:z.uuid(),documents:documentSetRefSchema,facts:z.array(scopeFactSchema).max(200).optional(),workItems:z.array(z.strictObject({id,description:z.string().min(1).max(2000).refine(s=>s.trim().length>0,'A nonblank obligation description is required'),disposition:z.enum(['candidate','deferred','unsupported','unresolved','conflict','context']),taskKind:z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional(),reason:z.string().min(10).max(2000),evidence,dependsOn:z.array(id).max(100).default([]),when:scopeWhenSchema.optional(),allowInactiveDependencies:z.array(scopeInactiveDependencySchema).max(100).optional()})).min(1).max(500),sourceCoverage:sourceCoverageSchema.default([])});
export const readScopeReviewSchema=z.strictObject({action:z.literal('read_scope_review'),review:scopeReviewRefSchema,section:z.enum(['summary','work_items','source_coverage','facts','applicability']).default('summary'),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(100).default(25)});
const scope={semanticCoverageAccepted:false,authorityVerified:false,designReady:false,professionalApproval:false};
const ref=r=>({jobId:r.jobId,sha256:digest(r)});
function validateGraph(items){
 const byId=new Map(items.map(i=>[i.id,i]));if(byId.size!==items.length)throw Error('SCOPE_WORK_ID_DUPLICATE');
 for(const row of items){if(new Set(row.dependsOn).size!==row.dependsOn.length||row.dependsOn.some(id=>!byId.has(id)))throw Error('SCOPE_DEPENDENCY_UNKNOWN_OR_DUPLICATE');}
 const active=new Set(),done=new Set();function visit(id){if(active.has(id))throw Error('SCOPE_DEPENDENCY_CYCLE');if(done.has(id))return;active.add(id);for(const dep of byId.get(id).dependsOn)visit(dep);active.delete(id);done.add(id);}for(const row of items)visit(row.id);
}
export async function loadScopeReview(runs,reference){const dir=await jobDirectory(runs,reference.jobId),record=await jobJson(dir,'scope-review.json');let binding;try{binding=await jobJson(dir,'scope-binding.json');}catch(e){if(e.code==='ENOENT')throw Error('SCOPE_REVIEW_UNCONFIRMED');throw e;}if(record.jobId!==reference.jobId||digest(record)!==reference.sha256||binding.jobId!==record.jobId||binding.sha256!==reference.sha256)throw Error('SCOPE_REVIEW_CHANGED');return record;}
const load=loadScopeReview;
async function summary(runs,record,tasks){
 const documents=await loadDocumentSet(runs,record.documents),items=record.workItems,executions=await scopeExecutionStates(record,tasks);
 const applicability=items.map(i=>({workItemId:i.id,...scopeApplicability(record,i)}));
 const candidates=items.filter(i=>i.disposition==='candidate').map(i=>{const execution=executions.find(e=>e.workItemId===i.id),prerequisites=scopeDependencyBlockers(record,i,executions),applicability=scopeApplicability(record,i);return {id:i.id,taskKind:i.taskKind,applicability,canPrepareConditions:applicability.state==='active'&&documents.current&&record.sourceCoverage.summary.complete&&(!execution||!execution.current)&&prerequisites.length===0,executionStatus:execution?(execution.current?'delivered_for_review':'stale'):'not_bound',prerequisites};});
 const file=path.join(await jobDirectory(runs,record.jobId),'scope-review.json');
 return {ok:true,review:ref(record),projectId:record.documents.projectId,documents:record.documents,documentsCurrent:documents.current,sourceCoverage:record.sourceCoverage.summary,counts:Object.fromEntries(['candidate','deferred','unsupported','unresolved','conflict','context'].map(d=>[d,items.filter(i=>i.disposition===d).length])),applicabilityCounts:Object.fromEntries(['active','inactive','unknown'].map(s=>[s,applicability.filter(i=>i.state===s).length])),candidates,executionBindings:executions,files:[{kind:'json',file,sha256:await hashFile(file)}],wholeProjectAccepted:false,...scope};
}
export function createEngineeringScopeIntake({runs,tasks,intakeKinds}){
 async function persist(record,dir){
  if(Buffer.byteLength(JSON.stringify(record))>4*1024*1024)throw Error('SCOPE_REVIEW_BUDGET');
  await fs.mkdir(dir,{recursive:true});return documentLock(dir,'scope.lock',async()=>{
   try{await fs.writeFile(path.join(dir,'scope-review.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;const old=await jobJson(dir,'scope-review.json');if(digest(old)!==digest(record))throw Error('SCOPE_REVIEW_REQUEST_CONFLICT');}
   try{await fs.writeFile(path.join(dir,'scope-binding.json'),JSON.stringify(ref(record),null,2)+'\n',{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;await load(runs,ref(record));}
   await loadDocumentSet(runs,record.documents,{requireCurrent:true});const view=await summary(runs,record,tasks);
   await atomicJson(path.join(dir,'result.json'),{...view,historicalSnapshot:true});
   await atomicJson(path.join(dir,'task.json'),{jobId:record.jobId,action:'engineering_intake',requestId:record.jobId.slice('job-scopereview-'.length),status:view.candidates.some(c=>c.canPrepareConditions)||view.executionBindings.some(e=>e.current)?'partial':'blocked',phase:'scope_reviewed_awaiting_conditions',ownerPid:process.pid});return view;
  });
 }

 async function run(q){
  if(q.action==='read_scope_review'){
   const record=await load(runs,q.review),view=await summary(runs,record,tasks);if(q.section==='summary')return view;
   const all=q.section==='work_items'?record.workItems:q.section==='facts'?(record.facts??[]):q.section==='applicability'?record.workItems.map(i=>({workItemId:i.id,...scopeApplicability(record,i)})):record.sourceCoverage.entries,items=[];let bytes=0;
   for(const item of all.slice(q.offset,q.offset+q.limit)){const n=Buffer.byteLength(JSON.stringify(item));if(bytes+n>230*1024){if(!items.length)throw Error('SCOPE_PAGE_ITEM_TOO_LARGE');break;}items.push(item);bytes+=n;}
   return {...view,section:q.section,items,total:all.length,offset:q.offset,nextOffset:q.offset+items.length<all.length?q.offset+items.length:null};
  }
  const jobId='job-scopereview-'+q.requestId,dir=path.join(runs,jobId),requestSHA256=digest(q);
  try{const old=await jobJson(dir,'scope-review.json');if(old.requestSHA256!==requestSHA256)throw Error('SCOPE_REVIEW_REQUEST_CONFLICT');await load(runs,ref(old));return {...await summary(runs,old,tasks),replayed:true};}catch(e){if(e.code!=='ENOENT')throw e;}
  if(q.action==='bind_scope_task'){
   const prior=await load(runs,q.review);await loadDocumentSet(runs,prior.documents,{requireCurrent:true});const view=await summary(runs,prior,tasks),item=prior.workItems.find(i=>i.id===q.workItemId);
   if(!item||item.disposition!=='candidate')throw Error('SCOPE_TASK_ITEM_NOT_CANDIDATE');
   if(scopeApplicability(prior,item).state!=='active')throw Error('SCOPE_WORK_ITEM_NOT_ACTIVE');
   if(!view.sourceCoverage.complete||view.candidates.find(c=>c.id===item.id).prerequisites.length)throw Error('SCOPE_TASK_PREREQUISITES_OPEN');
   const prerequisites=scopePrerequisitePins(prior,item),old=prior.taskBindings?.find(b=>b.workItemId===item.id);if(old?.task.jobId===q.task.jobId&&old.modelSHA256===q.expectedModelSHA256&&digest(old.prerequisites??[])!==digest(prerequisites))throw Error('SCOPE_DEPENDENCY_REDESIGN_REQUIRED');
   const binding={workItemId:item.id,task:q.task,modelSHA256:q.expectedModelSHA256,prerequisites},checked=await scopeTaskEvidence(prior,binding,tasks),{current,...frozen}=checked;
   if(prior.taskBindings?.some(b=>b.workItemId===item.id&&digest(b)===digest(frozen)))throw Error('SCOPE_TASK_ALREADY_BOUND');
   const record={...prior,jobId,requestSHA256,previousReview:q.review,taskBindings:[...(prior.taskBindings??[]).filter(b=>b.workItemId!==item.id),frozen]};return persist(record,dir);
  }
  const documents=await loadDocumentSet(runs,q.documents,{requireCurrent:true}),capabilities=await tasks.run({action:'capabilities',section:'summary'});if(!capabilities.ok)throw Error('SCOPE_CAPABILITIES_UNAVAILABLE');
  const installed=new Map(capabilities.adapters.map(a=>[a.id,a]));validateGraph(q.workItems);validateScopeConditions(q.workItems,q.facts);
  async function cite(evidence,label,{siteFact=false}={}){const citations=[];for(const e of evidence){const source=await readDocumentText(documents,e.documentId);if(!source.text.includes(e.quote))throw Error('SCOPE_QUOTE_NOT_IN_DOCUMENT: '+label);if(siteFact&&!['requirements','coordination','architecture_notes','catalog'].includes(source.document.role))throw Error('SCOPE_FACT_SOURCE_ROLE_INVALID');citations.push({...e,textSHA256:source.document.textSHA256});}return citations;}
  const facts=[];for(const fact of q.facts??[]){const {evidence,...value}=fact;facts.push({...value,citations:await cite(evidence,fact.id,{siteFact:fact.status==='interpreted'})});}
  const workItems=[],decisions=[];
  for(const [index,item] of q.workItems.entries()){
   if(item.disposition==='candidate'&&(!item.taskKind||!installed.has(item.taskKind)))throw Error('SCOPE_CANDIDATE_KIND_UNSUPPORTED');
   if(item.disposition==='candidate'&&!intakeKinds.includes(item.taskKind))throw Error('SCOPE_CANDIDATE_INTAKE_UNSUPPORTED: use the separate task adapter; this preparation route is unavailable');
   if(item.disposition==='context'&&(item.taskKind||item.dependsOn.length))throw Error('SCOPE_CONTEXT_CANNOT_PLAN_WORK');
   const citations=await cite(item.evidence,item.id),{evidence,allowInactiveDependencies,...value}=item,edges=[];
   for(const edge of allowInactiveDependencies??[]){const {evidence,...fields}=edge;edges.push({...fields,citations:await cite(evidence,item.id+' dependency '+edge.workItemId)});}
   workItems.push({...value,citations,...(allowInactiveDependencies?{allowInactiveDependencies:edges}:{}),...(item.taskKind&&installed.has(item.taskKind)?{installedCapability:installed.get(item.taskKind)}:{})});
   decisions.push({targetIds:['workItems/'+index],disposition:['unresolved','conflict'].includes(item.disposition)?item.disposition:'supported',citations});
  }
  const coverage=checkSourceCoverage(await documentSetSourceBlocks(documents),workItems.map((value,i)=>({id:'workItems/'+i,value})),decisions,q.sourceCoverage,{required:true});
  const record={schemaVersion:1,jobId,requestSHA256,documents:q.documents,workItems,...(q.facts?{facts}:{}),sourceCoverage:coverage,...scope};
  return persist(record,dir);
 }
 async function verifySelection(selection,documents,kind){
  const record=await load(runs,selection.review);if(digest(record.documents)!==digest(documents))throw Error('SCOPE_DOCUMENT_SET_MISMATCH');
  const view=await summary(runs,record,tasks),item=record.workItems.find(i=>i.id===selection.workItemId);
  if(!view.documentsCurrent)throw Error('SCOPE_DOCUMENT_SET_STALE');
  if(!item||item.disposition!=='candidate'||item.taskKind!==kind)throw Error('SCOPE_WORK_ITEM_NOT_CANDIDATE');
  if(!view.candidates.find(i=>i.id===item.id)?.canPrepareConditions)throw Error('SCOPE_PREPARATION_BLOCKED');
  return {review:selection.review,workItemId:item.id};
 }
 return {run,verifySelection,verifyRecord:reference=>load(runs,reference),async selectionStatus(...args){try{await verifySelection(...args);return {eligible:true};}catch(e){return {eligible:false,reason:e.message};}}};
}
