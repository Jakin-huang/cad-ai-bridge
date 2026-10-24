import {editablePresentation,presentationEditingScope} from './editable-presentation.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {projectDocumentsSchema,readonlyProjectDocumentsSchema} from './project-document-contracts.mjs';
import {dependencyDigest as digest} from './task-dependencies.mjs';
import {atomicJson} from './files.mjs';
import {jobDirectory,jobJson} from './jobs.mjs';
import {documentError} from './document-diagnostics.mjs';
import {createDocumentDraftManager} from './project-document-drafts.mjs';
import {loadDocumentSet,freezeDocumentVersion,readDocumentText,documentTargets,verifyDocumentReview,documentLock,documentSetSourceBlocks,documentCoverage,assertTaskCoveragePolicy} from './project-document-store.mjs';
const page=(items,q)=>{const selected=[];let bytes=0;for(const item of items.slice(q.offset,q.offset+q.limit)){const n=Buffer.byteLength(JSON.stringify(item));if(bytes+n>230*1024){if(!selected.length)throw Error('DOCUMENT_SINGLE_ROW_TOO_LARGE');break;}selected.push(item);bytes+=n;}return {items:selected,total:items.length,offset:q.offset,nextOffset:q.offset+selected.length<items.length?q.offset+selected.length:null};};
const scope={semanticCoverageAccepted:false,professionalApproval:false,authorityVerified:false};
export function createProjectDocumentManager({runs,getInputRoot,taskContext}){
 const drafts=createDocumentDraftManager({runs,context,taskContext,review:run,page});
 async function context(q){const ctx=await loadDocumentSet(runs,q.set,{requireCurrent:true}),task=await taskContext(q.task);if(task.projectId!==q.set.projectId)throw Error('DOCUMENT_PROJECT_MISMATCH');return {ctx,task,targets:documentTargets(task.kind,task.input)};}
 async function run(raw){const q=(process.env.CADBRIDGE_READ_ONLY==='1'?readonlyProjectDocumentsSchema:projectDocumentsSchema).parse(raw);
  if(['draft_review','read_review_draft','commit_review'].includes(q.action))return drafts.run(q);
  if(['create','update'].includes(q.action)){
   const jobId=q.action==='create'?'job-docset-'+q.requestId.toLowerCase():q.set.jobId,dir=path.join(runs,jobId);await fs.mkdir(runs,{recursive:true});if(q.action==='create'){try{await fs.mkdir(dir);}catch(e){if(e.code!=='EEXIST')throw e;const v=await jobJson(dir,'version-0.json'),ref={jobId,projectId:v.projectId,revision:0,sha256:digest(v)};await loadDocumentSet(runs,ref);if(v.requestId!==q.requestId||v.requestSHA256!==digest(q))throw Error('DOCUMENT_REQUEST_CONFLICT_OR_UNCONFIRMED');return {ok:true,set:ref,replayed:true,...scope};}}
   return documentLock(dir,'documents.lock',async()=>{const receiptFile=path.join(dir,'request-'+q.requestId.toLowerCase()+'.json');let receipt;try{receipt=await jobJson(dir,path.basename(receiptFile));}catch(e){if(e.code!=='ENOENT')throw e;}if(receipt){if(receipt.requestSHA256!==digest(q))throw Error('DOCUMENT_REQUEST_CONFLICT');await loadDocumentSet(runs,receipt.set);return {ok:true,set:receipt.set,replayed:true,...scope};}
    const prior=q.action==='update'?await loadDocumentSet(runs,q.set,{requireCurrent:true}):undefined,ref=await freezeDocumentVersion({runs,inputRoot:await getInputRoot(),jobId,projectId:prior?.ref.projectId??q.projectId,revision:prior?prior.ref.revision+1:0,requestId:q.requestId,requestSHA256:digest(q),documents:q.documents,prior,coveragePolicy:q.coveragePolicy});await fs.writeFile(receiptFile,JSON.stringify({requestSHA256:digest(q),set:ref},null,2)+'\n',{flag:'wx'});return {ok:true,set:ref,...scope};
   });
  }
  if(q.action==='source_blocks'){const ctx=await loadDocumentSet(runs,q.set);return {ok:true,set:q.set,current:ctx.current,coveragePolicy:ctx.version.coveragePolicy??'fields_only',...page(await documentSetSourceBlocks(ctx,q.documentId),q),...scope};}
  if(q.action==='read'){const ctx=await loadDocumentSet(runs,q.set);if(q.documentId){const d=await readDocumentText(ctx,q.documentId);const chunks=[];for(let n=0;n<d.text.length;n+=2000)chunks.push({start:n,end:Math.min(n+2000,d.text.length),text:d.text.slice(n,n+2000)});return {ok:true,set:q.set,current:ctx.current,coveragePolicy:ctx.version.coveragePolicy??'fields_only',document:d.document,...page(chunks,q),...scope};}return {ok:true,set:q.set,current:ctx.current,coveragePolicy:ctx.version.coveragePolicy??'fields_only',...page(ctx.version.documents.map(({snapshot,...d})=>d),q),...scope};}
  if(q.action==='read_review'){const record=await verifyDocumentReview(runs,q.review),task=await taskContext(q.task);if(digest(record.task)!==digest(q.task)||record.childJobId!==task.childJobId)throw Error('DOCUMENT_REVIEW_WRONG_TASK_OR_INPUT');const ctx=await loadDocumentSet(runs,record.set),current=ctx.current&&record.inputSHA256===task.inputSHA256,items=q.section==='targets'?record.targets:q.section==='decisions'?record.decisions:q.section==='documents'?record.documentDispositions:q.section==='source_coverage'?(record.sourceCoverage??[]):[{task:record.task,set:record.set,inputSHA256:record.inputSHA256,ready:record.ready,blockers:record.blockers,targetCount:record.targets.length,documentCount:record.documentDispositions.length,sourceCoverage:record.sourceCoverageSummary??null}];return {ok:true,review:q.review,current,section:q.section,...page(items,q),...scope};}
  const c=await context(q),{task,targets,ctx}=c;
  if(q.action==='editable_presentation')return {ok:true,task:q.task,set:q.set,inputSHA256:task.inputSHA256,editablePresentation:editablePresentation(task.input.drawingPresentation,(task.input.rooms??task.input.program).map(r=>r.id)),editing:presentationEditingScope,...scope};
  if(q.action==='targets')return {ok:true,set:q.set,task:q.task,kind:task.kind,inputSHA256:task.inputSHA256,...page(targets,q),...scope,legacyBriefIsNotDocumentAuthority:true};
  if(q.expectedInputSHA256!==task.inputSHA256)throw Error('DOCUMENT_TASK_INPUT_CHANGED');
  if(q.action==='review'){
   if(Buffer.byteLength(JSON.stringify(q))>2*1024*1024||q.decisions.reduce((n,d)=>n+d.citations.length,0)>4096)throw Error('DOCUMENT_REVIEW_BUDGET');
   const byId=new Map(targets.map(t=>[t.id,t])),seen=new Set(),used=new Set(),blockers=[],texts=new Map();const sourceText=async id=>{if(!texts.has(id))texts.set(id,readDocumentText(ctx,id));return texts.get(id);};
   for(const d of q.decisions){const values=d.targetIds.map(id=>{if(seen.has(id)||!byId.has(id))throw Error('DOCUMENT_TARGET_UNKNOWN_OR_DUPLICATE');seen.add(id);return {id,value:byId.get(id).value};});if(digest(values)!==d.expectedValuesSHA256)throw Error('DOCUMENT_TARGET_VALUES_CHANGED');if(['supported','conflict'].includes(d.disposition)&&!d.citations.length)throw Error('DOCUMENT_CITATION_REQUIRED');if(['unresolved','conflict'].includes(d.disposition))blockers.push({targetIds:d.targetIds,disposition:d.disposition});
    for(const citation of d.citations){const source=await sourceText(citation.documentId);if(source.document.textSHA256!==citation.textSHA256||!source.text.includes(citation.quote))throw Error('DOCUMENT_LITERAL_CITATION_INVALID: '+citation.documentId);used.add(citation.documentId);}
   }
   if(seen.size!==targets.length)throw documentError('DOCUMENT_TARGET_COVERAGE_INCOMPLETE',{missingTargetIds:targets.filter(t=>!seen.has(t.id)).map(t=>t.id),expectedCount:targets.length,receivedCount:seen.size,next:'Direct review requires all targets. Use draft_review with previousDraft for incremental patches; commit_review checks the assembled full review.'});
   const inputs=ctx.version.documents.filter(d=>d.role!=='evaluation_only'),dispositions=new Map();for(const d of q.documentDispositions){if(dispositions.has(d.documentId)||!inputs.some(s=>s.id===d.documentId))throw Error('DOCUMENT_DISPOSITION_UNKNOWN_OR_DUPLICATE');if(d.disposition==='used'&&!used.has(d.documentId)||d.disposition==='context'&&used.has(d.documentId))throw Error('DOCUMENT_DISPOSITION_CITATION_MISMATCH');if(d.disposition==='unresolved')blockers.push({documentId:d.documentId,disposition:d.disposition});dispositions.set(d.documentId,d);}
   if(dispositions.size!==inputs.length)throw Error('DOCUMENT_DISPOSITION_COVERAGE_INCOMPLETE');
   const coverage=await documentCoverage(ctx,targets,q.decisions,q.sourceCoverage);blockers.push(...coverage.blockers);
   const jobId='job-docreview-'+q.requestId.toLowerCase(),record={schemaVersion:1,jobId,requestSHA256:digest(q),task:q.task,childJobId:task.childJobId,projectId:task.projectId,kind:task.kind,inputSHA256:task.inputSHA256,set:q.set,targets,decisions:q.decisions,documentDispositions:q.documentDispositions,...(ctx.version.coveragePolicy||q.sourceCoverage?{sourceCoverage:coverage.entries,sourceCoverageSummary:coverage.summary}:{}),ready:!blockers.length,blockers,...scope},review={jobId,sha256:digest(record)},dir=path.join(runs,jobId);
   try{await fs.mkdir(dir);await fs.writeFile(path.join(dir,'review.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;const old=await verifyDocumentReview(runs,review);if(old.requestSHA256!==record.requestSHA256)throw Error('DOCUMENT_REVIEW_REQUEST_CONFLICT');}
   return {ok:true,review,ready:record.ready,blockers,targetCount:targets.length,documentCount:inputs.length,sourceCoverage:coverage.summary,...scope};
  }
  if(q.action==='bind'){
   const record=await verifyDocumentReview(runs,q.review);if(!record.ready)throw Error('DOCUMENT_REVIEW_BLOCKED');if(record.inputSHA256!==task.inputSHA256||record.childJobId!==task.childJobId||record.kind!==task.kind||digest(record.task)!==digest(q.task)||digest(record.set)!==digest(q.set)||digest(record.targets)!==digest(targets))throw Error('DOCUMENT_REVIEW_WRONG_TASK_OR_INPUT');
   const coverage=await documentCoverage(ctx,targets,record.decisions,record.sourceCoverage);if(coverage.blockers.length)throw Error('DOCUMENT_SOURCE_COVERAGE_REQUIRED');
   const parent=await jobDirectory(runs,q.task.jobId),dir=await jobDirectory(runs,task.childJobId);
   return documentLock(parent,'task-scope.lock',()=>documentLock(dir,task.kind==='ordinary-lighting'?'engineering.lock':'document-operation.lock',async()=>{
    const fresh=await context(q);if(fresh.task.inputSHA256!==task.inputSHA256)throw Error('DOCUMENT_TASK_INPUT_CHANGED');
    await assertTaskCoveragePolicy(runs,task.childJobId,fresh.ctx);
    const binding={schemaVersion:1,parentJobId:q.task.jobId,childJobId:task.childJobId,projectId:task.projectId,inputSHA256:task.inputSHA256,set:q.set,review:q.review},bindingSHA256=digest(binding),name='document-bind-'+q.requestId.toLowerCase()+'.json';let prior;try{prior=await jobJson(dir,name);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(prior&&prior.requestSHA256!==digest(q))throw Error('DOCUMENT_BIND_REQUEST_CONFLICT');if(prior){const current=await jobJson(dir,'document-binding.json');return {ok:true,replayed:true,bindingSHA256,active:digest(current)===bindingSHA256,modelRecomputationRequired:!!task.modelSHA256,...scope};}
    try{await fs.writeFile(path.join(dir,'document-required.json'),JSON.stringify({parentJobId:q.task.jobId,projectId:task.projectId}),{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
    if(fresh.ctx.version.coveragePolicy==='fields_and_sources')await atomicJson(path.join(dir,'document-required.json'),{parentJobId:q.task.jobId,projectId:task.projectId,set:q.set,coveragePolicy:'fields_and_sources'});
    await fs.writeFile(path.join(dir,name),JSON.stringify({requestSHA256:digest(q),binding,bindingSHA256},null,2)+'\n',{flag:'wx'});await atomicJson(path.join(dir,'document-binding.json'),binding);return {ok:true,bindingSHA256,modelRecomputationRequired:!!task.modelSHA256,...scope};
   }));
  }
 }
 return {run};
}
