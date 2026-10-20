import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {atomicJson} from './files.mjs';
import {hashFile,snapshotDrawing,isWithin} from './drawings.mjs';
import {jobDirectory,jobJson} from './jobs.mjs';
import {compactVerification} from './verification.mjs';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const fingerprint=v=>crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const childId=(id,item)=>{const b=crypto.createHash('sha256').update(id+'\0'+item).digest().subarray(0,16);b[6]=(b[6]&15)|0x50;b[8]=(b[8]&63)|0x80;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}};
async function lease(job){
 const file=path.join(job,'worker.lock');
 try{const h=await fs.open(file,'wx');await h.writeFile(JSON.stringify({pid:process.pid,token:crypto.randomUUID()}));await h.close();return async()=>fs.unlink(file);}
 catch(e){if(e.code!=='EEXIST')throw e;const owner=JSON.parse(await fs.readFile(file,'utf8'));if(!Number.isInteger(owner.pid)||alive(owner.pid))throw Error('PROJECT_WORKER_ACTIVE: an existing worker may still be running');await fs.unlink(file);return lease(job);}
}
async function checkedResult(job,item,runs){
 const result=await jobJson(job,'result.json');
 if(item.childRequestId&&result.requestId?.toLowerCase()!==item.childRequestId.toLowerCase()||result.inputSha256&&result.inputSha256!==item.inputSha256||item.childRequestId&&result.ok&&!result.inputSha256)throw Error('PROJECT_CHILD_IDENTITY_MISMATCH: result does not belong to this frozen item');
 const root=await fs.realpath(runs);for(const file of result.files??[]){const resolved=await fs.realpath(file.file);if(!isWithin(root,resolved))throw Error('PROJECT_OUTPUT_OUTSIDE_RUNS');if(await hashFile(resolved)!==file.sha256)throw Error('PROJECT_OUTPUT_CHANGED: child output hash mismatch');}return result;
}
const itemResult=r=>({ok:r.ok,outcome:r.outcome,drawingSaved:r.drawingSaved,drawing:r.drawing,drawingSha256:r.drawingSha256,error:r.error,verification:r.verification,summary:r.summary,statistics:r.statistics,coverage:r.coverage,files:r.files,jobRoot:r.jobRoot,metrics:r.metrics,delivery:r.delivery,exports:r.exports});
const visibleResult=result=>result?{...result,summary:result.summary?{changed:result.summary.changed,created:result.summary.created,removed:result.summary.removed,skippedCount:result.summary.skipped?.length}:undefined,files:result.files?.slice(0,10),fileCount:result.files?.length,filesTruncated:result.files?.length>10,exports:result.exports?.map(({name,ok,error})=>({name,ok,error})),delivery:result.delivery?{manifest:result.delivery.manifest,verificationPassed:result.delivery.verificationPassed,markdown:result.delivery.markdown?.split('\n').slice(0,10).join('\n')}:undefined,verification:compactVerification(result.verification),details:{jobId:result.jobRoot?path.basename(result.jobRoot):undefined,tool:'cad_get_job'}}:undefined;
export function createProjectManager({execute,getSettings,runs}){
 const active=new Map();
 async function save(job,state){state.updatedAt=new Date().toISOString();await atomicJson(path.join(job,'task.json'),state);}
 function summary(state,{offset=0,limit=20,full=false}={}){return {ok:true,jobId:state.jobId,status:state.status,phase:state.phase,currentItem:state.currentItem,requestId:state.requestId,updatedAt:state.updatedAt,cancelRequested:state.cancelRequested,items:state.items.slice(offset,offset+limit).map(({spec,...item})=>full?item:{...item,result:visibleResult(item.result),deliveryRetryCount:item.deliveryRetries?.length,deliveryRetries:item.deliveryRetries?.slice(-3).map(visibleResult)}),itemCount:state.items.length,offset,nextOffset:offset+limit,hasMore:offset+limit<state.items.length,totals:Object.fromEntries(['pending','running','completed','failed','blocked','cancelled'].map(status=>[status,state.items.filter(i=>i.status===status).length])),safeToRetry:false,note:'Per-drawing copies; no cross-DWG transaction. Resume continues only unstarted items. Saved or unconfirmed writes are never replayed.'};}
 async function reconcile(job,state){
  for(const item of state.items.filter(i=>['running','completed','failed'].includes(i.status))){
   try{const child=await jobDirectory(runs,item.childJobId),result=await checkedResult(child,item,runs);item.result=itemResult(result);item.status=result.ok?'completed':'failed';item.recovered=true;}
   catch(error){item.status='blocked';item.error={code:'PROJECT_WRITE_UNCONFIRMED',message:error.message,next:'Inspect the retained child journal and DWG. Automatic write replay is disabled.'};}
  }
  await save(job,state);
 }
 async function work(job,state,release){
  try{
   state.status='running';state.phase='executing';await save(job,state);
   for(const item of state.items){
    const control=await jobJson(job,'control.json').catch(e=>{if(e.code==='ENOENT')return {};throw e;});
    if(control.cancel){state.cancelRequested=true;for(const remaining of state.items.filter(i=>i.status==='pending'))remaining.status='cancelled';break;}
    if(item.status!=='pending')continue;
    if(await hashFile(item.frozenDrawing).catch(()=>undefined)!==item.inputSha256){item.status='blocked';item.error={code:'PROJECT_INPUT_CHANGED',message:'Frozen project input changed; not executing this item'};await save(job,state);continue;}
    // Persist the child identity before execution. A crash here is conservative:
    // recovery may reconcile a finished result but never invent a fresh write.
    item.status='running';state.currentItem=item.id;await save(job,state);
    let result;try{result=await execute('workflow',{...item.spec,drawing:item.frozenDrawing,requestId:item.childRequestId,response:'full'});}catch(error){result={ok:false,error:{code:'PROJECT_CHILD_EXCEPTION',message:error.message},outcome:'unconfirmed',safeToRetry:false};}
    item.result=itemResult(result);item.status=result.ok?'completed':result.outcome==='unconfirmed'?'blocked':'failed';await save(job,state);
    if(item.status!=='completed'&&state.failurePolicy==='stop')break;
   }
   for(const item of state.items)item.sourceIntegrity={expectedSha256:item.inputSha256,actualSha256:await hashFile(item.sourceDrawing).catch(()=>undefined)};
   state.currentItem=undefined;
   state.status=state.items.some(i=>i.status==='blocked')?'blocked':state.items.some(i=>i.status==='cancelled')?'cancelled':state.items.some(i=>i.status==='pending')?'stopped':state.items.some(i=>i.status==='failed'||i.sourceIntegrity.actualSha256!==i.sourceIntegrity.expectedSha256)?'partial':'completed';state.phase='finished';
   const result={...summary(state,{limit:state.items.length,full:true}),ok:state.status==='completed',outcome:state.status,jobRoot:job,files:state.items.flatMap(i=>(i.result?.files??[]).map(f=>({...f,itemId:i.id}))),atomicAcrossDrawings:false};
   await save(job,state);await atomicJson(path.join(job,'result.json'),result);await atomicJson(path.join(job,'delivery.json'),result);
  }catch(error){state.status='blocked';state.error={code:'PROJECT_WORKER_FAILED',message:error.message};await save(job,state).catch(async journalError=>{await fs.writeFile(path.join(job,'worker-error.json'),JSON.stringify({error:error.stack,journalError:journalError.stack,at:new Date().toISOString()})).catch(()=>{});});}
  finally{await release().catch(()=>{});active.delete(state.jobId);}
 }
 function launch(job,state,release){const worker=work(job,state,release);active.set(state.jobId,worker);}
 async function run(args){
  if(args.action==='list'){
   const names=await fs.readdir(runs,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;});const jobs=[];
   for(const e of names)if(e.isDirectory()&&/^job-project-[a-f0-9-]+$/i.test(e.name)){const job=await jobDirectory(runs,e.name);try{const state=await jobJson(job,'task.json');jobs.push({jobId:e.name,status:state.status,updatedAt:state.updatedAt,itemCount:state.items?.length??0});}catch(error){jobs.push({jobId:e.name,status:'unconfirmed',error:error.message});}}
   jobs.sort((a,b)=>(b.updatedAt??'').localeCompare(a.updatedAt??''));return {ok:true,jobs:jobs.slice(args.offset,args.offset+args.limit),total:jobs.length,hasMore:args.offset+args.limit<jobs.length};
  }
  if(args.action==='start'){
   if(process.env.CADBRIDGE_READ_ONLY==='1'&&args.items.some(i=>!['takeoff','export_batch'].includes(i.plan.type)))throw Error('READ_ONLY: project contains write workflows');
   const id='job-project-'+args.requestId.toLowerCase(),job=path.join(runs,id),spec={items:args.items,failurePolicy:args.failurePolicy};await fs.mkdir(runs,{recursive:true});
   try{await fs.mkdir(job);}catch(error){if(error.code!=='EEXIST')throw error;const existing=await jobJson(await jobDirectory(runs,id),'task.json');if(existing.fingerprint!==fingerprint(spec))throw Error('REQUEST_ID_CONFLICT: project UUID belongs to another specification');return {...summary(existing),replayed:true};}
   const state={jobId:id,action:'project',requestId:args.requestId,status:'preparing',phase:'freezing_inputs',ownerPid:process.pid,startedAt:new Date().toISOString(),failurePolicy:args.failurePolicy,fingerprint:fingerprint(spec),items:[]};
   await save(job,state);const release=await lease(job);
   try{
    const settings=await getSettings();
    for(const entry of args.items){const {id:itemId,drawing,expectedSha256,...workflow}=entry,inputJob=path.join(job,'inputs',itemId);await fs.mkdir(inputJob,{recursive:true});const inputSha256=await snapshotDrawing(drawing,[settings.workspace,runs],inputJob,expectedSha256),childRequestId=childId(args.requestId.toLowerCase(),itemId);state.items.push({id:itemId,status:'pending',sourceDrawing:await fs.realpath(drawing),frozenDrawing:path.join(inputJob,'input.dwg'),inputSha256,childRequestId,childJobId:'job-workflow-'+childRequestId,spec:workflow});await save(job,state);}
    state.status='queued';state.phase='ready';await save(job,state);launch(job,state,release);return summary(state);
   }catch(error){state.status='failed';state.phase='preflight';state.error={code:'PROJECT_PREFLIGHT_FAILED',message:error.message};await save(job,state);await release();throw error;}
  }
  const job=await jobDirectory(runs,args.jobId),state=await jobJson(job,'task.json');if(state.action!=='project')throw Error('PROJECT_REQUIRED');
  if(args.action==='status'){const workerError=await jobJson(job,'worker-error.json').catch(e=>{if(e.code==='ENOENT')return undefined;throw e;});return {...summary(state,args),...(workerError?{status:'blocked',error:{code:'PROJECT_JOURNAL_FAILED',message:'Worker stopped after a journal failure; inspect retained worker-error.json before recovery'}}:{error:state.error}),workerActive:active.has(args.jobId)};}
  if(args.action==='cancel'){await atomicJson(path.join(job,'control.json'),{cancel:true,requestedAt:new Date().toISOString()});return {...summary(state),cancelRequested:true,note:'Cancellation stops before the next drawing. An in-flight CAD operation is allowed to finish and save its evidence.'};}
  if(args.action==='reexport'){
   if(active.has(args.jobId))throw Error('PROJECT_WORKER_ACTIVE: wait for the current item to finish');
   const release=await lease(job);
   try{
    const item=state.items.find(i=>i.id===args.itemId);if(!item)throw Error('PROJECT_ITEM_NOT_FOUND');
    const declared=item.spec.plan.type==='export_batch'?item.spec.plan.items:item.spec.delivery?.exports,failed=new Set(item.result?.exports?.filter(e=>!e.ok).map(e=>e.name));
    if(!declared||!failed.size)throw Error('PROJECT_NO_FAILED_EXPORTS');
    const items=declared.filter(e=>failed.has(e.name)&&(!args.names||args.names.includes(e.name)));if(!items.length||args.names?.some(name=>!failed.has(name)))throw Error('PROJECT_EXPORT_NOT_FAILED');
    const drawing=item.result?.drawingSaved?item.result.drawing:item.frozenDrawing,expected=item.result?.drawingSaved?item.result.drawingSha256:item.inputSha256;if(await hashFile(drawing)!==expected)throw Error('PROJECT_OUTPUT_CHANGED');
    const result=await execute('workflow',{drawing,requestId:args.requestId,host:item.spec.host,plan:{type:'export_batch',items},preview:false,response:'full'});
    item.deliveryRetries??=[];item.deliveryRetries.push({requestId:args.requestId,...itemResult(result)});await save(job,state);await atomicJson(path.join(job,'delivery-retries.json'),state.items.filter(i=>i.deliveryRetries).map(i=>({id:i.id,retries:i.deliveryRetries})));
    return {...result,projectJobId:args.jobId,itemId:item.id,readOnlyRecovery:true,originalProjectStatus:state.status,note:'This only re-exports retained bytes. Original edit and project outcome remain recorded; no write was replayed.'};
   }finally{await release();}
  }
  if(args.action==='resume'){
   if(active.has(args.jobId))return {...summary(state),workerActive:true};
   if(state.phase==='preflight'||state.phase==='freezing_inputs')throw Error('PROJECT_PREFLIGHT_INCOMPLETE: create a new project after inspecting the preflight failure; this project has not launched a write');
   if(process.env.CADBRIDGE_READ_ONLY==='1'&&state.items.some(i=>['pending','cancelled'].includes(i.status)&&!['takeoff','export_batch'].includes(i.spec.plan.type)))throw Error('READ_ONLY: pending project writes are disabled');
   const release=await lease(job);
   try{await reconcile(job,state);for(const item of state.items)if(item.status==='cancelled')item.status='pending';await atomicJson(path.join(job,'control.json'),{cancel:false});state.cancelRequested=false;const errorFile=path.join(job,'worker-error.json');try{await fs.rename(errorFile,path.join(job,'worker-error-'+Date.now()+'.json'));}catch(error){if(error.code!=='ENOENT')throw error;}launch(job,state,release);return summary(state);}catch(error){await release();throw error;}
  }
  throw Error('PROJECT_ACTION_UNSUPPORTED');
 }
 return {run,wait:async jobId=>{await active.get(jobId);}};
}
