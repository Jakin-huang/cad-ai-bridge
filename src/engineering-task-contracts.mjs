import {z} from 'zod';
const digest=z.string().regex(/^[a-fA-F0-9]{64}$/),jobId=z.string().regex(/^job-task-[a-f0-9-]{36}$/),parameters=z.record(z.string(),z.unknown());
export const engineeringTaskSchema=z.discriminatedUnion('action',[
 z.strictObject({action:z.literal('capabilities')}),
 z.strictObject({action:z.literal('prepare'),requestId:z.uuid(),project:z.strictObject({id:z.uuid(),name:z.string().min(1).max(128),type:z.string().min(1).max(64)}),task:z.strictObject({kind:z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),title:z.string().min(1).max(128),objective:z.string().min(20).max(4000)}),parameters}),
 z.strictObject({action:z.literal('dependencies'),jobId,expectedProjectId:z.uuid(),expectedTaskSHA256:digest,operationRequestId:z.uuid().optional(),view:z.enum(['current','impact']).default('current'),expectedGraphSHA256:digest.optional(),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(100).default(25)}),
 z.strictObject({action:z.literal('status'),jobId,expectedProjectId:z.uuid(),expectedTaskSHA256:digest}),
 z.strictObject({action:z.literal('invoke'),jobId,expectedProjectId:z.uuid(),expectedTaskSHA256:digest,requestId:z.uuid(),operation:z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),parameters})
]);
export const readonlyEngineeringTaskSchema=z.discriminatedUnion('action',engineeringTaskSchema.options.filter(s=>['capabilities','status','dependencies'].includes(s.shape.action.value)));
