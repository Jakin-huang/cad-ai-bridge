import fs from 'node:fs/promises';
import path from 'node:path';
import {isWithin} from './drawings.mjs';
import {boundForTransport} from './results.mjs';
import {resolveLocalReferences} from './local-paths.mjs';
import {legacyVerification} from './verification.mjs';
import {readJson} from './files.mjs';
import {taskIdentitySHA256} from './task-identities.mjs';
export function registeredFiles(result){
 if(Array.isArray(result.files))return result.files;
 const files=[];if(result.drawing&&result.drawingSha256)files.push({kind:'dwg',file:result.drawing,sha256:result.drawingSha256});
 if(result.exported?.file&&result.exported.sha256)files.push({kind:result.exported.format??'export',...result.exported});
 for(const entry of result.exports??[])if(entry.ok&&entry.exported?.file&&entry.exported.sha256)files.push({kind:entry.exported.format??'export',...entry.exported});return files;
}
export async function jobDirectory(runs,jobId){
 if(!/^job-[A-Za-z0-9_-]+$/.test(jobId))throw Error('INVALID_JOB: invalid job ID');
 const root=await fs.realpath(runs),job=await fs.realpath(path.join(root,jobId));
 if(!isWithin(root,job)||job===root)throw Error('RESULT_OUTSIDE_RUNS: job escapes owned runs');return job;
}
export async function jobJson(job,name){
 const file=await fs.realpath(path.join(job,name));if(!isWithin(job,file))throw Error('RESULT_OUTSIDE_RUNS: evidence escapes job directory');
 return resolveLocalReferences(await readJson(file));
}
async function optional(job,name){try{return await jobJson(job,name);}catch(error){if(error.code==='ENOENT')return undefined;throw error;}}
// Some design adapters retain state in an internal child without result.json.
// Resolve only a verified formal-task binding, never a same-name/file guess.
export async function taskParentJobId(runs,jobId){
 const child=await jobDirectory(runs,jobId),task=await optional(child,'task.json');if(task?.action!=='engineering_task'||!/^[a-f0-9-]{36}$/.test(task.requestId??''))return undefined;const parentJobId='job-task-'+task.requestId;if(parentJobId===jobId)return undefined;
 let parent,binding,manifest,state;try{parent=await jobDirectory(runs,parentJobId);binding=await jobJson(parent,'binding.json');manifest=await jobJson(parent,'manifest.json');state=await jobJson(parent,'task-binding.json');}catch(error){if(error.code==='ENOENT')return undefined;throw error;}
 if(binding.childJobId!==jobId||state.jobId!==parentJobId||state.requestId!==task.requestId||state.manifestSHA256!==taskIdentitySHA256(manifest)||state.bindingSHA256!==taskIdentitySHA256(binding))throw Error('TASK_PARENT_BINDING_CHANGED');return parentJobId;
}
export async function registeredJobResult(runs,jobId){
 const dir=await jobDirectory(runs,jobId);try{return await jobJson(dir,'result.json');}catch(error){if(error.code!=='ENOENT')throw error;const parentJobId=await taskParentJobId(runs,jobId);if(!parentJobId)throw error;const result=await jobJson(await jobDirectory(runs,parentJobId),'result.json');if(result.jobId!==parentJobId||result.current?.jobId!==jobId)throw Error('TASK_PARENT_RESULT_CHANGED');return result;}
}
async function one(runs,jobId){
 const job=await jobDirectory(runs,jobId),task=await optional(job,'task.json');let result;
 try{result=await optional(job,'result.json');}catch(error){return{ok:false,jobId,status:'unconfirmed',task,error:{code:'RESULT_RECORD_INVALID',message:error.message},safeToRetry:false,retry:'Final record is unreadable. Inspect retained task files and hashes; do not repeat a write automatically.'};}
 if(result)return{ok:true,jobId,status:['engineering','architecture','engineering_task'].includes(task?.action)?task.status:result.ok?'completed':'failed',task,result:boundForTransport({...result,files:registeredFiles(result),verification:legacyVerification(result)},480*1024),retry:'Use the recorded result; do not replay a write automatically.'};
 const parentJobId=await taskParentJobId(runs,jobId);if(parentJobId)return{ok:true,jobId,status:'linked',task,parentJobId,retry:'Open the bound formal task for its current status and registered deliverables; this lookup never changes or replays it.'};
 const response=await optional(job,'response.json'),host=await optional(job,'host.json');
 return{ok:true,jobId,status:'unconfirmed',task,host,response:response?boundForTransport({...response,jobRoot:job},480*1024):undefined,retry:'No final result is recorded. Inspect retained evidence and outputs before retrying; this query never launches CAD.'};
}
export async function getJob(runs,{jobId,requestId}){
 if(jobId)return one(runs,jobId);
 const found=[];let names;try{names=await fs.readdir(runs,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return{ok:true,jobs:[],total:0};throw error;}
 for(const entry of names){if(!entry.isDirectory()||!/^job-[A-Za-z0-9_-]+$/.test(entry.name))continue;
  const job=await jobDirectory(runs,entry.name),task=await optional(job,'task.json');
  const id=task?.requestId??(await optional(job,'request.json'))?.requestId;
  if(id?.toLowerCase()===requestId.toLowerCase())found.push({jobId:entry.name,updatedAt:task?.updatedAt||''});
 }
 found.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
 return{ok:true,requestId,total:found.length,jobs:found.slice(0,20),truncated:found.length>20,note:'Select a jobId to read its result. UUIDs apply within a DWG branch; matching IDs do not establish identical files.'};
}
