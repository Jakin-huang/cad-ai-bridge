import path from 'node:path';
import {dependencyDigest} from './task-dependencies.mjs';
import {hashFile} from './drawings.mjs';
import {loadPlanningHandoff} from './space-planning-handoff.mjs';
export const planningDataSections=['spaces','context','sources','space_bindings'];
export async function readPlanningData(manager,binding,q,manifest,{runs}){
 if(!planningDataSections.includes(q.section))throw Error('TASK_DATA_SECTION_UNSUPPORTED');const {dir,s}=await manager.load(binding),revision=q.revision??s.revision,file=path.join(dir,'space-pack-'+revision+'.json'),sha256=await hashFile(file).catch(e=>{if(e.code==='ENOENT')throw Error('TASK_DATA_NOT_PUBLISHED_FOR_REVISION');throw e;});if(q.expectedDataSHA256&&q.expectedDataSHA256.toLowerCase()!==sha256)throw Error('TASK_DATA_SNAPSHOT_CHANGED');const ref={jobId:s.jobId,revision,sha256},loaded=await loadPlanningHandoff(ref,{runs,expectedProjectId:manifest.project.id}),values=q.section==='space_bindings'?loaded.pack.spaces.map(space=>({...space,functionSHA256:dependencyDigest(space.function)})):loaded.pack[q.section],items=[];let bytes=0;
 for(const value of values.slice(q.offset,q.offset+q.limit)){const size=Buffer.byteLength(JSON.stringify(value));if(size>256*1024&&!items.length)throw Error('TASK_DATA_ITEM_TOO_LARGE');if(bytes+size>256*1024)break;items.push(value);bytes+=size;}
 return {ok:true,jobId:q.jobId,projectId:manifest.project.id,section:q.section,revision,dataSHA256:sha256,ref,producer:loaded.pack.producer,native:loaded.pack.native,role:loaded.pack.role,derivedFromFinalDrawing:loaded.pack.derivedFromFinalDrawing,units:loaded.pack.units,current:loaded.current,availableSections:planningDataSections,offset:q.offset,limit:q.limit,total:values.length,returned:items.length,nextOffset:q.offset+items.length,hasMore:q.offset+items.length<values.length,items,pending:loaded.pack.pending,professionalApproval:false};
}
