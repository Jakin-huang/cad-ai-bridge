// This worker performs pure candidate arithmetic. It never writes files,
// launches CAD/Radiance, chooses new requirements or publishes a model.
import {parentPort,workerData} from 'node:worker_threads';
import {rankLightingPlansAsync,lightingCandidatePreflight} from './lighting-optimizer.mjs';
const acknowledgements=new Map();let sequence=0;
parentPort.on('message',message=>{if(message.type==='ack'){acknowledgements.get(message.id)?.();acknowledgements.delete(message.id);}});
const progress=value=>new Promise(resolve=>{const id=++sequence;acknowledgements.set(id,resolve);parentPort.postMessage({type:'progress',id,value});});
try{const {model,baseline,ugrMethod,priorFailedChoices,deadlineMs}=workerData,failed=new Map((priorFailedChoices??[]).map(([id,choices])=>[id,new Set(choices)])),condition=lightingCandidatePreflight(model,{ugrMethod}),preflight=(room,choice)=>failed.get(room.id)?.has(choice.choiceSHA256)?[{code:'LIGHTING_PRIOR_FAILED_ROOM_LAYOUT',reason:'Same frozen room, source product, conditions and layout already failed an audited local quality gate in this study'}]:condition(room,choice),value=await rankLightingPlansAsync(model,baseline,{ugrMethod,preflight,deadlineMs,onPreflightRoom:progress,onPreflightProgress:progress});parentPort.postMessage({type:'result',value});}catch(error){parentPort.postMessage({type:'error',message:error.message});}finally{parentPort.close();}
