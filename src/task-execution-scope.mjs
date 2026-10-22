import {loadScopeReview} from './engineering-scope-intake.mjs';
import {loadDocumentSet} from './project-document-store.mjs';
import {dependencyDigest as digest} from './task-dependencies.mjs';
import {scopePrerequisitePins,scopeTaskEvidence} from './scope-task-evidence.mjs';

// A task's immutable plan selection restricts future work, never approves its design.
// Check only this item's predecessors: checking every binding would recurse into self.
export async function verifyTaskExecutionScope({runs,manifest,tasks,preparing=false}){
 const selection=manifest.scope;if(!selection)return undefined;
 const record=await loadScopeReview(runs,selection.review),item=record.workItems.find(i=>i.id===selection.workItemId);
 if(!manifest.documents||record.documents.projectId!==manifest.project.id||digest(record.documents)!==digest(manifest.documents))throw Error('SCOPE_DOCUMENT_SET_MISMATCH');
 if(!item||item.disposition!=='candidate'||item.taskKind!==manifest.task.kind)throw Error('SCOPE_WORK_ITEM_NOT_CANDIDATE');
 await loadDocumentSet(runs,record.documents,{requireCurrent:true});
 if(!record.sourceCoverage.summary.complete)throw Error('SCOPE_SOURCE_COVERAGE_INCOMPLETE');
 const prerequisites=scopePrerequisitePins(record,item);
 for(const pin of prerequisites)await scopeTaskEvidence(record,record.taskBindings.find(b=>b.workItemId===pin.workItemId),tasks);
 if(preparing){const previous=record.taskBindings?.find(b=>b.workItemId===item.id);if(previous){let current=false;try{await scopeTaskEvidence(record,previous,tasks);current=true;}catch{}if(current)throw Error('SCOPE_TASK_ALREADY_BOUND');}}
 return {enabled:true,eligible:true,selection,prerequisites,semanticCoverageAccepted:false,professionalApproval:false};
}
