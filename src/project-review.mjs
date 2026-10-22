// Aggregate verified task snapshots; never infer absent disciplines or approve a project.
import {dependencyDigest,dependencyPage} from './task-dependencies.mjs';
const sameRef=(a,b)=>!!a&&!!b&&a.jobId===b.jobId&&a.revision===b.revision&&a.sha256.toLowerCase()===b.sha256.toLowerCase();
export function compileProjectReview(q,snapshots){
 const source=snapshots.find(s=>s.status.jobId===q.scopeTaskJobId);
 if(!source?.scope?.providesScope)throw Error('PROJECT_REVIEW_PUBLISHED_SCOPE_REQUIRED');
 const basis=source.scope,issues=[],tasks=[];
 const issue=(code,taskJobId,detail)=>issues.push({code,taskJobId,...detail});
 if(!basis.current)issue('SCOPE_SOURCE_STALE',q.scopeTaskJobId,{});
 for(const snapshot of snapshots){
  const {status:s,graph,scope}=snapshot,c=s.current??{},checks=c.checks??c.audit;
  const currentScope=!!basis.current&&!!scope?.current&&sameRef(scope.ref,basis.ref);
  const unconfirmed=(s.pendingOperations??[]).length>0;
  const documentsCurrent=c.documentEvidence?.current!==false&&c.documentEvidence?.modelCurrent!==false&&c.documentEvidence?.eligible!==false;
  const failedChecks=(graph?.nodes??[]).filter(n=>n.kind==='check'&&(n.value?.ok===false||n.value?.passed===false||n.value?.checks?.some(c=>c.ok===false)));
  const designed=!!c.modelSHA256&&currentScope&&!unconfirmed&&documentsCurrent&&s.executionScope?.eligible!==false&&checks?.failed===0&&!!graph&&graph.conflicts.length===0&&!failedChecks.length;
  const delivered=designed&&c.status==='delivered'&&c.delivery?.verification?.ok===true&&c.delivery.modelSHA256===c.modelSHA256;
  if(!scope)issue('TASK_SCOPE_UNBOUND',s.jobId,{});
  else if(!currentScope)issue('TASK_SCOPE_STALE_OR_DIFFERENT',s.jobId,{boundScope:scope.ref});
  if(unconfirmed)issue('TASK_OPERATION_UNCONFIRMED',s.jobId,{operations:s.pendingOperations.map(o=>({operation:o.operation,requestId:o.requestId}))});
  if(!documentsCurrent)issue('TASK_DOCUMENT_EVIDENCE_STALE',s.jobId,{});
  if(s.executionScope?.eligible===false)issue('TASK_EXECUTION_SCOPE_BLOCKED',s.jobId,{executionScope:s.executionScope});
  if(!designed)issue('CURRENT_DESIGN_NOT_VERIFIED',s.jobId,{});
  if(!delivered)issue('CURRENT_NATIVE_DELIVERY_NOT_VERIFIED',s.jobId,{});
  if(checks?.pending)issue('TASK_CHECKS_PENDING',s.jobId,{count:checks.pending});
  for(const reason of scope?.pending??[])issue('TASK_SCOPE_PENDING',s.jobId,{reason});
  if(!graph)issue('TASK_DEPENDENCIES_UNAVAILABLE',s.jobId,{});
  for(const n of failedChecks)issue('CHECK_RESULT_FAILED',s.jobId,{nodeId:n.id,label:n.label,valueSHA256:dependencyDigest(n.value)});
  for(const n of graph?.nodes??[])if(['source','condition','requirement','standard'].includes(n.kind)&&['assumed','unverified'].includes(n.authority))issue('EVIDENCE_REVIEW_REQUIRED',s.jobId,{nodeId:n.id,kind:n.kind,label:n.label,authority:n.authority,valueSHA256:dependencyDigest(n.value)});
  for(const node of graph?.nodes??[])if(node.kind==='check')for(const pending of node.value?.pending??[])issue('CHECK_ITEM_PENDING',s.jobId,{nodeId:node.id,detail:pending});
  for(const conflict of graph?.conflicts??[])issue('TASK_CONSTRAINT_CONFLICT',s.jobId,{conflict});
  tasks.push({jobId:s.jobId,taskSHA256:s.taskSHA256,kind:s.task.kind,title:s.task.title,revision:c.revision??null,inputSHA256:c.inputSHA256??null,modelSHA256:c.modelSHA256??null,dependencyGraphSHA256:graph?.sha256??null,currentScope,designed,delivered,checks:checks??null,files:(s.files??[]).map(f=>({kind:f.kind,file:f.file,sha256:f.sha256})),professionalApproval:false});
 }
 const spaces=basis.spaces.map(space=>({...space,disciplines:q.requiredKinds.map(kind=>{
  const candidates=snapshots.filter(s=>s.status.task.kind===kind&&s.scope?.spaces.some(r=>r.id===space.id));
  const current=candidates.map(s=>tasks.find(t=>t.jobId===s.status.jobId)).filter(t=>t.currentScope);
  const designedBy=current.filter(t=>t.designed).map(t=>t.jobId),deliveredBy=current.filter(t=>t.delivered).map(t=>t.jobId);
  if(!designedBy.length)issue('SPACE_DESIGN_MISSING',q.scopeTaskJobId,{spaceId:space.id,kind});
  if(!deliveredBy.length)issue('SPACE_DELIVERY_MISSING',q.scopeTaskJobId,{spaceId:space.id,kind});
  if(current.length>1)issue('SPACE_TASK_SELECTION_AMBIGUOUS',q.scopeTaskJobId,{spaceId:space.id,kind,taskJobIds:current.map(t=>t.jobId)});
  return {kind,designedBy,deliveredBy,ambiguous:current.length>1};
 })}));
 const summary={includedTasks:tasks.length,scopeSpaces:spaces.length,requiredKinds:q.requiredKinds,designCoverageComplete:spaces.every(s=>s.disciplines.every(d=>d.designedBy.length===1&&!d.ambiguous)),deliveryCoverageComplete:spaces.every(s=>s.disciplines.every(d=>d.deliveredBy.length===1&&!d.ambiguous)),openIssues:issues.length,issuesByCode:Object.fromEntries([...new Set(issues.map(i=>i.code))].sort().map(code=>[code,issues.filter(i=>i.code===code).length])),professionalApproval:false,engineeringAcceptance:false};
 const report={schemaVersion:1,projectId:q.expectedProjectId,scope:{taskJobId:q.scopeTaskJobId,ref:basis.ref,current:basis.current,spaceIds:spaces.map(s=>s.id)},requiredKinds:q.requiredKinds,tasks,spaces,issues,summary,limitations:['Only explicitly included tasks, published source spaces and caller-required disciplines are assessed; omitted project tasks and disciplines are unknown.','Coverage describes verified current design/native artifacts only. It does not establish source authority, standards applicability, engineering completeness or professional approval.','Read-only sequential snapshot with a second consistency check; no task mutations, CAD jobs or signed review.']};
 return {...report,reportSHA256:dependencyDigest(report)};
}
export function projectReviewPage(report,q){
 if(q.expectedReportSHA256&&q.expectedReportSHA256.toLowerCase()!==report.reportSHA256)throw Error('PROJECT_REVIEW_SNAPSHOT_CHANGED');
 return {ok:true,projectId:report.projectId,reportSHA256:report.reportSHA256,scope:report.scope,summary:report.summary,limitations:report.limitations,section:q.section,...(q.section==='summary'?{}:dependencyPage(report[q.section],q)),professionalApproval:false,engineeringAcceptance:false};
}
