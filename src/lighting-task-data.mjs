import path from 'node:path';
import {jobDirectory,jobJson} from './jobs.mjs';
import {dependencyDigest as digest} from './task-dependencies.mjs';
import {documentTargets} from './project-document-store.mjs';
import {engineeringDigest} from './engineering-design.mjs';
import {frozenLightingSpaceConditions,frozenLightingSpaceConditionValues,verifyLightingSpaceProgram} from './lighting-space-program.mjs';

export const lightingDataSections=['input','space_adoption','space_program_changes'];
// These are facts about persisted values, not suggested uses, requirements,
// permissions or an automatic carry-forward decision. No task files are written.
export async function readLightingData({runs,binding,q,manifest}){
 if(!lightingDataSections.includes(q.section))throw Error('TASK_DATA_SECTION_UNSUPPORTED');
 const dir=await jobDirectory(runs,binding.childJobId),state=await jobJson(dir,'engineering.json'),revision=q.revision??state.revision;
 if(revision!==state.revision)throw Error('TASK_DATA_CURRENT_REVISION_REQUIRED: inspect immutable historical input files; this reader exposes only the current revision');
 const input=await jobJson(dir,'input-'+revision+'.json'),inputSHA256=engineeringDigest(input);
 if(inputSHA256!==state.inputSHA256)throw Error('ENGINEERING_INPUT_CHANGED');
 if(input.spaceProgram&&input.spaceProgram.expectedProjectId!==manifest.project.id)throw Error('TASK_SHARED_PROJECT_MISMATCH');
 const upstream=await verifyLightingSpaceProgram(input,{runs});
 let values;
 if(q.section==='input')values=documentTargets('ordinary-lighting',input);
 else if(q.section==='space_program_changes')values=(input.spaceProgramChanges??[]).map((value,index)=>({id:'spaceProgramChanges/'+index,value,valueSHA256:digest(value)}));
 else{
  const rows=[['adoption',{hasSharedSpaceBinding:!!input.spaceProgram,expectedRevision:revision,expectedInputSHA256:inputSHA256,expectedConditionsSHA256:frozenLightingSpaceConditions(input)}],['binding',input.spaceProgram??null],['upstream',upstream??null],...Object.entries(frozenLightingSpaceConditionValues(input)).filter(([,value])=>value!==undefined).map(([id,value])=>['frozen/'+id,value])];
  values=rows.map(([id,value])=>({id,value,valueSHA256:digest(value)}));
 }
 const dataSHA256=digest({section:q.section,revision,inputSHA256,values});if(q.expectedDataSHA256&&q.expectedDataSHA256.toLowerCase()!==dataSHA256)throw Error('TASK_DATA_SNAPSHOT_CHANGED');
 const items=[];let bytes=0;for(const row of values.slice(q.offset,q.offset+q.limit)){const n=Buffer.byteLength(JSON.stringify(row));if(n>256*1024&&!items.length)throw Error('TASK_DATA_ITEM_TOO_LARGE');if(bytes+n>256*1024)break;items.push(row);bytes+=n;}
 // A concurrent source/input change must not produce a mixed snapshot page.
 const after=await jobJson(dir,'engineering.json');if(after.revision!==revision||after.inputSHA256!==inputSHA256||digest(await verifyLightingSpaceProgram(input,{runs})??null)!==digest(upstream??null))throw Error('TASK_DATA_CHANGED_DURING_READ');
 return {ok:true,jobId:q.jobId,projectId:manifest.project.id,section:q.section,revision,inputSHA256,dataSHA256,inputCurrent:true,upstreamCurrent:upstream?.current??null,availableSections:lightingDataSections,offset:q.offset,limit:q.limit,total:values.length,returned:items.length,nextOffset:q.offset+items.length,hasMore:q.offset+items.length<values.length,items,readOnly:true,semanticCoverageAccepted:false,professionalApproval:false,scope:'Persisted current input and exact unchanged-condition digest only. Caller must review new producer spaces, source quotes, use/schedule and independent lighting conditions before adopting. Unknown, changed or unsupported authority remains blocked; no model, document review or approval is created.'};
}
