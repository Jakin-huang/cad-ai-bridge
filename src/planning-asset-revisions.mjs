// A same-task physical revision. Literal evidence is checked; source authority
// and engineering meaning remain unverified and require the normal new review.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {planningAssetsSchema} from './planning-assets.mjs';
import {documentSetRefSchema} from './project-document-contracts.mjs';
import {dependencyDigest as digest} from './task-dependencies.mjs';
import {loadDocumentSet,readDocumentText,taskDocumentStatus,verifyDocumentReview} from './project-document-store.mjs';
import {verifyDrawingPresentation,compileDrawingPresentation} from './drawing-presentation-evidence.mjs';
import {presentationParameters} from './drawing-presentation.mjs';
import {jobDirectory,jobJson} from './jobs.mjs';
import {hashFile} from './drawings.mjs';
const sha=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,47}$/);
export const assetRevisionParameters=z.strictObject({
 expectedRevision:z.number().int().nonnegative(),expectedInputSHA256:sha,documents:documentSetRefSchema,
 brief:z.string().min(30).max(30000),assets:planningAssetsSchema,presentation:presentationParameters.optional().describe('Required for new revisions of tasks with drawingPresentation. Re-read notes against the amended conditions; title, descriptive scope and space IDs must remain the same.'),
 changes:z.array(z.strictObject({assetId:id,kind:z.enum(['add','update','remove']),expectedAssetSHA256:sha.optional(),retentionAction:z.enum(['unchanged','establish','relocate','release','remove']),reason:z.string().min(10).max(1000),evidence:z.array(z.strictObject({documentId:z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),textSHA256:sha,quote:z.string().min(5).max(2000)})).min(1).max(10)})).min(1).max(64),
 reason:z.string().min(10).max(1000)
});
const assetValue=a=>Object.fromEntries(Object.entries(a).filter(([k])=>k!=='sourceIds'));
const equal=(a,b)=>a===undefined||b===undefined?a===b:digest(a)===digest(b);
export function assetRevisionDelta(before,after){
 const old=new Map((before??[]).map(a=>[a.id,a])),next=new Map(after.map(a=>[a.id,a]));
 if(next.size!==after.length)throw Error('ASSET_REVISION_DUPLICATE_ID');
 return [...new Set([...old.keys(),...next.keys()])].flatMap(assetId=>{
  const a=old.get(assetId),b=next.get(assetId);if(a&&b&&equal(assetValue(a),assetValue(b))){if(!equal(a.sourceIds,b.sourceIds))throw Error('ASSET_REVISION_UNDECLARED_SOURCE_CHANGE');return [];}
  return [{assetId,kind:!a?'add':!b?'remove':'update',...(a?{expectedAssetSHA256:digest(a)}:{}),retentionAction:!a?.fixed?(b?.fixed?'establish':'unchanged'):!b?'remove':!b.fixed?'release':!equal(a.fixed,b.fixed)||a.roomId!==b.roomId?'relocate':'unchanged'}];
 });
}
export async function applyAssetRevision({runs,input,parameters,priorDocuments}){
 const q=assetRevisionParameters.parse(parameters),old=await loadDocumentSet(runs,priorDocuments),docs=await loadDocumentSet(runs,q.documents);
 if(q.documents.jobId!==old.ref.jobId||q.documents.projectId!==old.ref.projectId||q.documents.revision<=old.ref.revision)throw Error('ASSET_REVISION_NEW_SOURCE_VERSION_REQUIRED');
 const delta=assetRevisionDelta(input.assets,q.assets);
 if(!delta.length)throw Error('ASSET_REVISION_NO_CHANGE');
 if(new Set(q.changes.map(c=>c.assetId)).size!==q.changes.length||q.changes.length!==delta.length)throw Error('ASSET_REVISION_CHANGE_COVERAGE');
 for(const d of delta){
  const c=q.changes.find(c=>c.assetId===d.assetId),a=input.assets?.find(a=>a.id===d.assetId),b=q.assets.find(a=>a.id===d.assetId);
  if(!c||['kind','expectedAssetSHA256','retentionAction'].some(k=>c[k]!==d[k]))throw Error('ASSET_REVISION_CHANGE_MISMATCH: '+d.assetId);
  if(a&&b&&['assumed','unresolved'].includes(a.status)&&b.status!==a.status)throw Error('ASSET_REVISION_GRADE_UPGRADE');
  let changedEvidence=false,retentionEvidence=false,assetQuote=!b;
  for(const e of c.evidence){
   const {document,text}=await readDocumentText(docs,e.documentId);
   if(e.textSHA256!==document.textSHA256||!text.includes(e.quote)||!['requirements','coordination','architecture_notes','catalog'].includes(document.role))throw Error('ASSET_REVISION_LITERAL_EVIDENCE_REQUIRED');
   if(!new RegExp('(^|[^A-Za-z0-9_-])'+d.assetId+'([^A-Za-z0-9_-]|$)').test(e.quote))throw Error('ASSET_REVISION_ASSET_ID_WITNESS_REQUIRED');
   const changed=old.version.documents.find(o=>o.id===document.id)?.textSHA256!==document.textSHA256;
   changedEvidence ||= changed;
   retentionEvidence ||= changed&&['coordination','architecture_notes'].includes(document.role);
   assetQuote ||= changed&&e.quote.includes(b.evidenceQuote);
  }
  if(!changedEvidence||!assetQuote)throw Error('ASSET_REVISION_NEW_LITERAL_EVIDENCE_REQUIRED');
  if((a?.fixed||b?.fixed)&&!retentionEvidence)throw Error('ASSET_REVISION_RETENTION_SOURCE_REQUIRED');
 }
 const sourceId='BRIEF_R'+(q.expectedRevision+1),oldIds=new Set(input.sources.filter(s=>s.role==='brief'&&!s.supersededBy).map(s=>s.id));
 if(input.sources.some(s=>s.id===sourceId)||!oldIds.size)throw Error('ASSET_REVISION_BRIEF_ID_CONFLICT');
 const rebind=item=>({...item,sourceIds:[...item.sourceIds.filter(id=>!oldIds.has(id)),sourceId]});
 const next={...structuredClone(input),brief:q.brief,sources:[...input.sources.map(s=>oldIds.has(s.id)?{...s,supersededBy:sourceId}:s),{id:sourceId,role:'brief',sha256:crypto.createHash('sha256').update(q.brief).digest('hex'),description:q.reason,derivedFromFinalDrawing:input.sources.some(s=>oldIds.has(s.id)&&s.derivedFromFinalDrawing)}],assets:q.assets.map(rebind),program:input.program.map(rebind),relations:input.relations.map(rebind),parameters:rebind(input.parameters),shell:rebind(input.shell),missingInputs:input.missingInputs.map(rebind),...(input.selection?{selection:rebind(input.selection)}:{})};
 // New operations explicitly reconcile notes against amended conditions. Keep
 // legacy history reproducible; title/scope/program changes use other protocols.
 if(q.presentation){if(!input.drawingPresentation)throw Error('ASSET_REVISION_PRESENTATION_BASE_REQUIRED');const p=await compileDrawingPresentation(q.presentation,docs);if(p.title.text!==input.title||p.scope.text!==input.drawingPresentation.scope.text||digest([...p.spaceIds].sort())!==digest([...(input.drawingPresentation.spaceIds??input.program.map(r=>r.id))].sort()))throw Error('ASSET_REVISION_PRESENTATION_SCOPE_CHANGE');next.drawingPresentation=p;}else if(next.drawingPresentation)next.drawingPresentation.documents=q.documents;
 if(next.drawingPresentation)await verifyDrawingPresentation(next,{runs,documents:q.documents});
 return {nextInput:next,changes:delta,documents:q.documents,sourceAuthorityVerified:false,professionalApproval:false};
}
export async function compileAssetRevision({runs,childJobId,input,inputSHA256,parameters}){
 const q=assetRevisionParameters.parse(parameters);if(digest(input)!==inputSHA256||q.expectedInputSHA256!==inputSHA256)throw Error('ASSET_REVISION_INPUT_CHANGED');
 if(input.drawingPresentation&&!q.presentation)throw Error('ASSET_REVISION_PRESENTATION_REVIEW_REQUIRED');
 const status=await taskDocumentStatus({runs,childJobId,inputSHA256});if(!status?.reviewReady||!status.inputCurrent)throw Error('ASSET_REVISION_PRIOR_INPUT_REVIEW_REQUIRED');
 await loadDocumentSet(runs,q.documents,{requireCurrent:true});
 const prior=await verifyDocumentReview(runs,status.review);if(prior.kind!=='office-space-planning'||prior.childJobId!==childJobId)throw Error('ASSET_REVISION_PRIOR_REVIEW_CHANGED');
 return {...await applyAssetRevision({runs,input,parameters:q,priorDocuments:status.set}),parameters:q,priorReview:status.review,priorDocuments:status.set};
}
export async function retainAssetRevision({dir,requestId,record}){
 const file='asset-change-'+requestId.toLowerCase()+'.json';await fs.writeFile(path.join(dir,file),JSON.stringify(record,null,2)+'\n',{flag:'wx'});return {requestId:requestId.toLowerCase(),file,fileSHA256:await hashFile(path.join(dir,file))};
}
export async function verifyAssetRevisionHistory({runs,state,parseInput}){
 for(const e of state.assetRevisions??[]){
  if(!/^[a-f0-9-]{36}$/.test(e.requestId)||e.file!=='asset-change-'+e.requestId+'.json')throw Error('ASSET_REVISION_HISTORY_ID_INVALID');
  const dir=await jobDirectory(runs,state.jobId);if(await hashFile(path.join(dir,e.file))!==e.fileSHA256)throw Error('ASSET_REVISION_HISTORY_CHANGED');
  const r=await jobJson(dir,e.file),q=assetRevisionParameters.parse(r.parameters);
  if(r.childJobId!==state.jobId||!Number.isSafeInteger(r.fromRevision)||r.fromRevision<0||r.fromRevision+1>state.revision||q.expectedRevision!==r.fromRevision||q.expectedInputSHA256!==r.fromInputSHA256)throw Error('ASSET_REVISION_HISTORY_IDENTITY_CHANGED');
  const before=parseInput(await jobJson(dir,'input-'+r.fromRevision+'.json')),after=parseInput(await jobJson(dir,'input-'+(r.fromRevision+1)+'.json'));
  if(digest(before)!==r.fromInputSHA256||digest(after)!==r.inputSHA256)throw Error('ASSET_REVISION_HISTORY_INPUT_CHANGED');
  const prior=await verifyDocumentReview(runs,r.priorReview);if(prior.childJobId!==state.jobId||prior.kind!=='office-space-planning'||prior.inputSHA256!==r.fromInputSHA256||!equal(prior.set,r.priorDocuments))throw Error('ASSET_REVISION_HISTORY_REVIEW_CHANGED');
  const compiled=await applyAssetRevision({runs,input:before,parameters:q,priorDocuments:r.priorDocuments});if(!equal(parseInput(compiled.nextInput),after)||!equal(compiled.changes,r.changes))throw Error('ASSET_REVISION_HISTORY_DELTA_CHANGED');
 }
}
