// Original document snapshots and mechanical coverage checks. A literal quote is
// evidence of what was cited, never proof that the interpretation is correct.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {TextDecoder} from 'node:util';
import {atomicJson} from './files.mjs';
import {hashFile,isWithin} from './drawings.mjs';
import {jobDirectory,jobJson} from './jobs.mjs';
import {dependencyDigest as digest} from './task-dependencies.mjs';
import {documentSetRefSchema} from './project-document-contracts.mjs';
import {documentSourceBlocks,checkSourceCoverage} from './document-source-coverage.mjs';
export const documentBytesSHA=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export async function documentLock(dir,name,work){const file=path.join(dir,name);let lease;try{lease=await fs.open(file,'wx');}catch(e){if(e.code==='EEXIST')throw Error('DOCUMENT_OPERATION_BUSY_OR_UNCONFIRMED');throw e;}try{await lease.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));return await work();}finally{await lease.close();await fs.unlink(file);}}
export async function loadDocumentSet(runs,raw,{requireCurrent=false}={}){
 const ref=documentSetRefSchema.parse(raw),dir=await jobDirectory(runs,ref.jobId),head=await jobJson(dir,'head.json'),version=await jobJson(dir,'version-'+ref.revision+'.json');
 if(version.projectId!==ref.projectId||version.jobId!==ref.jobId||version.revision!==ref.revision||digest(version)!==ref.sha256)throw Error('DOCUMENT_SET_CHANGED');
 if(head.projectId!==ref.projectId||head.jobId!==ref.jobId)throw Error('DOCUMENT_SET_IDENTITY_CHANGED');
 const current=head.revision===ref.revision&&head.sha256===ref.sha256;if(requireCurrent&&!current)throw Error('DOCUMENT_SET_STALE');
 let chain=version;for(let n=ref.revision-1;n>=0;n--){const previous=await jobJson(dir,'version-'+n+'.json');if(chain.previous?.revision!==n||chain.previous?.projectId!==ref.projectId||chain.previous?.jobId!==ref.jobId||digest(previous)!==chain.previous?.sha256)throw Error('DOCUMENT_HISTORY_CHANGED');chain=previous;}if(chain.previous!==null)throw Error('DOCUMENT_HISTORY_CHANGED');
 for(const d of version.documents){const file=await fs.realpath(path.join(dir,d.snapshot));if(!isWithin(dir,file)||await hashFile(file)!==d.rawSHA256)throw Error('DOCUMENT_SNAPSHOT_CHANGED');}
 return {ref,dir,head,version,current};
}
export async function freezeDocumentVersion(options){const policyDir=path.join(options.runs,'job-docpolicy-'+options.projectId.toLowerCase());await fs.mkdir(policyDir,{recursive:true});return documentLock(policyDir,'policy.lock',()=>freezeVersion({...options,policyDir}));}
async function freezeVersion({runs,inputRoot,jobId,projectId,revision,requestId,requestSHA256,documents,prior,policyDir,coveragePolicy}){
 coveragePolicy=coveragePolicy??prior?.version.coveragePolicy??(prior?'fields_only':'fields_and_sources');
 if(prior?.version.coveragePolicy==='fields_and_sources'&&coveragePolicy!=='fields_and_sources')throw Error('DOCUMENT_SOURCE_COVERAGE_DOWNGRADE');
 const root=await fs.realpath(inputRoot),dir=path.join(runs,jobId),frozen=[];
 let policy;try{policy=await jobJson(policyDir,'policy.json');}catch(e){if(e.code!=='ENOENT')throw e;policy={projectId,evaluationSHA256:[],inputSHA256:[]};}if(policy.projectId!==projectId)throw Error('DOCUMENT_POLICY_PROJECT_CHANGED');
 // Both document identities and all earlier evaluation bytes remain quarantined.
 const evaluationIds=new Set(),evaluationSHA=new Set(policy.evaluationSHA256);
 for(let n=0;n<= (prior?.version.revision??-1);n++){const v=await jobJson(dir,'version-'+n+'.json');for(const d of v.documents)if(d.role==='evaluation_only'){evaluationIds.add(d.id);evaluationSHA.add(d.rawSHA256);if(d.textSHA256)evaluationSHA.add(d.textSHA256);}}
 for(const d of documents){const file=await fs.realpath(path.resolve(root,d.file));if(!isWithin(root,file))throw Error('DOCUMENT_INPUT_OUTSIDE_ROOT');const stat=await fs.stat(file);if(!stat.isFile()||stat.size>2*1024*1024)throw Error('DOCUMENT_FILE_BUDGET');const bytes=await fs.readFile(file),rawSHA256=documentBytesSHA(bytes);if(bytes.length>2*1024*1024)throw Error('DOCUMENT_FILE_BUDGET');if(rawSHA256!==d.expectedRawSHA256)throw Error('DOCUMENT_SOURCE_CHANGED');
  let text;if(d.role!=='evaluation_only'&&!['.txt','.md'].includes(path.extname(file).toLowerCase()))throw Error('DOCUMENT_TEXT_FORMAT_REQUIRED');if(['.txt','.md'].includes(path.extname(file).toLowerCase())){try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes).replace(/^\uFEFF/,'');}catch{throw Error('DOCUMENT_UTF8_REQUIRED');}if(!text.length||text.length>500000)throw Error('DOCUMENT_TEXT_BUDGET');}
  const textSHA256=text===undefined?undefined:documentBytesSHA(text);if(d.role!=='evaluation_only'&&(evaluationIds.has(d.id)||evaluationSHA.has(rawSHA256)||evaluationSHA.has(textSHA256)))throw Error('DOCUMENT_EVALUATION_INPUT_LEAK');
  frozen.push({id:d.id,title:d.title,versionLabel:d.versionLabel,role:d.role,rawSHA256,...(textSHA256?{textSHA256,textLength:text.length}:{}),snapshot:'snapshot-'+rawSHA256+'.bin',bytes:bytes.length,authority:'declared_unverified',_bytes:bytes});
 }
 if(new Set(frozen.map(d=>d.id)).size!==frozen.length)throw Error('DOCUMENT_DUPLICATE_ID');
 const evalBytes=new Set(frozen.filter(d=>d.role==='evaluation_only').flatMap(d=>[d.rawSHA256,d.textSHA256].filter(Boolean)));if(frozen.some(d=>d.role!=='evaluation_only'&&(evalBytes.has(d.rawSHA256)||evalBytes.has(d.textSHA256))))throw Error('DOCUMENT_EVALUATION_INPUT_LEAK');
 if([...evalBytes].some(sha=>policy.inputSHA256.includes(sha)))throw Error('DOCUMENT_EVALUATION_ALREADY_USED_AS_INPUT');
 if(frozen.reduce((n,d)=>n+d.bytes,0)>8*1024*1024)throw Error('DOCUMENT_SET_BUDGET');
 // Reserve provenance before publication. An interrupted write is conservative:
 // reserved evaluation bytes never become generation inputs in another set.
 policy.evaluationSHA256=[...new Set([...policy.evaluationSHA256,...evalBytes])].sort();policy.inputSHA256=[...new Set([...policy.inputSHA256,...frozen.filter(d=>d.role!=='evaluation_only').flatMap(d=>[d.rawSHA256,d.textSHA256].filter(Boolean))])].sort();await atomicJson(path.join(policyDir,'policy.json'),policy);
 for(const d of frozen){const bytes=d._bytes;delete d._bytes;try{await fs.writeFile(path.join(dir,d.snapshot),bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||await hashFile(path.join(dir,d.snapshot))!==d.rawSHA256)throw Error('DOCUMENT_SNAPSHOT_PUBLICATION_UNCONFIRMED');}}
 const version={schemaVersion:1,jobId,projectId,revision,requestId,requestSHA256,previous:prior?.ref??null,documents:frozen,coveragePolicy,semanticCoverageAccepted:false,professionalApproval:false},ref={jobId,projectId,revision,sha256:digest(version)};
 await fs.writeFile(path.join(dir,'version-'+revision+'.json'),JSON.stringify(version,null,2)+'\n',{flag:'wx'});await atomicJson(path.join(dir,'head.json'),ref);return ref;
}
export async function readDocumentText(ctx,id){const d=ctx.version.documents.find(d=>d.id===id);if(!d)throw Error('DOCUMENT_ID_UNKNOWN');if(d.role==='evaluation_only')throw Error('DOCUMENT_EVALUATION_CONTENT_FORBIDDEN');const bytes=await fs.readFile(path.join(ctx.dir,d.snapshot));if(documentBytesSHA(bytes)!==d.rawSHA256)throw Error('DOCUMENT_SNAPSHOT_CHANGED');const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes).replace(/^\uFEFF/,'');if(documentBytesSHA(text)!==d.textSHA256)throw Error('DOCUMENT_TEXT_CHANGED');return {document:d,text};}
export function documentTargets(kind,input){
 if(!['ordinary-lighting','office-space-planning'].includes(kind))throw Error('DOCUMENT_TASK_KIND_UNSUPPORTED');
 // Enumerate every actual input field, including geometry, physical assumptions,
 // standards, missing inputs and derived legacy summaries. Clients cannot submit
 // a conveniently smaller target list or silently substitute field values.
 const rows=[];for(const [key,value] of Object.entries(input)){if(Array.isArray(value)&&value.length)for(let i=0;i<value.length;i++)rows.push({id:key+'/'+i,value:value[i]});else rows.push({id:key,value});}
 if(rows.length>2000)throw Error('DOCUMENT_TARGET_BUDGET');return rows.map(r=>({...r,valueSHA256:digest(r.value),singleTargetValuesSHA256:digest([{id:r.id,value:r.value}])}));
}
export async function verifyDocumentReview(runs,ref){const dir=await jobDirectory(runs,ref.jobId),record=await jobJson(dir,'review.json');if(digest(record)!==ref.sha256||record.jobId!==ref.jobId)throw Error('DOCUMENT_REVIEW_CHANGED');return record;}
export async function documentSetSourceBlocks(ctx,documentId){
 const docs=documentId?[ctx.version.documents.find(d=>d.id===documentId)]:ctx.version.documents.filter(d=>d.role!=='evaluation_only');
 if(docs.some(d=>!d))throw Error('DOCUMENT_ID_UNKNOWN');const blocks=[];
 for(const d of docs){const {text}=await readDocumentText(ctx,d.id);blocks.push(...documentSourceBlocks(d,text));if(blocks.length>5000)throw Error('DOCUMENT_SOURCE_BLOCK_BUDGET');}
 return blocks;
}
export async function documentCoverage(ctx,targets,decisions,entries){return checkSourceCoverage(await documentSetSourceBlocks(ctx),targets,decisions,entries,{required:ctx.version.coveragePolicy==='fields_and_sources'});}
export async function assertTaskCoveragePolicy(runs,childJobId,ctx){
 if(ctx.version.coveragePolicy==='fields_and_sources')return;
 const dir=await jobDirectory(runs,childJobId);
 for(const file of [path.join(dir,'document-required.json'),path.join(runs,'document-required-'+childJobId+'.json')]){
  let marker;try{marker=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
  if(marker.coveragePolicy==='fields_and_sources'||marker.set&&(await loadDocumentSet(runs,marker.set)).version.coveragePolicy==='fields_and_sources')throw Error('DOCUMENT_TASK_COVERAGE_DOWNGRADE');
 }
}
export async function taskDocumentStatus({runs,childJobId,inputSHA256,modelSHA256,modelBindingSHA256,requireCurrent=false,requireModel=false}){
 const dir=await jobDirectory(runs,childJobId);let binding;try{binding=await jobJson(dir,'document-binding.json');}catch(e){if(e.code==='ENOENT'){for(const marker of [path.join(dir,'document-required.json'),path.join(runs,'document-required-'+childJobId+'.json')]){try{await fs.stat(marker);throw Error('DOCUMENT_REQUIRED_BINDING_MISSING');}catch(missing){if(missing.code!=='ENOENT')throw missing;}}return undefined;}throw e;}
 const ctx=await loadDocumentSet(runs,binding.set),review=binding.review?await verifyDocumentReview(runs,binding.review):undefined;await assertTaskCoveragePolicy(runs,childJobId,ctx);
 if(binding.childJobId!==childJobId||binding.projectId!==binding.set.projectId)throw Error('DOCUMENT_TASK_BINDING_CHANGED');
 if(review&&(review.childJobId!==childJobId||review.task.jobId!==binding.parentJobId||review.projectId!==binding.projectId||digest(review.set)!==digest(binding.set)||review.inputSHA256!==binding.inputSHA256||!review.ready))throw Error('DOCUMENT_REVIEW_BINDING_CHANGED');
 if(review&&ctx.version.coveragePolicy==='fields_and_sources'){const coverage=await documentCoverage(ctx,review.targets,review.decisions,review.sourceCoverage);if(coverage.blockers.length||digest(coverage.summary)!==digest(review.sourceCoverageSummary))throw Error('DOCUMENT_SOURCE_COVERAGE_CHANGED');}
 const bindingSHA256=digest(binding),inputCurrent=binding.inputSHA256===inputSHA256,current=ctx.current&&inputCurrent&&!!review?.ready,modelCurrent=!modelSHA256||modelBindingSHA256===bindingSHA256;
 const result={enabled:true,set:binding.set,review:binding.review,bindingSHA256,current,inputCurrent,documentsCurrent:ctx.current,reviewReady:!!review?.ready,...(review?.sourceCoverageSummary?{sourceCoverage:review.sourceCoverageSummary}:{}),modelCurrent,eligible:current&&modelCurrent,semanticCoverageAccepted:false,professionalApproval:false,scope:'Original-document identity, literal citations and declared field coverage; no automatic semantic, authority or standards-applicability acceptance'};
 if(requireCurrent&&!current)throw Error('DOCUMENT_REVIEW_REQUIRED_OR_STALE: '+JSON.stringify(result));if(requireModel&&modelSHA256&&!modelCurrent)throw Error('DOCUMENT_MODEL_RECOMPUTATION_REQUIRED');return result;
}
export async function initializeTaskDocuments({runs,context,set}){const ctx=await loadDocumentSet(runs,set,{requireCurrent:true});if(context.projectId!==set.projectId)throw Error('DOCUMENT_PROJECT_MISMATCH');const dir=await jobDirectory(runs,context.childJobId);await fs.writeFile(path.join(dir,'document-required.json'),JSON.stringify({parentJobId:context.task.jobId,projectId:context.projectId,set,coveragePolicy:ctx.version.coveragePolicy??'fields_only'}),{flag:'wx'});await fs.writeFile(path.join(dir,'document-binding.json'),JSON.stringify({schemaVersion:1,parentJobId:context.task.jobId,childJobId:context.childJobId,projectId:context.projectId,inputSHA256:context.inputSHA256,set,review:null},null,2)+'\n',{flag:'wx'});}
export async function taskDocumentDependencyNodes({runs,binding,current}){
 if(!current?.documentEvidence?.enabled)return [];
 const record=await jobJson(await jobDirectory(runs,binding.childJobId),'document-binding.json'),ctx=await loadDocumentSet(runs,record.set),nodes=[];
 for(const {snapshot,...doc} of ctx.version.documents)nodes.push({id:'documents:source:'+doc.id,kind:'source',label:doc.title,value:{...doc,set:record.set,current:ctx.current},dependsOn:[],sourceRole:doc.role==='evaluation_only'?'reference':'input',authority:'unverified'});
 const review=record.review?await verifyDocumentReview(runs,record.review):undefined;
 if(review)for(const decision of review.decisions){for(const id of decision.targetIds)nodes.push({id:'documents:target:'+id,kind:'condition',label:'Document interpretation '+id,value:{target:review.targets.find(t=>t.id===id),decision},dependsOn:[...new Set(decision.citations.map(c=>'documents:source:'+c.documentId))],authority:decision.disposition==='assumption'?'assumed':'unverified'});}
 nodes.push({id:'documents:review',kind:'review',label:'Mechanical original-document coverage; professional review pending',value:{review:record.review??null,...current.documentEvidence},dependsOn:nodes.filter(n=>n.sourceRole!=='reference').map(n=>n.id),authority:'unverified',available:!!review});return JSON.parse(JSON.stringify(nodes));
}
