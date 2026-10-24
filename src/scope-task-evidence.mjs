import {dependencyDigest as digest} from './task-dependencies.mjs';
import {scopeApplicability,scopeInactivePin} from './scope-applicability.mjs';

// Caller-declared work association, checked against real persisted task state.
// Delivery evidence never establishes semantic, standards or professional acceptance.
export async function scopeTaskEvidence(record,binding,tasks){
 const item=record.workItems.find(i=>i.id===binding.workItemId);
 if(!item||item.disposition!=='candidate')throw Error('SCOPE_TASK_ITEM_NOT_CANDIDATE');
 if(scopeApplicability(record,item).state!=='active')throw Error('SCOPE_WORK_ITEM_NOT_ACTIVE');
 if(digest(binding.prerequisites??[])!==digest(scopePrerequisitePins(record,item)))throw Error('SCOPE_TASK_PREREQUISITE_CHANGED');
 const status=await tasks.run({action:'status',...binding.task});
 if(!status.ok)throw Error('SCOPE_TASK_STATUS_UNAVAILABLE');
 if(status.project.id!==record.documents.projectId||binding.task.expectedProjectId!==record.documents.projectId)throw Error('SCOPE_TASK_PROJECT_MISMATCH');
 if(status.task.kind!==item.taskKind)throw Error('SCOPE_TASK_KIND_MISMATCH');
 const current=status.current,documents=current?.documentEvidence;
 if(!documents?.eligible||digest(documents.set)!==digest(record.documents))throw Error('SCOPE_TASK_DOCUMENTS_NOT_CURRENT_OR_MATCHED');
 if(!current.modelSHA256||current.modelSHA256!==binding.modelSHA256||binding.inputSHA256&&current.inputSHA256!==binding.inputSHA256)throw Error('SCOPE_TASK_MODEL_CHANGED');
 const next=await tasks.run({action:'next_step',...binding.task});
 if(!next.ok||next.phase!=='awaiting_human_review'||next.modelSHA256!==current.modelSHA256)throw Error('SCOPE_TASK_NOT_DELIVERED_FOR_REVIEW');
 if(!current.delivery?.verification?.ok||!current.pdfReview||(current.audit??current.checks)?.failed!==0)throw Error('SCOPE_TASK_DELIVERY_EVIDENCE_MISSING');
 return {...binding,inputSHA256:current.inputSHA256,stage:'delivered_for_review',current:true,professionalApproval:false};
}

function dependencies(record,item,executions){
 const found=new Map(),seen=new Set(),items=new Map(record.workItems.map(i=>[i.id,i])),open=[];
 function visit(id,parent){const row=items.get(id),inactive=scopeInactivePin(record,parent,row);if(inactive){found.set(id,inactive);return;}if(seen.has(id))return;seen.add(id);
  if(row.disposition!=='context'){
   const binding=record.taskBindings?.find(b=>b.workItemId===id),execution=executions?.find(e=>e.workItemId===id),applicability=scopeApplicability(record,row).state;
   if(applicability!=='active'||!binding||executions&&!execution?.current)open.push({id,disposition:row.disposition,applicability,reason:applicability!=='active'?'Prerequisite applicability is '+applicability+'; no explicit inactive-dependency exemption applies':execution?.error??'Prerequisite has no current delivered-for-review evidence in this scope review'});
   if(binding)found.set(id,{workItemId:id,evidenceSHA256:digest(binding)});
  }
  for(const dep of row.dependsOn)visit(dep,row);
 }
 for(const id of item.dependsOn)visit(id,item);return {pins:[...found.values()].sort((a,b)=>a.workItemId.localeCompare(b.workItemId)),open};
}
export function scopeDependencyBlockers(record,item,executions){return dependencies(record,item,executions).open;}
export function scopePrerequisitePins(record,item){
 const {pins,open}=dependencies(record,item);if(open.length)throw Error('SCOPE_TASK_PREREQUISITES_OPEN');return pins;
}

export async function scopeExecutionStates(record,tasks){
 const rows=[];
 for(const binding of record.taskBindings??[]){try{rows.push(await scopeTaskEvidence(record,binding,tasks));}catch(error){rows.push({...binding,current:false,error:error.message,professionalApproval:false});}}
 const byId=new Map(rows.map(r=>[r.workItemId,r])),items=new Map(record.workItems.map(i=>[i.id,i])),done=new Set();
 function check(id){if(done.has(id))return byId.get(id)?.current??false;done.add(id);const row=byId.get(id),item=items.get(id);if(!row?.current)return false;for(const dep of item.dependsOn)if(!scopeInactivePin(record,item,items.get(dep))&&items.get(dep).disposition!=='context'&&!check(dep)){row.current=false;row.error='SCOPE_TASK_PREREQUISITE_NOT_CURRENT';return false;}return true;}
 for(const row of rows)check(row.workItemId);return rows;
}
