import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isWithin,hashFile} from './drawings.mjs';
export function summarize(result){
 if(!result.tangent)return result;
 const {devices,wires,circuits,...remaining}=result.tangent;
 const snapshot=result.snapshot?{documentId:result.snapshot.documentId,revision:result.snapshot.revision,adapter:result.snapshot.adapter,units:result.snapshot.units,symbolCount:result.snapshot.symbols?.length}:undefined;
 return{...result,snapshot,tangent:{...remaining,circuits:circuits.slice(0,20),circuitsTruncated:circuits.length>20,preview:{devices:devices.slice(0,3),wires:wires.slice(0,3)}},details:{jobId:path.basename(result.jobRoot),tool:'cad_read_result',kinds:['devices','wires','circuits'],note:'Complete records are retained locally; request bounded pages without restarting CAD.'}};
}
export function boundForTransport(result,maxBytes=512*1024){
 if(Buffer.byteLength(JSON.stringify(result))<=maxBytes)return result;
 let bounded=result.tangent?summarize(result):{...result};
 if(result.audit){const{inserts,definitions,texts,...rest}=result.audit;bounded.audit={...rest,insertCount:inserts.length,definitionCount:definitions.length,textCount:texts.length};bounded.details={jobId:path.basename(result.jobRoot),tool:'cad_read_result',kinds:['inserts','definitions','texts']};}
 if(result.snapshot){const{symbols,...snapshot}=result.snapshot;if(Buffer.byteLength(JSON.stringify(snapshot))<=128*1024)bounded.snapshot=snapshot;
  else{bounded.snapshot={documentId:snapshot.documentId,revision:snapshot.revision,adapter:snapshot.adapter,units:snapshot.units,deviceCount:snapshot.deviceCount,routeCount:snapshot.routeCount,routeLengthMm:snapshot.routeLengthMm};bounded.details={jobId:path.basename(result.jobRoot),tool:'cad_read_result',kinds:['managedDevices','routes','symbols','issues']};}
 }
 bounded.responseTruncated=true;bounded.detailNotice='Response exceeds the transport budget. Full evidence is retained in the job; use bounded pages.';
 if(Buffer.byteLength(JSON.stringify(bounded))>maxBytes)return{ok:result.ok,error:result.error,drawingSaved:result.drawingSaved,mutationCommitted:result.mutationCommitted,outcome:result.outcome,safeToRetry:result.safeToRetry,metrics:result.metrics,jobRoot:result.jobRoot,backend:result.backend,responseTruncated:true,details:bounded.details??{jobId:result.jobRoot?path.basename(result.jobRoot):undefined},detailNotice:bounded.detailNotice,snapshot:result.snapshot?{documentId:result.snapshot.documentId,revision:result.snapshot.revision,deviceCount:result.snapshot.deviceCount,routeCount:result.snapshot.routeCount}:undefined};
 return bounded;
}
export async function readResultPage(runs,{jobId,kind,offset=0,limit=25}){
 const root=await fs.realpath(runs),file=await fs.realpath(path.join(root,jobId,'result.json'));
 if(!isWithin(root,file))throw Error('RESULT_OUTSIDE_RUNS');
 const recordBytes=await fs.readFile(file),result=JSON.parse(recordBytes.toString('utf8').replace(/^\uFEFF/,''));const items=kind==='managedDevices'?result.snapshot?.devices:result.tangent?.[kind]??result.audit?.[kind]??result.snapshot?.[kind];
 if(!Array.isArray(items))throw Error('RESULT_KIND_UNAVAILABLE');
 const page=[];let bytes=0;
 for(const item of items.slice(offset,offset+limit)){const size=Buffer.byteLength(JSON.stringify(item));if(size>256*1024&&page.length===0)return{ok:false,jobId,kind,offset,error:{code:'RESULT_ITEM_TOO_LARGE',message:'This record exceeds the page byte budget; inspect the retained local evidence.'},resultSha256:await hashFile(file)};if(bytes+size>256*1024)break;page.push(item);bytes+=size;}
 return{ok:true,jobId,kind,offset,limit,total:items.length,items:page,nextOffset:offset+page.length,hasMore:offset+page.length<items.length,resultSha256:createHash('sha256').update(recordBytes).digest('hex')};
}
