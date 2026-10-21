import {z} from 'zod';
import {sharedSpaceRefSchema} from './shared-space-contracts.mjs';
const id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),sha=z.string().regex(/^[a-f0-9]{64}$/i),job=z.string().regex(/^job-design-[a-f0-9-]{36}$/),point=z.tuple([z.number().finite(),z.number().finite()]);
const evidence={quote:z.string().min(5).max(4000),reason:z.string().min(20).max(1000)};
export const revisionRule=z.enum(['target_lux','max_lpd','max_spacing','max_devices','max_circuit_watts','max_drop','control_mode','mounting_height','min_uniformity','max_avg_lux']);
const value=z.union([z.number().finite(),z.string().min(1).max(128)]);
export const revisionPlanSchema=z.strictObject({
 action:z.literal('draft'),jobId:job,requestId:z.uuid(),expectedRevision:z.number().int().nonnegative(),expectedInputSHA256:sha,
 briefFile:z.string().min(1).max(2000),expectedBriefSHA256:sha,spacePack:sharedSpaceRefSchema,
 sourceEvidence:z.strictObject(evidence),carryForward:z.strictObject(evidence),
 rooms:z.array(z.strictObject({roomId:id,use:z.enum(['office','duty','teaching','corridor','pantry','clinical','unknown']),fromRoomId:id,...evidence,
  conditions:z.strictObject({heightM:z.number().min(2).max(10).optional(),workplaneM:z.number().min(0).max(2).optional(),obstacles:z.array(z.array(point).min(3).max(50)).max(20).optional(),...evidence}).optional(),
  classification:z.strictObject({classId:id,...evidence}).optional(),
  requirements:z.array(z.strictObject({rule:revisionRule,values:z.array(value).min(1).max(10),status:z.enum(['assumed','interpreted']).optional(),...evidence})).max(10).default([]),
  unresolvedRules:z.array(z.strictObject({rule:revisionRule,...evidence})).max(10).default([])
 })).min(1).max(100),
 removedRooms:z.array(z.strictObject({roomId:id,...evidence})).max(100).default([]),
 standardScopes:z.array(z.strictObject({standardId:id,clauseId:id,roomIds:z.array(id).max(100),...evidence})).max(1000).default([]),
 resolvedMissingInputs:z.array(z.strictObject({id,...evidence})).max(100).default([])
});
export const revisionDraftRef=z.strictObject({jobId:job,draftId:z.uuid(),sha256:sha});
export const engineeringRevisionSchema=z.discriminatedUnion('action',[
 revisionPlanSchema,
 z.strictObject({action:z.literal('read'),draft:revisionDraftRef,section:z.enum(['summary','requirements','conditions','proposal']).default('summary'),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(100).default(25)}),
 z.strictObject({action:z.literal('apply'),requestId:z.uuid(),draft:revisionDraftRef})
]);
