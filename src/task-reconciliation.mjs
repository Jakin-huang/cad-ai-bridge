import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {atomicJson} from './files.mjs';
import {jobJson} from './jobs.mjs';
import {hashFile,isWithin} from './drawings.mjs';

const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const maybe=async(fn)=>{try{return await fn();}catch(e){if(e.code!=='ENOENT')throw e;}};
const pending=record=>['started','unconfirmed'].includes(record.status);
export function assertTaskOwnerAbsent(pid){
 if(!Number.isInteger(pid)||pid<2||pid>2147483647)throw Error('TASK_OWNER_UNVERIFIABLE');
 try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')return;throw Error('TASK_OWNER_UNVERIFIABLE: '+e.code);}
 throw Error('TASK_OWNER_ALIVE');
}
async function checkedFile(dir,name,sha){const file=await fs.realpath(path.join(dir,name));if(!isWithin(dir,file)||await hashFile(file)!==sha)throw Error('TASK_RECONCILIATION_EVIDENCE_CHANGED');return jobJson(dir,name);}
async function original(ctx,id,sha){const name='operation-'+id+'.json',op=await jobJson(ctx.dir,name);if(op.requestId!==id||!pending(op)||await hashFile(path.join(ctx.dir,name))!==sha)throw Error('TASK_RECONCILIATION_OPERATION_CHANGED');if(await maybe(()=>fs.stat(path.join(ctx.dir,'result-'+id+'.json'))))throw Error('TASK_RECONCILIATION_RESULT_UNCONFIRMED');return op;}
export async function taskReconciliations(ctx){
 const closed=new Map();
 for(const name of await fs.readdir(ctx.dir))if(/^reconciliation-[a-f0-9-]{36}\.json$/.test(name)){
  const record=await jobJson(ctx.dir,name);if(record.status!=='completed')continue;
  if(name!=='reconciliation-'+record.requestId+'.json'||record.taskSHA256!==ctx.s.manifestSHA256||record.bindingSHA256!==ctx.s.bindingSHA256)throw Error('TASK_RECONCILIATION_IDENTITY_CHANGED');
  const envelope=await checkedFile(ctx.dir,'reconciliation-'+record.requestId+'-proof.json',record.proofSHA256),result=await checkedFile(ctx.dir,'reconciliation-'+record.requestId+'-result.json',record.resultSHA256),op=await original(ctx,record.operationRequestId,record.operationRecordSHA256);
  if(envelope.taskSHA256!==record.taskSHA256||envelope.bindingSHA256!==record.bindingSHA256||envelope.projectId!==ctx.manifest.project.id||envelope.operationRequestId!==op.requestId||envelope.operationRecordSHA256!==record.operationRecordSHA256||envelope.originalPayloadSHA256!==op.payloadSHA256||envelope.adapterId!==ctx.adapter.id||envelope.adapterVersion!==ctx.adapter.version||result.proofSHA256!==record.proofSHA256||result.operationRequestId!==op.requestId||result.outcome!=='interrupted_before_publication')throw Error('TASK_RECONCILIATION_PROOF_MISMATCH');
  const parameters=ctx.adapter.validateOperation(op.operation,envelope.operationParameters);if(digest({task:ctx.s.manifestSHA256,operation:op.operation,parameters})!==op.payloadSHA256)throw Error('TASK_RECONCILIATION_PARAMETERS_CHANGED');
  if(!ctx.adapter.verifyInterruptionProof)throw Error('TASK_RECONCILIATION_UNSUPPORTED');await ctx.adapter.verifyInterruptionProof({binding:ctx.binding,operation:op,parameters,proof:envelope.proof,historic:true});
  if(closed.has(op.requestId))throw Error('TASK_RECONCILIATION_FORK');closed.set(op.requestId,{record,envelope,result,files:[{kind:'json',file:path.join(ctx.dir,name),sha256:await hashFile(path.join(ctx.dir,name))},{kind:'json',file:path.join(ctx.dir,'reconciliation-'+record.requestId+'-proof.json'),sha256:record.proofSHA256},{kind:'json',file:path.join(ctx.dir,'reconciliation-'+record.requestId+'-result.json'),sha256:record.resultSHA256}]});
 }
 return closed;
}
async function archiveLease(dir,name,archive,predicate){
 const lease=await jobJson(dir,name),sha=await hashFile(path.join(dir,name));predicate(lease);const dest=path.join(dir,archive);
 try{await fs.copyFile(path.join(dir,name),dest,fs.constants.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST'||await hashFile(dest)!==sha)throw e;}
 predicate(await jobJson(dir,name));if(await hashFile(path.join(dir,name))!==sha)throw Error('TASK_RECONCILIATION_OWNER_CHANGED');await fs.unlink(path.join(dir,name));return {file:archive,sha256:sha};
}
async function guard(ctx,q){
 const name='task-reconciliation.lock',file=path.join(ctx.dir,name);let handle;
 try{handle=await fs.open(file,'wx');}catch(e){
  if(e.code!=='EEXIST')throw e;
  const prior=await jobJson(ctx.dir,name);if(prior.requestId!==q.requestId)throw Error('TASK_RECONCILIATION_BUSY: resume the recorded reconciliation request');
  await archiveLease(ctx.dir,name,'reconciliation-'+q.requestId+'-stale-guard-'+await hashFile(file)+'.json',lease=>{if(lease.requestId!==q.requestId||lease.ownerPid!==prior.ownerPid)throw Error('TASK_RECONCILIATION_OWNER_CHANGED');assertTaskOwnerAbsent(lease.ownerPid);});handle=await fs.open(file,'wx');
 }
 await handle.writeFile(JSON.stringify({ownerPid:process.pid,requestId:q.requestId}));return async()=>{await handle.close();const current=await jobJson(ctx.dir,name);if(current.ownerPid!==process.pid||current.requestId!==q.requestId)throw Error('TASK_RECONCILIATION_OWNER_CHANGED');await fs.unlink(file);};
}
export async function reconcileTask(ctx,q,{locked,summary}){
 if(q.requestId===q.operationRequestId||q.requestId===ctx.s.requestId||await maybe(()=>fs.stat(path.join(ctx.dir,'operation-'+q.requestId+'.json'))))throw Error('TASK_RECONCILIATION_NEW_REQUEST_REQUIRED');
 const existing=await taskReconciliations(ctx),resolved=existing.get(q.operationRequestId),name='reconciliation-'+q.requestId+'.json';
 const op=await original(ctx,q.operationRequestId,q.expectedOperationSHA256.toLowerCase());
 if(!ctx.adapter.reconcileInterruption||!ctx.adapter.reconciliationOperations?.includes(op.operation))throw Error('TASK_RECONCILIATION_UNSUPPORTED: ambiguous native or other operations remain blocked');
 const parameters=ctx.adapter.validateOperation(op.operation,q.operationParameters),recovery=ctx.adapter.reconciliationSchema.parse(q.recoveryParameters),payloadSHA256=digest({operationRequestId:q.operationRequestId,operationRecordSHA256:q.expectedOperationSHA256.toLowerCase(),parameters,recovery});
 if(digest({task:ctx.s.manifestSHA256,operation:op.operation,parameters})!==op.payloadSHA256)throw Error('TASK_RECONCILIATION_PARAMETERS_CHANGED');
 const prior=await maybe(()=>jobJson(ctx.dir,name));if(prior&&prior.payloadSHA256!==payloadSHA256)throw Error('TASK_REQUEST_CONFLICT');
 if(resolved){
  if(resolved.record.requestId!==q.requestId)throw Error('TASK_OPERATION_ALREADY_RECONCILED');const release=await guard(ctx,q);
  try{const scope=await maybe(()=>jobJson(ctx.dir,'task-scope.lock'));if(scope?.reconciliationRequestId===q.requestId)await archiveLease(ctx.dir,'task-scope.lock','reconciliation-'+q.requestId+'-prior-scope-'+await hashFile(path.join(ctx.dir,'task-scope.lock'))+'.json',lease=>{if(digest(lease)!==digest(scope))throw Error('TASK_RECONCILIATION_OWNER_CHANGED');assertTaskOwnerAbsent(lease.ownerPid);});return {...await summary(ctx),files:resolved.files,reconciliation:{...resolved.record,replayed:true,result:resolved.result}};}finally{await release();}
 }
 if(prior?.status==='completed')throw Error('TASK_RECONCILIATION_PROOF_MISMATCH');assertTaskOwnerAbsent(op.ownerPid);
 const release=await guard(ctx,q);
 try{
  const other=await maybe(()=>jobJson(ctx.dir,'task-scope.lock'));
  if(other){if(other.ownerPid!==op.ownerPid&&other.reconciliationRequestId!==q.requestId)throw Error('TASK_RECONCILIATION_OWNER_CHANGED');await archiveLease(ctx.dir,'task-scope.lock','reconciliation-'+q.requestId+'-prior-scope-'+await hashFile(path.join(ctx.dir,'task-scope.lock'))+'.json',lease=>{if(digest(lease)!==digest(other))throw Error('TASK_RECONCILIATION_OWNER_CHANGED');assertTaskOwnerAbsent(lease.ownerPid);});}
  return await locked(ctx.dir,async()=>{
   await original(ctx,op.requestId,q.expectedOperationSHA256.toLowerCase());
   const record=prior??{schemaVersion:1,requestId:q.requestId,operationRequestId:op.requestId,operationRecordSHA256:q.expectedOperationSHA256.toLowerCase(),taskSHA256:ctx.s.manifestSHA256,bindingSHA256:ctx.s.bindingSHA256,payloadSHA256,status:'preparing',startedAt:new Date().toISOString()};
   await atomicJson(path.join(ctx.dir,name),record);
   const proof=await ctx.adapter.reconcileInterruption({binding:ctx.binding,operation:op,parameters,recovery,requestId:q.requestId});
   const envelope={schemaVersion:1,taskSHA256:ctx.s.manifestSHA256,projectId:ctx.manifest.project.id,bindingSHA256:ctx.s.bindingSHA256,operationRequestId:op.requestId,operationRecordSHA256:record.operationRecordSHA256,originalPayloadSHA256:op.payloadSHA256,operationParameters:parameters,adapterId:ctx.adapter.id,adapterVersion:ctx.adapter.version,proof};
   await ctx.adapter.verifyInterruptionProof({binding:ctx.binding,operation:op,parameters,proof,historic:false});await original(ctx,op.requestId,record.operationRecordSHA256);assertTaskOwnerAbsent(op.ownerPid);
   const proofFile=path.join(ctx.dir,'reconciliation-'+q.requestId+'-proof.json');await atomicJson(proofFile,envelope);const proofSHA256=await hashFile(proofFile),result={ok:true,outcome:'interrupted_before_publication',operationRequestId:op.requestId,originalStatus:op.status,originalReceiptUnchanged:true,proofSHA256,newRequestRequired:true,safeToRetry:false,professionalApproval:false},resultFile=path.join(ctx.dir,'reconciliation-'+q.requestId+'-result.json');await atomicJson(resultFile,result);
   await ctx.adapter.verifyInterruptionProof({binding:ctx.binding,operation:op,parameters,proof,historic:false});await atomicJson(path.join(ctx.dir,name),{...record,status:'completed',finishedAt:new Date().toISOString(),proofSHA256,resultSHA256:await hashFile(resultFile)});
   const committed=(await taskReconciliations(ctx)).get(op.requestId);const response={...await summary(ctx),files:committed.files,reconciliation:{...committed.record,result:committed.result}};await atomicJson(path.join(ctx.dir,'result.json'),response);return response;
  },q.requestId);
 }finally{await release();}
}
