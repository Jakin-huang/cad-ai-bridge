import fs from 'node:fs/promises';
import path from 'node:path';
import {isWithin,hashFile} from './drawings.mjs';
export function summarize(result){
 if(!result.tangent)return result;
 const {devices,wires,circuits,...remaining}=result.tangent;
 const snapshot=result.snapshot?{documentId:result.snapshot.documentId,revision:result.snapshot.revision,adapter:result.snapshot.adapter,units:result.snapshot.units,symbolCount:result.snapshot.symbols?.length}:undefined;
 return{...result,snapshot,tangent:{...remaining,circuits:circuits.slice(0,20),circuitsTruncated:circuits.length>20,preview:{devices:devices.slice(0,3),wires:wires.slice(0,3)}},details:{jobId:path.basename(result.jobRoot),tool:'cad_read_result',kinds:['devices','wires','circuits'],note:'Complete records are retained locally; request bounded pages without restarting CAD.'}};
}
export async function readResultPage(runs,{jobId,kind,offset=0,limit=25}){
 const root=await fs.realpath(runs),file=await fs.realpath(path.join(root,jobId,'result.json'));
 if(!isWithin(root,file))throw Error('RESULT_OUTSIDE_RUNS');
 const result=JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));const items=result.tangent?.[kind];
 if(!Array.isArray(items))throw Error('RESULT_KIND_UNAVAILABLE');
 return{ok:true,jobId,kind,offset,limit,total:items.length,items:items.slice(offset,offset+limit),hasMore:offset+limit<items.length,resultSha256:await hashFile(file)};
}
