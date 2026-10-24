// A new immutable task may retain a declared predecessor, but the relationship
// is never design, authority or professional acceptance.
import {z} from 'zod';import {jobDirectory,jobJson} from './jobs.mjs';import {dependencyDigest as digest} from './task-dependencies.mjs';
import path from 'node:path';import {hashFile} from './drawings.mjs';
const sha=z.string().regex(/^[a-f0-9]{64}$/);
export const preparationLineageSchema=z.strictObject({baseline:z.strictObject({jobId:z.string().regex(/^job-intake-[a-f0-9-]{36}$/),sha256:sha,projectId:z.uuid()}),draft:z.strictObject({jobId:z.string().regex(/^job-intakedraft-[a-f0-9-]{36}$/),sha256:sha})});
export async function preparationLineage({runs,lineage,manifest,requestId}){
 const dir=await jobDirectory(runs,lineage.baseline.jobId),b=await jobJson(dir,'baseline-record.json'),d=await jobJson(await jobDirectory(runs,lineage.draft.jobId),'draft.json');
 if(digest(b)!==lineage.baseline.sha256||b.jobId!==lineage.baseline.jobId||b.project.id!==lineage.baseline.projectId||digest(d)!==lineage.draft.sha256||d.jobId!==lineage.draft.jobId||digest(d.baseline)!==digest(lineage.baseline))throw Error('INTAKE_LINEAGE_RECORD_CHANGED');
 if(await hashFile(path.join(dir,'baseline.bin'))!==b.rawSHA256||digest(await jobJson(dir,'baseline.json'))!==b.inputContentSHA256)throw Error('INTAKE_LINEAGE_BASELINE_CHANGED');
 if(!b.reprepares||!d.compiled.ready||b.requestId!==requestId||digest(b.project)!==digest(manifest.project)||digest(b.task)!==digest(manifest.task)||digest(b.documents)!==digest(manifest.documents??null)||digest(b.scope)!==digest(manifest.scope??null))throw Error('INTAKE_LINEAGE_TASK_MISMATCH');
 const input=manifest.task.kind==='ordinary-lighting'?manifest.parameters.project:manifest.parameters.input;
 if(!input||digest(input)!==digest(d.compiled.input))throw Error('INTAKE_LINEAGE_INPUT_MISMATCH');
 return {schemaVersion:1,baseline:lineage.baseline,draft:lineage.draft,predecessor:b.reprepares.task,predecessorInputSHA256:b.reprepares.expectedInputSHA256,predecessorBaseline:b.reprepares.baseline,meaning:'New task prepared from the exact prior frozen physical baseline under a newer source/scope review; predecessor remains historical, no design or approval inherited',professionalApproval:false};
}
