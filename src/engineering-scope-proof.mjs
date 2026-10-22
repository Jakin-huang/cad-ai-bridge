// Scope prose can be corrected without silently changing the engineering
// program. Sources and semantics still need review; physical values are exact.
import path from 'node:path';
import fs from 'node:fs/promises';
import {scopeRevisionParameters} from './engineering-scope-contracts.mjs';
import {engineeringDigest as digest} from './engineering-design.mjs';
import {jobDirectory,jobJson} from './jobs.mjs';
import {hashFile} from './drawings.mjs';
import {taskDocumentStatus,loadDocumentSet,readDocumentText,verifyDocumentReview,documentTargets} from './project-document-store.mjs';

const withoutScope=input=>Object.fromEntries(Object.entries(input).filter(([k])=>k!=='scope'));
async function evidence(docs,items){for(const [index,c] of items.entries()){const d=await readDocumentText(docs,c.documentId);if(!['requirements','coordination','architecture_notes','standard_excerpt','catalog'].includes(d.document.role)||d.document.textSHA256!==c.textSHA256||!d.text.includes(c.quote))throw Error('SCOPE_LITERAL_SOURCE_REQUIRED: '+JSON.stringify({index,documentId:c.documentId,role:d.document.role,expectedTextSHA256:d.document.textSHA256,quoteFound:d.text.includes(c.quote),next:'Use exact current original engineering evidence, including declared catalog assumptions; evaluation-only content is forbidden.'}));}}
export async function compileScopeRevision({runs,state,input,parameters}){
 const q=scopeRevisionParameters.parse(parameters);
 if(q.expectedRevision!==state.revision||q.expectedInputSHA256!==state.inputSHA256||digest(input)!==state.inputSHA256||q.expectedScope!==input.scope)throw Error('SCOPE_INPUT_CHANGED');
 if(q.scope===input.scope)throw Error('SCOPE_NO_CHANGE');
 if(input.briefRevision?.requiredConditionKeys.includes('project_context'))throw Error('SCOPE_CARRIED_CONTEXT_REQUIRES_SOURCE_REVISION');
 const status=await taskDocumentStatus({runs,childJobId:state.jobId,inputSHA256:state.inputSHA256,requireCurrent:true});if(!status?.review)throw Error('SCOPE_CURRENT_DOCUMENT_REVIEW_REQUIRED');
 const review=await verifyDocumentReview(runs,status.review),docs=await loadDocumentSet(runs,status.set,{requireCurrent:true});
 if(review.kind!=='ordinary-lighting'||review.childJobId!==state.jobId||review.inputSHA256!==state.inputSHA256||digest(review.targets)!==digest(documentTargets('ordinary-lighting',input)))throw Error('SCOPE_REVIEW_WRONG_INPUT');
 await evidence(docs,q.evidence);const nextInput={...structuredClone(input),scope:q.scope};
 if(digest(withoutScope(nextInput))!==digest(withoutScope(input)))throw Error('SCOPE_ENGINEERING_CONDITIONS_CHANGED');
 return {kind:'ordinary-lighting',childJobId:state.jobId,fromRevision:state.revision,fromInputSHA256:state.inputSHA256,inputSHA256:digest(nextInput),parameters:q,documents:status.set,priorReview:status.review,nextInput,semanticCoverageAccepted:false,professionalApproval:false};
}
export async function retainScopeRecord({dir,requestId,record}){const name='scope-change-'+requestId.toLowerCase()+'.json',file=path.join(dir,name),bytes=JSON.stringify(record,null,2)+'\n';try{await fs.writeFile(file,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||await fs.readFile(file,'utf8')!==bytes)throw Error('SCOPE_REVISION_UNCONFIRMED');}return {requestId:requestId.toLowerCase(),file:name,fileSHA256:await hashFile(file)};}
export async function verifyScopeHistory({runs,state}){
 for(const item of state.scopeRevisions??[]){
  if(!/^[a-f0-9-]{36}$/.test(item.requestId)||item.file!=='scope-change-'+item.requestId+'.json')throw Error('SCOPE_HISTORY_ID_INVALID');
  const dir=await jobDirectory(runs,state.jobId),file=path.join(dir,item.file);if(await hashFile(file)!==item.fileSHA256)throw Error('SCOPE_HISTORY_CHANGED');
  const record=await jobJson(dir,item.file),q=scopeRevisionParameters.parse(record.parameters);
  if(!Number.isSafeInteger(record.fromRevision)||record.fromRevision<0||record.fromRevision+1>state.revision)throw Error('SCOPE_HISTORY_REVISION_INVALID');
  const before=await jobJson(dir,'input-'+record.fromRevision+'.json'),after=await jobJson(dir,'input-'+(record.fromRevision+1)+'.json');
  if(record.childJobId!==state.jobId||record.kind!=='ordinary-lighting'||q.expectedRevision!==record.fromRevision||q.expectedInputSHA256!==record.fromInputSHA256||digest(before)!==record.fromInputSHA256||digest(after)!==record.inputSHA256||before.scope!==q.expectedScope||after.scope!==q.scope||digest(withoutScope(before))!==digest(withoutScope(after)))throw Error('SCOPE_HISTORY_INPUT_CHANGED');
  const prior=await verifyDocumentReview(runs,record.priorReview);if(prior.childJobId!==state.jobId||prior.inputSHA256!==record.fromInputSHA256||digest(prior.set)!==digest(record.documents))throw Error('SCOPE_HISTORY_REVIEW_CHANGED');
  await evidence(await loadDocumentSet(runs,record.documents),q.evidence);
 }
}
