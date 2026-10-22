import {dependencyDigest} from './task-dependencies.mjs';

// A read-only continuation over existing durable task state. No project-label routing.
export function engineeringAgentStep({snapshot,graph,workflow,operations,options={}}){
 const c=snapshot.current,issues=[],binding={jobId:snapshot.jobId,expectedProjectId:snapshot.project.id,expectedTaskSHA256:snapshot.taskSHA256};
 const base={ok:true,task:binding,kind:snapshot.task.kind,revision:c?.revision??null,inputSHA256:c?.inputSHA256??null,modelSHA256:c?.modelSHA256??null,readOnly:true,semanticAcceptance:false,engineeringAcceptance:false,professionalApproval:false,reviewStatus:'awaiting_human_review',pendingCount:(c?.audit??c?.checks)?.pending??0};
 const result=(phase,next=null)=>{const body={...base,phase,issues,next};return {...body,snapshotSHA256:dependencyDigest(body)};};
 const block=(code,detail)=>{issues.push({code,detail});return result('blocked');};
 if(snapshot.pendingOperations?.length)return block('OPERATION_UNCONFIRMED',snapshot.pendingOperations);
 if(snapshot.executionScope?.eligible===false)return block('SCOPE_EXECUTION_BLOCKED',snapshot.executionScope);
 if(snapshot.lastFailure)return block('LAST_OPERATION_FAILED',snapshot.lastFailure);
 if(!c)return block('TASK_NOT_PREPARED','Read the preparation receipt; no operation can be inferred.');
 if(c.documentEvidence?.enabled&&!c.documentEvidence.eligible)return block('SOURCE_REVIEW_REQUIRED',c.documentEvidence);
 if(c.spaceProgram&&c.spaceProgram.current===false)return block('UPSTREAM_SPACES_STALE',c.spaceProgram);
 if(graph?.conflicts?.length)return block('DEPENDENCY_CONFLICT',graph.conflicts);
 if(!workflow)return block('AGENT_WORKFLOW_UNAVAILABLE','Use the adapter capabilities; no fallback selected.');
 if(['delivery_unconfirmed','quality_interrupted','quality_assessing','delivering'].includes(c.status))return block('EXECUTION_REQUIRES_INSPECTION',{status:c.status});
 if(workflow.inputIssues?.length)return block('INPUT_REQUIRES_CORRECTION',workflow.inputIssues);
 const checks=c.audit??c.checks;if(checks?.failed>0)return block('DESIGN_CHECK_FAILED',checks);
 if(['blocked_input','blocked','quality_blocked','bounded_family_exhausted','budget_exhausted'].includes(c.status))return block('DESIGN_REQUIRES_CORRECTION',{status:c.status,study:c.study,checks});
 const propose=(phase,operation,parameters)=>{
  if(!operations[operation])return block('OPERATION_UNAVAILABLE',operation);
  const validated=operations[operation].parse(parameters);
  return result(phase,{tool:'cad_engineering_task',arguments:{action:'invoke',...binding,operation,parameters:validated},requiresNewRequestId:true,nativeWrite:operation==='deliver'});
 };
 if(!c.modelSHA256){
  if(workflow.analysis){if(c.status==='analysis_completed')return result('awaiting_human_review');return propose('analysis','analyze',{});}
  return propose('design',workflow.designOperation,{expectedRevision:c.revision,expectedInputSHA256:c.inputSHA256,...(workflow.designOperation==='design'&&options.designBudget?{budget:options.designBudget}:{})});
 }
 if(workflow.qualityRequired&&(!c.lightingQuality?.passed||c.lightingQuality.modelSHA256!==c.modelSHA256)){if(!c.lightingQuality)return propose('quality','assess_lighting',{expectedModelSHA256:c.modelSHA256});return block('PHOTOMETRIC_QUALITY_REQUIRED','Read quality results and use the installed lighting solve/assessment/revision operations before delivery.');}
 if(!checks||checks.failed!==0)return block('DESIGN_CHECK_EVIDENCE_REQUIRED','No passing design-check summary for this model.');
 if(!c.delivery)return propose('delivery','deliver',{expectedModelSHA256:c.modelSHA256});
 if(!c.delivery.verification?.ok)return block('NATIVE_VERIFICATION_REQUIRED',c.delivery.verification??null);
 if(!c.pdfReview){if(!c.pdfReviewSourceSHA256)return block('PDF_SOURCE_MISSING','Delivery has no current PDF source digest.');return propose('review_pdfs','review_pdfs',{expectedModelSHA256:c.modelSHA256,expectedSourceSHA256:c.pdfReviewSourceSHA256});}
 return result('awaiting_human_review');
}
