import {z} from 'zod';
const sha=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
export const titleTaskRef=z.strictObject({jobId:z.string().regex(/^job-task-[a-f0-9-]{36}$/),expectedProjectId:z.uuid(),expectedTaskSHA256:sha});
export const titleRevisionParameters=z.strictObject({expectedRevision:z.number().int().nonnegative(),expectedInputSHA256:sha,expectedTitle:z.string().min(1).max(128),title:z.string().trim().min(1).max(128).refine(s=>!/[\u0000-\u001f\u007f]/.test(s),'A drawing title must be one plain-text line'),reason:z.string().min(10).max(1000),evidence:z.array(z.strictObject({documentId:id,textSHA256:sha,quote:z.string().min(5).max(4000)})).min(1).max(10)});
export const engineeringTitleSchema=z.discriminatedUnion('action',[
 z.strictObject({action:z.literal('inspect'),task:titleTaskRef}),
 z.strictObject({action:z.literal('revise'),requestId:z.uuid(),task:titleTaskRef,parameters:titleRevisionParameters}),
 z.strictObject({action:z.literal('status'),jobId:z.string().regex(/^job-titlechange-[a-f0-9-]{36}$/),task:titleTaskRef})
]);
export const readonlyEngineeringTitleSchema=z.discriminatedUnion('action',engineeringTitleSchema.options.filter(s=>s.shape.action.value!=='revise'));
