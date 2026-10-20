import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isWithin,hashFile} from './drawings.mjs';
import {indexedRows} from './query-index.mjs';
import {compactVerification} from './verification.mjs';
export function summarize(result){
 if(!result.tangent)return result;
 const {devices,wires,circuits,...remaining}=result.tangent;
 const snapshot=result.snapshot?{documentId:result.snapshot.documentId,revision:result.snapshot.revision,adapter:result.snapshot.adapter,units:result.snapshot.units,symbolCount:result.snapshot.symbols?.length}:undefined;
 return{...result,snapshot,tangent:{...remaining,circuits:circuits.slice(0,20),circuitsTruncated:circuits.length>20,preview:{devices:devices.slice(0,3),wires:wires.slice(0,3)}},details:{jobId:path.basename(result.jobRoot),tool:'cad_read_result',kinds:['devices','wires','circuits'],note:'Complete records are retained locally; request bounded pages without restarting CAD.'}};
}
export function boundForTransport(result,maxBytes=512*1024){
 if(Buffer.byteLength(JSON.stringify(result))<=maxBytes)return result;
 if(result.result&&result.jobId){const task=result.task;return {...result,task:task?{jobId:task.jobId,action:task.action,status:task.status,phase:task.phase,updatedAt:task.updatedAt,itemCount:task.items?.length}:undefined,result:boundForTransport(result.result,Math.floor(maxBytes*.7)),responseTruncated:true};}
 let bounded=result.tangent?summarize(result):{...result};
 bounded.verification=compactVerification(result.verification);
 if(result.review)bounded.review={...result.review,pendingGeometry:result.review.pendingGeometry?.slice(0,10),pendingGeometryCount:result.review.pendingGeometry?.length};
 if(result.query){const{entities,...rest}=result.query;bounded.query={...rest,retainedEntityCount:entities?.length??result.query.retainedEntityCount};bounded.details={jobId:path.basename(result.jobRoot),tool:'cad_read_result',kinds:['entities']};}
 if(result.audit){const{inserts,definitions,texts,...rest}=result.audit;bounded.audit={...rest,insertCount:inserts.length,definitionCount:definitions.length,textCount:texts.length};bounded.details={jobId:path.basename(result.jobRoot),tool:'cad_read_result',kinds:['inserts','definitions','texts']};}
 if(result.snapshot){const{symbols,...snapshot}=result.snapshot;if(Buffer.byteLength(JSON.stringify(snapshot))<=128*1024)bounded.snapshot=snapshot;
  else{bounded.snapshot={documentId:snapshot.documentId,revision:snapshot.revision,adapter:snapshot.adapter,units:snapshot.units,deviceCount:snapshot.deviceCount,routeCount:snapshot.routeCount,routeLengthMm:snapshot.routeLengthMm};bounded.details={jobId:path.basename(result.jobRoot),tool:'cad_read_result',kinds:[...new Set([...(bounded.details?.kinds??[]),'managedDevices','routes','symbols','issues'])]};}
 }
 bounded.responseTruncated=true;bounded.detailNotice='Response exceeds the transport budget. Full evidence is retained in the job; use bounded pages.';
 if(Buffer.byteLength(JSON.stringify(bounded))>maxBytes){const fallback={ok:result.ok,error:result.error,inputSha256:result.inputSha256,drawing:result.drawing,drawingSha256:result.drawingSha256,exported:result.exported,drawingSaved:result.drawingSaved,mutationCommitted:result.mutationCommitted,outcome:result.outcome,safeToRetry:result.safeToRetry,metrics:result.metrics,jobRoot:result.jobRoot,backend:result.backend,workflow:result.workflow,coverage:result.coverage,statistics:result.statistics,files:result.files?.slice(0,50),fileCount:result.files?.length,filesTruncated:result.files?.length>50,review:bounded.review,verification:bounded.verification,delivery:result.delivery?{manifest:result.delivery.manifest,verificationPassed:result.delivery.verificationPassed,markdown:result.delivery.markdown}:undefined,summary:result.summary?{...(!('changed'in result.summary)?result.summary:{}),changed:result.summary.changed,created:result.summary.created,removed:result.summary.removed,skippedCount:result.summary.skipped?.length}:undefined,responseTruncated:true,details:bounded.details??{jobId:result.jobRoot?path.basename(result.jobRoot):undefined,tool:'cad_read_result',kinds:['files','items']},detailNotice:bounded.detailNotice,snapshot:result.snapshot?{documentId:result.snapshot.documentId,revision:result.snapshot.revision,deviceCount:result.snapshot.deviceCount,routeCount:result.snapshot.routeCount}:undefined};
  if(Buffer.byteLength(JSON.stringify(fallback))<=maxBytes)return fallback;
  return {ok:result.ok,jobId:result.jobId,jobRoot:result.jobRoot,status:result.status,error:result.error?{code:result.error.code,message:String(result.error.message??'').slice(0,4096)}:undefined,outcome:result.outcome,drawing:result.drawing,drawingSha256:result.drawingSha256,drawingSaved:result.drawingSaved,safeToRetry:false,verification:compactVerification(result.verification),responseTruncated:true,details:fallback.details,detailNotice:'Full records remain in the task. Use bounded cad_read_result pages; execution and saved output identity are retained here.'};
 }
 return bounded;
}
export async function readResultPage(runs,{jobId,kind,offset=0,limit=25,filter,fields,expectedResultSha256}){
 const root=await fs.realpath(runs),file=await fs.realpath(path.join(root,jobId,'result.json'));
 if(!isWithin(root,file))throw Error('RESULT_OUTSIDE_RUNS');
 const recordBytes=await fs.readFile(file),resultSha256=createHash('sha256').update(recordBytes).digest('hex'),result=JSON.parse(recordBytes.toString('utf8').replace(/^\uFEFF/,''));let items=kind==='managedDevices'?result.snapshot?.devices:result.query?.[kind]??result.tangent?.[kind]??result.audit?.[kind]??result.snapshot?.[kind]??result[kind];
 if(expectedResultSha256&&expectedResultSha256.toLowerCase()!==resultSha256)throw Error('RESULT_CHANGED: query snapshot no longer matches the expected digest');
 if(!Array.isArray(items))throw Error('RESULT_KIND_UNAVAILABLE');
 if(filter){if(kind!=='entities'||!result.queryIndex)throw Error('QUERY_INDEX_REQUIRED: capture this drawing with cad_scan_drawing first');const indexFile=await fs.realpath(path.join(path.dirname(file),'query-index.json'));if(!isWithin(path.dirname(file),indexFile))throw Error('QUERY_INDEX_CHANGED');const indexBytes=await fs.readFile(indexFile);if(createHash('sha256').update(indexBytes).digest('hex')!==result.queryIndex.sha256)throw Error('QUERY_INDEX_CHANGED');const index=JSON.parse(indexBytes.toString('utf8'));if(index.count!==items.length)throw Error('QUERY_INDEX_CHANGED');items=indexedRows(items,index,filter);}
 if(fields)items=items.map(row=>Object.fromEntries([...new Set(['handle','instancePath',...fields])].filter(key=>key in row).map(key=>[key,row[key]])));
 const page=[];let bytes=0;
 for(const item of items.slice(offset,offset+limit)){const size=Buffer.byteLength(JSON.stringify(item));if(size>256*1024&&page.length===0)return{ok:false,jobId,kind,offset,error:{code:'RESULT_ITEM_TOO_LARGE',message:'This record exceeds the page byte budget; inspect the retained local evidence.'},resultSha256:await hashFile(file)};if(bytes+size>256*1024)break;page.push(item);bytes+=size;}
 return{ok:true,jobId,kind,offset,limit,total:items.length,items:page,nextOffset:offset+page.length,hasMore:offset+page.length<items.length,resultSha256,coverage:result.query?{captured:result.query.returned,total:result.query.total,truncated:result.query.truncated,scope:result.query.scope,sourceSha256:result.inputSha256}:undefined};
}
