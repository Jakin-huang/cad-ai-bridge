import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {engineeringTaskSchema,readonlyEngineeringTaskSchema} from './engineering-task-contracts.mjs';
import {atomicJson} from './files.mjs';
import {jobDirectory,jobJson} from './jobs.mjs';
import {hashFile,isWithin} from './drawings.mjs';
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
async function checkedResult(dir,requestId,expected){const file=await fs.realpath(path.join(dir,'result-'+requestId+'.json'));if(!isWithin(dir,file))throw Error('TASK_OPERATION_RESULT_OUTSIDE_TASK');const bytes=await fs.readFile(file);if(crypto.createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('TASK_OPERATION_RESULT_CHANGED');return JSON.parse(bytes.toString('utf8'));}
export function createEngineeringTaskManager({runs,adapters}){
 const registry=new Map(adapters.map(a=>[a.id,a]));if(registry.size!==adapters.length)throw Error('TASK_ADAPTER_DUPLICATE');
 function capability(kind){const adapter=registry.get(kind);if(!adapter)throw Error('TASK_CAPABILITY_UNAVAILABLE: '+kind+'; available: '+[...registry.keys()].join(', ')+'; no fallback was selected');return adapter;}
 async function filesVerified(files){const root=await fs.realpath(runs);for(const f of files||[]){const file=await fs.realpath(f.file);if(!isWithin(root,file)||await hashFile(file)!==f.sha256)throw Error('TASK_OUTPUT_CHANGED');}}
 async function load(q){const dir=await jobDirectory(runs,q.jobId),s=await jobJson(dir,'task-binding.json'),manifest=await jobJson(dir,'manifest.json');if(s.jobId!==q.jobId||digest(manifest)!==s.manifestSHA256||q.expectedTaskSHA256.toLowerCase()!==s.manifestSHA256)throw Error('TASK_MANIFEST_CHANGED');if(manifest.project.id!==q.expectedProjectId)throw Error('TASK_PROJECT_MISMATCH');const adapter=capability(manifest.task.kind);if(adapter.version!==manifest.adapterVersion)throw Error('TASK_ADAPTER_VERSION_CHANGED');let binding;if(s.bindingSHA256){binding=await jobJson(dir,'binding.json');if(digest(binding)!==s.bindingSHA256)throw Error('TASK_BINDING_CHANGED');}return {dir,s,manifest,adapter,binding};}
 async function summary(context){
  const {s,manifest,binding,adapter,dir}=context,pending=[],completed=[];
  for(const name of await fs.readdir(dir))if(/^operation-[a-f0-9-]{36}\.json$/.test(name)){const op=await jobJson(dir,name);if(['started','unconfirmed'].includes(op.status))pending.push({requestId:op.requestId,operation:op.operation,status:'unconfirmed',ownerPid:op.ownerPid});else completed.push(op);}
  completed.sort((a,b)=>a.finishedAt.localeCompare(b.finishedAt));const last=completed.at(-1);let latest;
  if(last){latest=await checkedResult(dir,last.requestId,last.resultSHA256);await filesVerified(latest.files??latest.delivery?.files);}
  const current=binding?await adapter.inspect(binding,manifest,latest):undefined;await filesVerified(current?.files);
  return {ok:true,jobId:s.jobId,taskSHA256:s.manifestSHA256,project:manifest.project,task:manifest.task,adapter:{id:adapter.id,version:adapter.version,complexDesign:adapter.complexDesign},status:pending.length?'operation_unconfirmed':s.phase,pendingOperations:pending,lastExecution:last,executionCount:completed.length,current,files:current?.files??[],reviewStatus:'awaiting_human_review',professionalApproval:false,safeToRetry:false};
 }
 async function save(dir,s){await atomicJson(path.join(dir,'task-binding.json'),s);await atomicJson(path.join(dir,'task.json'),{jobId:s.jobId,action:'engineering_task',requestId:s.requestId,status:s.phase==='ready'?'partial':'blocked',phase:s.phase,ownerPid:process.pid});}
 async function locked(dir,work){const file=path.join(dir,'task-scope.lock');let lease;try{lease=await fs.open(file,'wx');}catch(e){if(e.code==='EEXIST')throw Error('TASK_BUSY_OR_UNCONFIRMED: inspect the recorded owner, never restart a native operation from a missing reply');throw e;}try{await lease.writeFile(JSON.stringify({ownerPid:process.pid}));return await work();}finally{await lease.close();await fs.unlink(file);}}
 async function run(raw){const q=(process.env.CADBRIDGE_READ_ONLY==='1'?readonlyEngineeringTaskSchema:engineeringTaskSchema).parse(raw);
  if(q.requestId)q.requestId=q.requestId.toLowerCase();if(q.project)q.project.id=q.project.id.toLowerCase();if(q.expectedProjectId)q.expectedProjectId=q.expectedProjectId.toLowerCase();
  if(q.action==='capabilities')return {ok:true,selection:'Exact explicit task kind; no natural-language or professional applicability claim',adapters:adapters.map(a=>({id:a.id,version:a.version,complexDesign:a.complexDesign,limitations:a.limitations,prepareParameters:z.toJSONSchema(a.prepareSchema),operations:Object.fromEntries(Object.entries(a.operationSchemas).map(([k,v])=>[k,z.toJSONSchema(v)]))})),unsupportedKinds:'Any task kind absent from the installed adapter registry',professionalApproval:false};
  if(q.action==='prepare'){
   const adapter=capability(q.task.kind),parameters=adapter.validatePrepare(q.parameters),manifest={schemaVersion:1,project:q.project,task:q.task,adapterVersion:adapter.version,parameters},sha=digest(manifest);if(Buffer.byteLength(JSON.stringify(manifest))>2*1024*1024)throw Error('TASK_INPUT_TOO_LARGE');
   await fs.mkdir(runs,{recursive:true});const jobId='job-task-'+q.requestId,dir=path.join(runs,jobId);let created=false;try{await fs.mkdir(dir);created=true;}catch(e){if(e.code!=='EEXIST')throw e;}
   if(!created){const ctx=await load({jobId,expectedProjectId:q.project.id,expectedTaskSHA256:sha});if(!ctx.binding)throw Error('TASK_PREPARATION_UNCONFIRMED');return {...await summary(ctx),replayed:true};}
   return locked(dir,async()=>{await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});const s={schemaVersion:1,jobId,requestId:q.requestId,manifestSHA256:sha,phase:'preparing'};await save(dir,s);
    try{const binding=await adapter.prepare(parameters,q.requestId);await fs.writeFile(path.join(dir,'binding.json'),JSON.stringify(binding,null,2)+'\n',{flag:'wx'});s.bindingSHA256=digest(binding);s.phase='ready';await save(dir,s);const response=await summary({dir,s,manifest,binding,adapter});await atomicJson(path.join(dir,'result.json'),response);return response;}catch(e){s.phase='preparation_unconfirmed';s.error=e.message;await save(dir,s);throw e;}
   });
  }
  const ctx=await load(q);if(q.action==='status')return summary(ctx);
  if(!ctx.binding)throw Error('TASK_PREPARATION_UNCONFIRMED');const parameters=ctx.adapter.validateOperation(q.operation,q.parameters),payloadSHA256=digest({task:ctx.s.manifestSHA256,operation:q.operation,parameters});
  return locked(ctx.dir,async()=>{const file=path.join(ctx.dir,'operation-'+q.requestId+'.json'),prior=await read(file).catch(e=>{if(e.code!=='ENOENT')throw e;});
   if(prior){if(prior.payloadSHA256!==payloadSHA256)throw Error('TASK_REQUEST_CONFLICT');if(['started','unconfirmed'].includes(prior.status))throw Error('TASK_OPERATION_UNCONFIRMED');const recorded=await checkedResult(ctx.dir,q.requestId,prior.resultSHA256);await filesVerified(recorded.files??recorded.delivery?.files);return {...await summary(ctx),ok:recorded.ok,execution:{...prior,replayed:true,result:recorded}};}
   const before=await summary(ctx);if(before.pendingOperations.length)throw Error('TASK_OPERATION_UNCONFIRMED');const record={requestId:q.requestId,operation:q.operation,payloadSHA256,status:'started',ownerPid:process.pid,startedAt:new Date().toISOString()};await atomicJson(file,record);
   // On a lost reply retain started, rather than inventing a safe retry.
   const result=await ctx.adapter.invoke(ctx.binding,q.operation,parameters,q.requestId,ctx.manifest);await atomicJson(path.join(ctx.dir,'result-'+q.requestId+'.json'),result);record.resultSHA256=await hashFile(path.join(ctx.dir,'result-'+q.requestId+'.json'));record.status=['unknown','unconfirmed'].includes(result.outcome)||result.status==='delivery_unconfirmed'?'unconfirmed':result.ok?'completed':'failed';record.finishedAt=new Date().toISOString();await atomicJson(file,record);const response={...await summary(ctx),ok:result.ok,execution:{...record,result}};await atomicJson(path.join(ctx.dir,'result.json'),response);return response;
  });
 }
 return {run};
}
