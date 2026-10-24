import fs from 'node:fs/promises';import path from 'node:path';
import {jobDirectory,jobJson} from './jobs.mjs';import {taskIdentitySHA256} from './task-identities.mjs';import {dependencyDigest as digest} from './task-dependencies.mjs';
import {loadScopeReview} from './engineering-scope-intake.mjs';import {loadDocumentSet,readDocumentText} from './project-document-store.mjs';import {scopeApplicability} from './scope-applicability.mjs';

// Read only the fact ledger pinned by this formal task, never a project-global
// latest review. A label, standard paragraph or assumed value is not a site fact.
export async function taskConditionFacts({runs,childJobId,kind,inputSHA256,factIds}){
 const empty={state:'unbound',facts:[],readOnly:true,semanticCoverageAccepted:false,professionalApproval:false};
 if(!runs||!childJobId)return empty;
 if(!/^job-[A-Za-z0-9_-]+$/.test(childJobId))throw Error('CONDITION_CHILD_ID_INVALID');
 let marker;try{marker=JSON.parse(await fs.readFile(path.join(runs,'document-required-'+childJobId+'.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return empty;throw e;}
 const parent=await jobDirectory(runs,marker.parentJobId),state=await jobJson(parent,'task-binding.json'),manifest=await jobJson(parent,'manifest.json'),binding=await jobJson(parent,'binding.json');
 if(state.jobId!==marker.parentJobId||state.manifestSHA256!==taskIdentitySHA256(manifest)||state.bindingSHA256!==taskIdentitySHA256(binding)||binding.childJobId!==childJobId||manifest.task.kind!==kind||manifest.project.id!==marker.projectId||digest(marker.set)!==digest(manifest.documents))throw Error('CONDITION_TASK_BINDING_CHANGED');
 const info={'ordinary-lighting':['engineering.json',taskIdentitySHA256],'office-space-planning':['space-planning.json',digest]}[kind];if(!info)throw Error('CONDITION_TASK_KIND_UNSUPPORTED');const dir=await jobDirectory(runs,childJobId),current=await jobJson(dir,info[0]),input=await jobJson(dir,'input-'+current.revision+'.json');if(current.inputSHA256!==inputSHA256||info[1](input)!==inputSHA256)throw Error('CONDITION_TASK_INPUT_CHANGED');
 if(!manifest.scope)return empty;
 const record=await loadScopeReview(runs,manifest.scope.review),item=record.workItems.find(i=>i.id===manifest.scope.workItemId);if(digest(record.documents)!==digest(manifest.documents)||record.documents.projectId!==manifest.project.id||!item||item.taskKind!==kind||item.disposition!=='candidate'||scopeApplicability(record,item).state!=='active'||!record.sourceCoverage.summary.complete)throw Error('CONDITION_SCOPE_BINDING_INVALID');
 const documents=await loadDocumentSet(runs,record.documents,{requireCurrent:true}),facts=(record.facts??[]).filter(f=>factIds.includes(f.id));
 for(const fact of facts)for(const citation of fact.citations){const d=await readDocumentText(documents,citation.documentId);if(d.document.textSHA256!==citation.textSHA256||!d.text.includes(citation.quote)||d.document.role==='evaluation_only'||fact.status==='interpreted'&&!['requirements','coordination','architecture_notes','catalog'].includes(d.document.role))throw Error('CONDITION_FACT_SOURCE_INVALID');}
 const body={state:'scope_bound',taskJobId:state.jobId,taskSHA256:state.manifestSHA256,inputSHA256,scope:manifest.scope,documents:manifest.documents,facts,readOnly:true,semanticCoverageAccepted:false,professionalApproval:false};return {...body,factsSHA256:digest(body)};
}
