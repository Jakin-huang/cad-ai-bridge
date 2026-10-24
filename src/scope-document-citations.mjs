// Original citations consumed by task/standard conditions are design evidence,
// including expressly excluded alternatives. They are not field-review claims.
import {jobDirectory,jobJson} from './jobs.mjs';
import {loadScopeReview} from './engineering-scope-intake.mjs';
import {taskConditionFacts} from './task-condition-facts.mjs';
import {validateSourceFactAgreement} from './source-fact-observations.mjs';

export async function scopeDocumentCitations({runs,binding,standardFactIds=[],requireCurrent=false}){
 const manifest=await jobJson(await jobDirectory(runs,binding.parentJobId),'manifest.json');
 if(!manifest.scope)return undefined;
 const review=await loadScopeReview(runs,manifest.scope.review),item=review.workItems.find(i=>i.id===manifest.scope.workItemId);
 if(!item)throw Error('SOURCE_INDEX_SCOPE_ITEM_MISSING');
 const factIds=[...new Set([...(item.when?.conditions??[]).map(c=>c.factId),...standardFactIds])].sort();
 if(!factIds.length)return undefined;
 const context=await taskConditionFacts({runs,childJobId:binding.childJobId,kind:manifest.task.kind,inputSHA256:binding.inputSHA256,factIds,requireCurrent});
 if(context.state!=='scope_bound')throw Error('SOURCE_INDEX_SCOPE_FACTS_UNBOUND');
 const entries=[{target:'scope/workItems/'+item.id,kind:'work_scope',citations:item.citations}];
 for(const fact of context.facts){
  const base='scope/facts/'+fact.id,agreement=validateSourceFactAgreement(fact);
  entries.push({target:base,kind:'fact',citations:fact.citations});
  for(const o of fact.observations??[])entries.push({target:base+'/observations/'+o.id,kind:agreement.excludedObservationIds.includes(o.id)?'excluded_observation':'selected_observation',citations:o.citations});
  if(fact.resolution)entries.push({target:base+'/resolution',kind:'resolution',citations:fact.resolution.citations});
 }
 return {proof:{scope:manifest.scope,taskJobId:context.taskJobId,taskSHA256:context.taskSHA256,factIds,ledgerSHA256:context.factsSHA256,authorityVerified:false,professionalApproval:false},entries};
}
