import {z} from 'zod';
const str=z.string().min(1).max(260);
const id=z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const layerName=z.string().regex(/^(?:0|[A-Z][A-Z0-9_-]{0,63})$/);
const point=z.tuple([z.number().finite().min(-1e9).max(1e9),z.number().finite().min(-1e9).max(1e9),z.literal(0)]);
const instance=z.strictObject({id,position:point,layer:layerName.optional(),rotationRadians:z.number().finite().default(0),attributes:z.record(z.string().min(1).max(64),z.string().max(512)).default({})});
const projectInstance=instance.omit({layer:true}).extend({portOffset:point});
const endpoint=z.strictObject({id,port:z.literal('PWR')});
const wireField=z.string().min(1).max(128);
const wireSpec=z.strictObject({wireType:wireField.optional(),conductorSpec:wireField.optional(),method:wireField.optional(),installation:wireField.optional(),conduitDiameter:wireField.optional()});
const host=z.enum(['core','tangent']).optional();
const detail=z.enum(['summary','full']).optional();
const primitive=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('polyline'),layer:layerName,points:z.array(point).min(2).max(1000),closed:z.boolean().default(false),width:z.number().positive().max(10000).optional()}),
 z.strictObject({kind:z.literal('solid'),layer:layerName,points:z.array(point).length(3)}),
 z.strictObject({kind:z.literal('circle'),layer:layerName,position:point,radius:z.number().positive().max(1e6)}),
 z.strictObject({kind:z.literal('text'),layer:layerName,position:point,text:z.string().min(1).max(512).regex(/^[^\r\n\x00]*$/),height:z.number().positive().max(10000),rotationRadians:z.number().finite().default(0),widthFactor:z.number().min(0.01).max(10).optional()})
]);
export const sceneSchema=z.strictObject({
 view:z.strictObject({center:point,width:z.number().positive().max(1e9),height:z.number().positive().max(1e9)}).optional(),
 views:z.array(z.strictObject({name:id,center:point,width:z.number().positive().max(1e9),height:z.number().positive().max(1e9)})).max(100).optional(),
 layers:z.array(z.strictObject({name:layerName,color:z.number().int().min(1).max(255)})).min(1).max(100),
 symbols:z.array(z.strictObject({name:id,geometry:z.array(primitive).min(1).max(1000),attributes:z.array(z.strictObject({tag:id,position:point,height:z.number().positive().max(10000),visible:z.boolean(),value:z.string().max(512)})).max(20)})).max(100),
 entities:z.array(primitive).max(20000)
}).superRefine((scene,ctx)=>{
 const layers=new Set(['0']);for(const l of scene.layers){if(layers.has(l.name))ctx.addIssue({code:'custom',message:'Duplicate layer '+l.name});layers.add(l.name);}
 const names=new Set();for(const s of scene.symbols){if(names.has(s.name))ctx.addIssue({code:'custom',message:'Duplicate symbol '+s.name});names.add(s.name);const tags=new Set();for(const a of s.attributes){if(tags.has(a.tag.toUpperCase()))ctx.addIssue({code:'custom',message:'Duplicate attribute '+a.tag});tags.add(a.tag.toUpperCase());}}
 const views=new Set();for(const v of scene.views||[]){if(views.has(v.name.toUpperCase()))ctx.addIssue({code:'custom',message:'Duplicate named view '+v.name});views.add(v.name.toUpperCase());}
 for(const e of [...scene.entities,...scene.symbols.flatMap(s=>s.geometry)])if(!layers.has(e.layer))ctx.addIssue({code:'custom',message:'Undefined layer '+e.layer});
});
const operation=z.discriminatedUnion('type',[
 z.strictObject({type:z.literal('clone_project_symbols'),templateHandle:z.string().regex(/^[A-Fa-f0-9]{1,16}$/),instances:z.array(projectInstance).min(1).max(100)}),
 z.strictObject({type:z.literal('place_symbols'),blockName:z.string().min(1).max(128),instances:z.array(instance).min(1).max(2000)}),
 z.strictObject({type:z.literal('connect_route'),id,circuitId:z.string().min(1).max(64),from:endpoint,to:endpoint,vertices:z.array(point).min(2).max(1000),layer:layerName.optional(),wireSpec:wireSpec.optional()}),
 z.strictObject({type:z.literal('number_devices'),ids:z.array(id).min(1).max(2000),prefix:z.string().max(32),start:z.number().int().min(0).max(1e8),width:z.number().int().min(1).max(9)})
]);
export const schemas={
 doctor:z.strictObject({refresh:z.boolean().default(false)}),
 get_job:z.strictObject({jobId:z.string().regex(/^job-[A-Za-z0-9_-]+$/).optional(),requestId:z.uuid().optional()}).refine(v=>Boolean(v.jobId)!==Boolean(v.requestId),{message:'Provide exactly one of jobId or requestId'}),
 audit_drawing:z.strictObject({drawing:str,host,detail}),
 prepare_project:z.strictObject({drawing:str,expectedSha256:z.string().regex(/^[a-fA-F0-9]{64}$/),requestId:z.uuid(),units:z.literal('mm'),host}),
 repair_copy:z.strictObject({drawing:str,expectedSha256:z.string().regex(/^[a-fA-F0-9]{64}$/),requestId:z.uuid(),host}),
 create_test_drawing:z.strictObject({adapter:z.enum(['generic','tangent-v8']).optional()}),
 create_drawing:z.strictObject({scene:sceneSchema}),
 tangent_inspect:z.strictObject({drawing:str,units:z.literal('mm').optional(),host,detail}),
 tangent_takeoff:z.strictObject({drawing:str,units:z.literal('mm').optional(),host,detail}),
 read_result:z.strictObject({jobId:z.string().regex(/^job-[A-Za-z0-9_-]+$/),kind:z.enum(['devices','wires','circuits','inserts','definitions','texts','managedDevices','routes','symbols','issues']),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(100).default(25)}),
 native_status:z.strictObject({drawing:str}),
 inspect:z.strictObject({drawing:str,host}),
 takeoff:z.strictObject({drawing:str,host}),
 validate:z.strictObject({drawing:str,host}),
 apply:z.strictObject({drawing:str,expectedSha256:z.string().regex(/^[a-fA-F0-9]{64}$/),documentId:z.uuid(),expectedRevision:z.number().int().nonnegative(),requestId:z.uuid(),units:z.literal('mm'),adapter:z.enum(['generic','tangent-v8','tangent-project']).optional(),host,operations:z.array(operation).min(1).max(100)})
};
