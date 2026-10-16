import {z} from 'zod';
const str=z.string().min(1).max(260);
const id=z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const point=z.tuple([z.number().finite().min(-1e9).max(1e9),z.number().finite().min(-1e9).max(1e9),z.literal(0)]);
const instance=z.strictObject({id,position:point,rotationRadians:z.number().finite().default(0),attributes:z.record(z.string().min(1).max(64),z.string().max(512)).default({})});
const projectInstance=instance.extend({portOffset:point});
const endpoint=z.strictObject({id,port:z.literal('PWR')});
const wireField=z.string().min(1).max(128);
const wireSpec=z.strictObject({wireType:wireField.optional(),conductorSpec:wireField.optional(),method:wireField.optional(),installation:wireField.optional(),conduitDiameter:wireField.optional()});
const host=z.enum(['core','tangent']).optional();
const detail=z.enum(['summary','full']).optional();
const operation=z.discriminatedUnion('type',[
 z.strictObject({type:z.literal('clone_project_symbols'),templateHandle:z.string().regex(/^[A-Fa-f0-9]{1,16}$/),instances:z.array(projectInstance).min(1).max(100)}),
 z.strictObject({type:z.literal('place_symbols'),blockName:z.string().min(1).max(128),instances:z.array(instance).min(1).max(2000)}),
 z.strictObject({type:z.literal('connect_route'),id,circuitId:z.string().min(1).max(64),from:endpoint,to:endpoint,vertices:z.array(point).min(2).max(1000),wireSpec:wireSpec.optional()}),
 z.strictObject({type:z.literal('number_devices'),ids:z.array(id).min(1).max(2000),prefix:z.string().max(32),start:z.number().int().min(0).max(1e8),width:z.number().int().min(1).max(9)})
]);
export const schemas={
 audit_drawing:z.strictObject({drawing:str,host,detail}),
 prepare_project:z.strictObject({drawing:str,expectedSha256:z.string().regex(/^[a-fA-F0-9]{64}$/),requestId:z.uuid(),units:z.literal('mm'),host}),
 repair_copy:z.strictObject({drawing:str,expectedSha256:z.string().regex(/^[a-fA-F0-9]{64}$/),requestId:z.uuid(),host}),
 create_test_drawing:z.strictObject({adapter:z.enum(['generic','tangent-v8']).optional()}),
 tangent_inspect:z.strictObject({drawing:str,units:z.literal('mm').optional(),host,detail}),
 tangent_takeoff:z.strictObject({drawing:str,units:z.literal('mm').optional(),host,detail}),
 read_result:z.strictObject({jobId:z.string().regex(/^job-[A-Za-z0-9_-]+$/),kind:z.enum(['devices','wires','circuits','inserts','definitions','texts']),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(100).default(25)}),
 native_status:z.strictObject({drawing:str}),
 inspect:z.strictObject({drawing:str,host}),
 takeoff:z.strictObject({drawing:str,host}),
 validate:z.strictObject({drawing:str,host}),
 apply:z.strictObject({drawing:str,expectedSha256:z.string().regex(/^[a-fA-F0-9]{64}$/),documentId:z.uuid(),expectedRevision:z.number().int().nonnegative(),requestId:z.uuid(),units:z.literal('mm'),adapter:z.enum(['generic','tangent-v8','tangent-project']).optional(),host,operations:z.array(operation).min(1).max(100)})
};
