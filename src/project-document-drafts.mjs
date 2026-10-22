// Incremental review is an immutable draft, never a task/input mutation or a
// design approval. Only redundant identities are derived from the caller's
// exact task/input/document snapshot; all interpretations remain explicit.
import fs from 'node:fs/promises';
import path from 'node:path';
import {dependencyDigest as digest} from './task-dependencies.mjs';
import {jobDirectory,jobJson} from './jobs.mjs';
import {loadDocumentSet,readDocumentText,documentSetSourceBlocks,verifyDocumentReview} from './project-document-store.mjs';
import {checkSourceCoverage} from './document-source-coverage.mjs';
import {documentError as fail} from './document-diagnostics.mjs';
const scope={semanticCoverageAccepted:false,professionalApproval:false,authorityVerified:false};
const merge=(old,patch,key)=>[...new Map([...old,...patch].map(row=>[row[key],row])).values()];
export function createDocumentDraftManager({runs,context,taskContext,review,page}){
 async function load(ref){const record=await jobJson(await jobDirectory(runs,ref.jobId),'draft.json');if(record.jobId!==ref.jobId||digest(record)!==ref.sha256)throw fail('DOCUMENT_DRAFT_CHANGED',{draft:ref});return record;}
 function assertScope(record,q,task){if(digest(record.task)!==digest(q.task)||digest(record.set)!==digest(q.set)||record.inputSHA256!==q.expectedInputSHA256||record.childJobId!==task.childJobId)throw fail('DOCUMENT_DRAFT_WRONG_TASK_OR_INPUT',{draftJobId:record.jobId,next:'Start a new draft for this exact task, document set and input revision.'});}
 async function run(q){
  if(q.action==='read_review_draft'){
   const record=await load(q.draft),task=await taskContext(q.task);
   if(digest(record.task)!==digest(q.task)||record.childJobId!==task.childJobId)throw fail('DOCUMENT_DRAFT_WRONG_TASK_OR_INPUT',{draftJobId:record.jobId});
   const ctx=await loadDocumentSet(runs,record.set),current=ctx.current&&record.inputSHA256===task.inputSHA256;
   const items=q.section==='decisions'?record.decisions:q.section==='documents'?record.documentDispositions:q.section==='source_coverage'?record.sourceCoverage:q.section==='missing'?record.missing:[record.summary];
   return {ok:true,draft:q.draft,current,section:q.section,...page(items,q),...scope};
  }
  const {ctx,task,targets}=await context(q);
  if(q.expectedInputSHA256!==task.inputSHA256)throw fail('DOCUMENT_TASK_INPUT_CHANGED',{expected:task.inputSHA256,received:q.expectedInputSHA256});
  if(q.action==='commit_review'){
   const record=await load(q.draft);assertScope(record,q,task);
   // All target/document decisions are needed for a formal review. Source
   // omissions and conflicts can produce an explicit blocked formal review.
   if(record.missing.some(m=>m.kind!=='source'))return {ok:true,committed:false,draft:q.draft,summary:record.summary,next:'Read missing and append explicit decisions using draft_review with previousDraft.',...scope};
   const receipt=path.join(runs,'document-draft-commit-'+q.requestId.toLowerCase()+'.json'),request={requestSHA256:digest(q),draft:q.draft};
   try{await fs.writeFile(receipt,JSON.stringify(request)+'\n',{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;if(digest(JSON.parse(await fs.readFile(receipt,'utf8')))!==digest(request))throw fail('DOCUMENT_DRAFT_COMMIT_REQUEST_CONFLICT',{requestId:q.requestId});}
   // Reuse the exact strict path. No source omission, downgrade or literal
   // citation check is bypassed by draft assembly or a replayed commit.
   const result=await review({action:'review',requestId:q.requestId,task:q.task,set:q.set,expectedInputSHA256:q.expectedInputSHA256,decisions:record.decisions,documentDispositions:record.documentDispositions,sourceCoverage:record.sourceCoverage});
   return {...result,committed:true,draft:q.draft};
  }
  let prior;
  if(q.previousDraft&&q.fromReview)throw fail('DOCUMENT_DRAFT_MULTIPLE_BASES',{next:'Select either previousDraft or fromReview, never both.'});
  if(q.previousDraft){prior=await load(q.previousDraft);assertScope(prior,q,task);}
  if(q.fromReview){
   const base=await verifyDocumentReview(runs,q.fromReview);
   if(digest(base.task)!==digest(q.task)||base.childJobId!==task.childJobId||base.kind!==task.kind||digest(base.set)!==digest(q.set))throw fail('DOCUMENT_DRAFT_REVIEW_SCOPE_CHANGED',{next:'Only the same task and exact document version can seed a review. Changed documents need new source interpretation.'});
   const current=new Map(targets.map(t=>[t.id,t])),old=new Map(base.targets.map(t=>[t.id,t]));
   // A grouped rationale touching any changed value is not carried at all.
   const decisions=base.decisions.filter(d=>d.targetIds.every(id=>current.has(id)&&old.has(id)&&digest(current.get(id).value)===digest(old.get(id).value))).flatMap(d=>d.targetIds.map(id=>({...d,targetIds:[id],expectedValuesSHA256:current.get(id).singleTargetValuesSHA256})));
   prior={decisions,documentDispositions:base.documentDispositions,sourceCoverage:(base.sourceCoverage??[]).filter(e=>e.targetIds.every(id=>current.has(id)))};
  }
  if(!q.fromReview&&!q.decisions.length&&!q.documentDispositions.length&&!q.sourceCoverage.length)throw fail('DOCUMENT_DRAFT_EMPTY_PATCH',{next:'Supply at least one explicit target, document or source decision.'});
  if(Buffer.byteLength(JSON.stringify(q))>512*1024)throw fail('DOCUMENT_DRAFT_PATCH_BUDGET',{maxBytes:512*1024});
  const byTarget=new Map(targets.map(t=>[t.id,t])),blocks=await documentSetSourceBlocks(ctx),byBlock=new Map(blocks.map(b=>[b.blockId,b])),documents=ctx.version.documents.filter(d=>d.role!=='evaluation_only'),byDocument=new Map(documents.map(d=>[d.id,d]));
  const seen=new Set(),patch=[];
  for(const [index,d] of q.decisions.entries()){
   const citations=[];
   for(const [citationIndex,c] of d.citations.entries()){
    const source=await readDocumentText(ctx,c.documentId);
    if(!source.text.includes(c.quote))throw fail('DOCUMENT_LITERAL_CITATION_INVALID',{path:`decisions[${index}].citations[${citationIndex}].quote`,documentId:c.documentId,next:'Use a literal continuous quote from this frozen document.'});
    citations.push({...c,textSHA256:source.document.textSHA256});
   }
   if(['supported','conflict'].includes(d.disposition)&&!citations.length)throw fail('DOCUMENT_CITATION_REQUIRED',{path:`decisions[${index}]`,targetIds:d.targetIds});
   for(const id of d.targetIds){const t=byTarget.get(id);if(!t||seen.has(id))throw fail('DOCUMENT_TARGET_UNKNOWN_OR_DUPLICATE',{path:`decisions[${index}].targetIds`,targetId:id});seen.add(id);patch.push({...d,targetIds:[id],expectedValuesSHA256:t.singleTargetValuesSHA256,citations});}
  }
  const sourceSeen=new Set(),sourcePatch=q.sourceCoverage.map((entry,index)=>{
   const b=byBlock.get(entry.blockId);if(!b||sourceSeen.has(entry.blockId))throw fail('DOCUMENT_SOURCE_BLOCK_UNKNOWN_OR_DUPLICATE',{path:`sourceCoverage[${index}]`,blockId:entry.blockId});sourceSeen.add(entry.blockId);
   if(new Set(entry.targetIds).size!==entry.targetIds.length||entry.targetIds.some(id=>!byTarget.has(id)))throw fail('DOCUMENT_SOURCE_TARGET_UNKNOWN_OR_DUPLICATE',{path:`sourceCoverage[${index}].targetIds`,blockId:entry.blockId});
   return {...entry,blockSHA256:b.blockSHA256};
  });
  const documentSeen=new Set();for(const d of q.documentDispositions){if(!byDocument.has(d.documentId)||documentSeen.has(d.documentId))throw fail('DOCUMENT_DISPOSITION_UNKNOWN_OR_DUPLICATE',{documentId:d.documentId});documentSeen.add(d.documentId);}
  const decisions=merge((prior?.decisions??[]).map(d=>({...d,id:d.targetIds[0]})),patch.map(d=>({...d,id:d.targetIds[0]})),'id').map(({id,...d})=>d),sourceCoverage=merge(prior?.sourceCoverage??[],sourcePatch,'blockId'),documentDispositions=merge(prior?.documentDispositions??[],q.documentDispositions,'documentId');
  if(decisions.length>2000||decisions.reduce((n,d)=>n+d.citations.length,0)>4096||Buffer.byteLength(JSON.stringify({decisions,sourceCoverage,documentDispositions}))>1900*1024)throw fail('DOCUMENT_REVIEW_BUDGET',{next:'Reduce redundant citations while retaining explicit decisions and source coverage.'});
  const targetSeen=new Set(decisions.map(d=>d.targetIds[0])),docSeen=new Set(documentDispositions.map(d=>d.documentId)),covered=new Set(sourceCoverage.map(e=>e.blockId));
  const missing=[...targets.filter(t=>!targetSeen.has(t.id)).map(t=>({kind:'target',id:t.id})),...documents.filter(d=>!docSeen.has(d.id)).map(d=>({kind:'document',id:d.id})),...blocks.filter(b=>!covered.has(b.blockId)).map(b=>({kind:'source',id:b.blockId}))];
  // In a partial draft mapped links may precede their target decisions. Check
  // every available link now; report pending ones instead of losing the patch.
  const pendingLinks=[],checkable=sourceCoverage.map(e=>{if(e.disposition!=='mapped')return e;const missingIds=e.targetIds.filter(id=>!targetSeen.has(id)),available=e.targetIds.filter(id=>targetSeen.has(id));if(missingIds.length)pendingLinks.push({blockId:e.blockId,targetIds:missingIds});return missingIds.length?(available.length?{...e,targetIds:available}:null):e;}).filter(Boolean);
  const coverage=checkSourceCoverage(blocks,targets,decisions,checkable,{required:false});
  for(const e of sourceCoverage){if(e.disposition==='mapped'&&!e.targetIds.length)throw fail('DOCUMENT_SOURCE_MAPPED_TARGET_REQUIRED',{blockId:e.blockId});}
  const used=new Set(decisions.flatMap(d=>d.citations.map(c=>c.documentId))),documentIssues=documentDispositions.filter(d=>d.disposition==='used'&&!used.has(d.documentId)||d.disposition==='context'&&used.has(d.documentId)).map(d=>({documentId:d.documentId,code:'DOCUMENT_DISPOSITION_CITATION_MISMATCH'}));
  const unresolvedTargets=decisions.filter(d=>['unresolved','conflict'].includes(d.disposition)).map(d=>d.targetIds[0]),unresolvedDocuments=documentDispositions.filter(d=>d.disposition==='unresolved').map(d=>d.documentId);
  const summary={targetCount:targets.length,reviewedTargets:decisions.length,documentCount:documents.length,reviewedDocuments:documentDispositions.length,sourceBlockCount:blocks.length,reviewedSourceBlocks:sourceCoverage.length,missingCount:missing.length,pendingLinks,documentIssues,unresolvedTargets,unresolvedDocuments,sourceBlockers:coverage.blockers,complete:!missing.length,readyForReview:!missing.length&&!pendingLinks.length&&!documentIssues.length&&!unresolvedTargets.length&&!unresolvedDocuments.length&&!coverage.blockers.length,...scope};
  const jobId='job-docdraft-'+q.requestId.toLowerCase(),record={schemaVersion:1,jobId,requestSHA256:digest(q),previousDraft:q.previousDraft??null,...(q.fromReview?{fromReview:q.fromReview}:{}),task:q.task,set:q.set,inputSHA256:task.inputSHA256,childJobId:task.childJobId,decisions,documentDispositions,sourceCoverage,missing,summary,...scope},draft={jobId,sha256:digest(record)},dir=path.join(runs,jobId);
  try{await fs.mkdir(dir);await fs.writeFile(path.join(dir,'draft.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;const old=await jobJson(await jobDirectory(runs,jobId),'draft.json');if(digest(old)!==draft.sha256||old.requestSHA256!==digest(q))throw fail('DOCUMENT_DRAFT_REQUEST_CONFLICT_OR_UNCONFIRMED',{requestId:q.requestId});}
  return {ok:true,draft,summary,next:'Append with previousDraft, inspect read_review_draft, then commit_review. Binding and design remain separate operations.',...scope};
 }
 return {run};
}
