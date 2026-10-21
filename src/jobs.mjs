import fs from 'node:fs/promises';
import path from 'node:path';
import {isWithin} from './drawings.mjs';
import {boundForTransport} from './results.mjs';
import {resolveLocalReferences} from './local-paths.mjs';
import {legacyVerification} from './verification.mjs';
import {readJson} from './files.mjs';
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
async function one(runs,jobId){
 const job=await jobDirectory(runs,jobId),task=await optional(job,'task.json');let result;
 try{result=await optional(job,'result.json');}catch(error){return{ok:false,jobId,status:'unconfirmed',task,error:{code:'RESULT_RECORD_INVALID',message:error.message},safeToRetry:false,retry:'Final record is unreadable. Inspect retained task files and hashes; do not repeat a write automatically.'};}
 if(result)return{ok:true,jobId,status:['engineering','architecture','engineering_task'].includes(task?.action)?task.status:result.ok?'completed':'failed',task,result:boundForTransport({...result,files:registeredFiles(result),verification:legacyVerification(result)},480*1024),retry:'Use the recorded result; do not replay a write automatically.'};
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
