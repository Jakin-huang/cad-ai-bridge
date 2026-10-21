import fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {jobDirectory,jobJson} from './jobs.mjs';
import {hashFile} from './drawings.mjs';
import {engineeringDigest as digest} from './engineering-design.mjs';

const kinds={solve_lighting:['initial_lighting_search_started','initial_lighting_recovery','recover_initial_lighting','initial-lighting-interrupted-'],assess_lighting:['lighting_assessment_started','lighting_recovery','recover_lighting','lighting-interrupted-'],optimize_lighting:['lighting_optimization_started','lighting_recovery','recover_lighting','lighting-interrupted-']};
const missing=async file=>{try{await fs.stat(file);return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}};
export function lightingInterruptionReconciliation({runs,execute}){
 async function child(binding){
  if(!/^job-design-[a-f0-9-]{36}$/.test(binding.childJobId))throw Error('TASK_CHILD_ID_INVALID');
  const dir=await jobDirectory(runs,binding.childJobId),state=await jobJson(dir,'engineering.json');
  if(state.jobId!==binding.childJobId||state.history[0]?.inputSHA256!==binding.initialInputSHA256||digest(await jobJson(dir,'input-0.json'))!==binding.initialInputSHA256)throw Error('TASK_CHILD_IDENTITY_CHANGED');return {dir,state};
 }
 async function verify({binding,operation,parameters,proof,historic}){
  const kind=kinds[operation.operation];if(!kind||proof.kind!=='lighting_calculation_interruption'||proof.operationRequestId!==operation.requestId||proof.childJobId!==binding.childJobId||proof.ownerPid!==operation.ownerPid)throw Error('TASK_RECOVERY_PROOF_MISMATCH');
  const {dir,state}=await child(binding),start=state.history[proof.startIndex],recovery=state.history[proof.recoveryIndex];
  if(!Number.isInteger(proof.startIndex)||proof.startIndex<0||proof.recoveryIndex!==proof.startIndex+1||start?.event!==kind[0]||start.requestId!==operation.requestId||recovery?.event!==kind[1]||recovery.requestId!==proof.recoveryRequestId||recovery.ownerPid!==operation.ownerPid||digest(state.history.slice(0,proof.recoveryIndex+1))!==proof.historyPrefixSHA256)throw Error('TASK_RECOVERY_HISTORY_CHANGED');
  if(!z.uuid().safeParse(proof.recoveryRequestId).success||recovery.archivedLease!==kind[3]+proof.recoveryRequestId+'.json')throw Error('TASK_RECOVERY_LEASE_CHANGED');
  const lease=await jobJson(dir,recovery.archivedLease);if(lease.pid!==operation.ownerPid||lease.action!==operation.operation||!Number.isFinite(Date.parse(lease.startedAt))||Date.parse(lease.startedAt)<Date.parse(operation.startedAt))throw Error('TASK_RECOVERY_LEASE_CHANGED');
  const initial=operation.operation==='solve_lighting',input=await jobJson(dir,'input-'+proof.revision+'.json'),inputSHA256=digest(input),expectedFiles=['input-'+proof.revision+'.json',recovery.archivedLease];
  if(inputSHA256!==proof.inputSHA256)throw Error('TASK_RECOVERY_INPUT_CHANGED');
  if(initial){if(proof.revision!==parameters.expectedRevision||proof.inputSHA256!==parameters.expectedInputSHA256.toLowerCase()||start.revision!==proof.revision||start.inputSHA256!==proof.inputSHA256||recovery.revision!==proof.revision||recovery.inputSHA256!==proof.inputSHA256||proof.modelSHA256!==undefined)throw Error('TASK_RECOVERY_INPUT_CHANGED');}
  else{const name='model-'+proof.revision+'.json',model=await jobJson(dir,name);if(proof.modelSHA256!==parameters.expectedModelSHA256.toLowerCase()||digest(model)!==proof.modelSHA256||digest(model.input)!==proof.inputSHA256||(start.sourceModelSHA256??start.modelSHA256)!==proof.modelSHA256||recovery.modelSHA256!==proof.modelSHA256)throw Error('TASK_RECOVERY_MODEL_CHANGED');expectedFiles.push(name);}
  if(proof.files.length!==expectedFiles.length)throw Error('TASK_RECOVERY_FILES_CHANGED');
  for(const name of expectedFiles){const file=path.join(dir,name),item=proof.files.find(f=>f.file===file);if(!item||await hashFile(file)!==item.sha256)throw Error('TASK_RECOVERY_FILES_CHANGED');}
  if(!historic){
   if(state.history.length!==proof.recoveryIndex+1||state.revision!==proof.revision||state.inputSHA256!==proof.inputSHA256||state.delivery||!await missing(path.join(dir,'engineering.lock')))throw Error('TASK_RECOVERY_CURRENT_STATE_CHANGED');
   if(initial){if(!['prepared','blocked'].includes(state.status)||state.modelSHA256||state.lightingOptimization?.publicationStarted||state.lightingOptimization?.requestId!==operation.requestId||state.lightingOptimization?.status!=='interrupted'||!await missing(path.join(dir,'model-'+proof.revision+'.json')))throw Error('TASK_RECOVERY_PUBLICATION_UNCONFIRMED');}
   else{if(!['designed','quality_blocked'].includes(state.status)||state.modelSHA256!==proof.modelSHA256||operation.operation==='optimize_lighting'&&(state.lightingOptimization?.requestId!==operation.requestId||state.lightingOptimization?.status!=='interrupted'))throw Error('TASK_RECOVERY_CURRENT_STATE_CHANGED');}
  }
 }
 return {
  reconciliationOperations:Object.keys(kinds),reconciliationSchema:z.strictObject({recoveryRequestId:z.uuid().toLowerCase().optional()}),
  async reconcileInterruption({binding,operation,parameters,recovery,requestId}){
   const kind=kinds[operation.operation],recoveryRequestId=(recovery.recoveryRequestId??requestId).toLowerCase();if(!kind)throw Error('TASK_RECONCILIATION_UNSUPPORTED');
   let {dir,state}=await child(binding);const prior=state.history.find(h=>h.event===kind[1]&&h.requestId===recoveryRequestId),initial=operation.operation==='solve_lighting';
   if(!prior){
    const start=state.history.at(-1),lease=await jobJson(dir,'engineering.lock');if(start?.event!==kind[0]||start.requestId!==operation.requestId||lease.pid!==operation.ownerPid||lease.action!==operation.operation)throw Error('TASK_RECOVERY_START_MISMATCH');
    const q=initial?{action:kind[2],jobId:binding.childJobId,requestId:recoveryRequestId,expectedRevision:parameters.expectedRevision,expectedInputSHA256:parameters.expectedInputSHA256}:{action:kind[2],jobId:binding.childJobId,requestId:recoveryRequestId,expectedModelSHA256:parameters.expectedModelSHA256};
    const result=await execute('engineering',q);if(!result.ok)throw Error('TASK_CHILD_RECOVERY_FAILED: '+JSON.stringify(result.error));({dir,state}=await child(binding));
   }
   const recoveryIndex=state.history.findIndex(h=>h.event===kind[1]&&h.requestId===recoveryRequestId),revision=initial?parameters.expectedRevision:state.revision,recovered=state.history[recoveryIndex];if(recoveryIndex<1)throw Error('TASK_RECOVERY_HISTORY_CHANGED');
   const names=['input-'+revision+'.json',recovered.archivedLease,...(initial?[]:['model-'+revision+'.json'])],proof={kind:'lighting_calculation_interruption',childJobId:binding.childJobId,operationRequestId:operation.requestId,ownerPid:operation.ownerPid,recoveryRequestId,startIndex:recoveryIndex-1,recoveryIndex,historyPrefixSHA256:digest(state.history.slice(0,recoveryIndex+1)),revision,inputSHA256:state.inputSHA256,...(initial?{}:{modelSHA256:state.modelSHA256}),files:await Promise.all(names.map(async name=>{if(path.basename(name)!==name)throw Error('TASK_RECOVERY_FILE_OUTSIDE_CHILD');const file=path.join(dir,name);await jobJson(dir,name);return {kind:'json',file,sha256:await hashFile(file)};})),scope:'Interrupted independent calculation only; partial evidence retained, no result/model/native publication certified as successful, no child-process-tree or professional certification'};
   await verify({binding,operation,parameters,proof,historic:false});return proof;
  },
  verifyInterruptionProof:verify
 };
}
