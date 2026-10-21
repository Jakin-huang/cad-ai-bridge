// Domain-neutral scheduling only. Task meaning, evidence and acceptance belong
// to the caller; successful execution never certifies an engineering result.
export async function mapBoundedWork(items,{concurrency=1,maxConcurrency=4,signal}={},task){
 if(!Array.isArray(items)||typeof task!=='function')throw Error('WORK_POOL_INPUT_INVALID');
 if(!Number.isInteger(maxConcurrency)||maxConcurrency<1||maxConcurrency>64||!Number.isInteger(concurrency)||concurrency<1||concurrency>maxConcurrency)throw Error('WORK_POOL_CONCURRENCY_INVALID');
 const controller=new AbortController(),results=Array(items.length);let cursor=0,failure;
 const cancel=()=>{if(!failure){failure=signal?.reason instanceof Error?signal.reason:Error('WORK_POOL_CANCELLED');controller.abort(failure);}};
 signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
 try{
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{while(!failure&&cursor<items.length){const index=cursor++;try{results[index]=await task(items[index],index,controller.signal);}catch(error){if(!failure){failure=error instanceof Error?error:Error(String(error));controller.abort(failure);}}}}));
  if(failure)throw failure;return results;
 }finally{signal?.removeEventListener('abort',cancel);}
}
