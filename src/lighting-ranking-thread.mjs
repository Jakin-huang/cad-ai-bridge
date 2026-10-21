import {Worker} from 'node:worker_threads';

// Only one pure ranking worker per bridge process. Queued deadlines can expire
// without starting another worker; status and evidence reads stay on the host.
let queue=Promise.resolve();
export function rankLightingInThread(data,onProgress){
 let waiting=true,timer;const scheduled=queue.then(()=>{waiting=false;clearTimeout(timer);return run(data,onProgress);});queue=scheduled.then(()=>undefined,()=>undefined);
 if(data.deadlineMs===undefined)return scheduled;
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{if(waiting)reject(Error('LIGHTING_OPTIMIZATION_TIME_BUDGET'));},Math.max(0,data.deadlineMs-Date.now()));});
 return Promise.race([scheduled,deadline]).finally(()=>clearTimeout(timer));
}
function run(data,onProgress){
 if(data.deadlineMs!==undefined&&Date.now()>=data.deadlineMs)throw Error('LIGHTING_OPTIMIZATION_TIME_BUDGET');
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./lighting-ranking-worker.mjs',import.meta.url),{workerData:data});let done=false,timer,progress=Promise.resolve();
  const finish=async(error,value)=>{if(done)return;done=true;clearTimeout(timer);await worker.terminate();try{await progress;}catch{}if(error)reject(error);else resolve(value);};
  if(data.deadlineMs!==undefined)timer=setTimeout(()=>finish(Error('LIGHTING_OPTIMIZATION_TIME_BUDGET')),Math.max(0,data.deadlineMs-Date.now()));
  worker.on('message',message=>{if(done)return;if(message.type==='progress'){progress=Promise.resolve().then(()=>onProgress?.(message.value));progress.then(()=>{if(!done)worker.postMessage({type:'ack',id:message.id});},error=>finish(error));}else if(message.type==='result')finish(undefined,message.value);else if(message.type==='error')finish(Error(message.message));});
  worker.once('error',error=>finish(error));worker.once('exit',code=>{if(!done)finish(Error('LIGHTING_RANKING_WORKER_EXIT: '+code));});
 });
}
