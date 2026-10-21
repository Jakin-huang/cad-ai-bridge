import {z} from 'zod';
import {engineeringSchema} from './engineering-contracts.mjs';
import {engineeringTaskSchema} from './engineering-task-contracts.mjs';
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
 z.strictObject({kind:z.literal('line'),layer:layerName,points:z.array(point).length(2)}),
 z.strictObject({kind:z.literal('arc'),layer:layerName,position:point,radius:z.number().positive().max(1e6),startAngle:z.number().finite(),endAngle:z.number().finite()}),
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
 const layers=new Set();for(const l of scene.layers){if(layers.has(l.name))ctx.addIssue({code:'custom',message:'Duplicate layer '+l.name});layers.add(l.name);}layers.add('0');
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
 read_result:z.strictObject({jobId:z.string().regex(/^job-[A-Za-z0-9_-]+$/),kind:z.enum(['devices','wires','circuits','inserts','definitions','texts','managedDevices','routes','symbols','issues','entities']),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(100).default(25)}),
 native_status:z.strictObject({drawing:str}),
 inspect:z.strictObject({drawing:str,host}),
 takeoff:z.strictObject({drawing:str,host}),
 validate:z.strictObject({drawing:str,host}),
 apply:z.strictObject({drawing:str,expectedSha256:z.string().regex(/^[a-fA-F0-9]{64}$/),documentId:z.uuid(),expectedRevision:z.number().int().nonnegative(),requestId:z.uuid(),units:z.literal('mm'),adapter:z.enum(['generic','tangent-v8','tangent-project']).optional(),host,operations:z.array(operation).min(1).max(100)})
};

const handle=z.string().regex(/^[A-Fa-f0-9]{1,16}$/);
const handles=z.array(handle).min(1).max(1000).refine(a=>new Set(a.map(h=>h.toUpperCase())).size===a.length,'Duplicate handles');
const cadLayer=z.string().min(1).max(255).regex(/^[^<>/\\":;?*|=\x00-\x1f]+$/);
const region=z.strictObject({min:point,max:point,mode:z.enum(['intersects','contains']).default('intersects')}).refine(v=>v.min[0]<v.max[0]&&v.min[1]<v.max[1],'Invalid region');
const properties=z.record(z.string().min(1).max(64),z.string().max(512)).refine(v=>Object.keys(v).length>0&&Object.keys(v).length<=20,'Expected 1..20 attributes');
const editOperation=z.discriminatedUnion('type',[
 z.strictObject({type:z.literal('create_native_tray'),fromPoint:point,toPoint:point,width:z.number().positive().max(10000),height:z.number().positive().max(10000)}).refine(v=>Math.hypot(...v.fromPoint.map((n,i)=>n-v.toPoint[i]))>1e-6,'Tray is too short'),
 z.strictObject({type:z.literal('set_native_tray_size'),handle,width:z.number().positive().max(10000),height:z.number().positive().max(10000)}),
 z.strictObject({type:z.literal('add_native_tray_label'),handle,position:point,landingPoint:point}).refine(v=>v.position.some((n,i)=>n!==v.landingPoint[i]),'Label landing must differ from its corner'),
 z.strictObject({type:z.literal('move'),handles,delta:point}),
 z.strictObject({type:z.literal('copy'),handles,delta:point}),
 z.strictObject({type:z.literal('rotate'),handles,center:point,angleRadians:z.number().finite()}),
 z.strictObject({type:z.literal('scale'),handles,center:point,factor:z.number().positive().max(1000)}),
 z.strictObject({type:z.literal('mirror'),handles,axisStart:point,axisEnd:point,copy:z.boolean().default(true)}).refine(v=>v.axisStart.some((n,i)=>n!==v.axisEnd[i]),'Mirror axis has zero length'),
 z.strictObject({type:z.literal('array'),handles,rows:z.number().int().min(1).max(100),columns:z.number().int().min(1).max(100),rowSpacing:z.number().finite(),columnSpacing:z.number().finite()}).refine(v=>v.rows*v.columns<=200&&(v.rows===1||v.rowSpacing!==0)&&(v.columns===1||v.columnSpacing!==0),'Invalid array'),
 z.strictObject({type:z.literal('erase'),handles}),
 z.strictObject({type:z.literal('set_attributes'),handles,attributes:properties}),
 z.strictObject({type:z.literal('set_text'),handles,text:z.string().min(1).max(512).regex(/^[^\x00\r\n]*$/)}),
 z.strictObject({type:z.literal('set_layer'),handles,layer:cadLayer}),
 z.strictObject({type:z.literal('upsert_layer'),name:cadLayer,color:z.number().int().min(1).max(255),locked:z.boolean().optional(),off:z.boolean().optional()}),
 z.strictObject({type:z.literal('add_geometry'),entities:z.array(primitive).min(1).max(2000)}),
 z.strictObject({type:z.literal('insert_block'),blockName:z.string().min(1).max(255),position:point,rotationRadians:z.number().finite().default(0),layer:cadLayer,attributes:properties.optional()}),
 z.strictObject({type:z.literal('offset'),handles,distance:z.number().finite().min(-1e6).max(1e6).refine(n=>n!==0)}),
 z.strictObject({type:z.literal('trim'),handle,fromPoint:point,toPoint:point}),
 z.strictObject({type:z.literal('extend_line'),handle,endpoint:z.enum(['start','end']),position:point}),
 z.strictObject({type:z.literal('add_dimension'),kind:z.enum(['aligned','rotated']),fromPoint:point,toPoint:point,position:point,rotationRadians:z.number().finite().default(0),text:z.string().max(128).default(''),layer:cadLayer,height:z.number().positive().max(10000).default(120)}),
 z.strictObject({type:z.literal('upsert_view'),name:id,center:point,width:z.number().positive().max(1e9),height:z.number().positive().max(1e9)}),
 z.strictObject({type:z.literal('create_layout'),name:id,center:point,width:z.number().positive().max(1e9),height:z.number().positive().max(1e9)}),
 z.strictObject({type:z.literal('update_route'),id,circuitId:z.string().min(1).max(64).regex(/\S/).optional(),from:endpoint.optional(),to:endpoint.optional(),vertices:z.array(point).min(2).max(1000).optional(),wireSpec:wireSpec.optional()}),
 z.strictObject({type:z.literal('move_devices'),ids:z.array(id).min(1).max(1000).refine(a=>new Set(a).size===a.length,'Duplicate device IDs'),delta:point}),
 z.strictObject({type:z.literal('add_route_label'),id,position:point,height:z.number().positive().max(10000).default(120),layer:cadLayer})
]);
const queryScope=z.strictObject({layout:z.string().min(1).max(255).default('Model'),includeNested:z.boolean().default(false),maxDepth:z.number().int().min(1).max(8).default(4),rootHandles:handles.optional().describe('Restrict traversal to these root entities in the selected layout, not definition handles. Counts and completeness apply only to this selected scope; missing roots are reported as incomplete.')});
schemas.query_entities=z.strictObject({drawing:str,host,scope:queryScope.optional(),filter:z.strictObject({handles:handles.optional(),ids:z.array(id).min(1).max(1000).optional(),types:z.array(z.enum(['LINE','LWPOLYLINE','ARC','CIRCLE','TEXT','MTEXT','INSERT','DIMENSION','SOLID','TCH_CABLETRY','TCH_CABLEDIM'])).min(1).max(11).optional(),layers:z.array(cadLayer).min(1).max(100).optional(),blockName:z.string().min(1).max(255).optional(),textContains:z.string().min(1).max(128).optional(),attributes:properties.optional(),region:region.optional()}).default({}),limit:z.number().int().min(1).max(5000).default(1000)});
schemas.scan=schemas.query_entities.extend({limit:z.number().int().min(1).max(100000).default(100000),detail:z.enum(['summary','full']).default('summary'),exportDxf:z.boolean().default(false)});
const plot=z.strictObject({paper:z.enum(['A4','A3','A2','A1','A0']).default('A4'),orientation:z.enum(['portrait','landscape']).default('portrait'),scale:z.enum(['fit','fixed']).default('fit'),denominator:z.number().positive().max(100000).default(1),style:z.string().regex(/^[^<>/\\":;?*|=\x00-\x1f]+\.ctb$/i).max(128).optional()});
export const nativeOperations=new Set(['create_native_tray','set_native_tray_size','add_native_tray_label']);
schemas.edit=schemas.apply.extend({operations:z.array(z.union([operation,editOperation])).min(1).max(100)}).superRefine((v,ctx)=>{if(v.operations.some(op=>nativeOperations.has(op.type))){if(v.host==='core')ctx.addIssue({code:'custom',message:'Native operations require the Tangent host'});if(v.operations.some(op=>!nativeOperations.has(op.type)))ctx.addIssue({code:'custom',message:'Run native operations in their own batch'});}});
schemas.export=z.strictObject({drawing:str,host,format:z.enum(['pdf','png']),layout:z.string().min(1).max(255).default('Model'),region:region.optional(),plot:plot.optional()}).refine(v=>!v.plot||v.format==='pdf','Explicit engineering plot settings require PDF');
schemas.capabilities=z.strictObject({});
const workflowPlans=z.discriminatedUnion('type',[
 z.strictObject({type:z.literal('replace_text'),search:z.string().min(1).max(512),replacement:z.string().min(1).max(512).regex(/^[^\x00\r\n]*$/),match:z.enum(['exact','contains']).default('exact'),caseSensitive:z.boolean().default(true)}),
 z.strictObject({type:z.literal('organize'),attributes:properties.optional(),layer:cadLayer.optional()}).refine(v=>v.attributes||v.layer,'Provide attributes or layer'),
 z.strictObject({type:z.literal('takeoff'),groupBy:z.array(z.enum(['type','layer','blockName'])).min(1).max(3).default(['type','layer','blockName']),attributeTags:z.array(z.string().min(1).max(64)).max(10).default([])}),
 z.strictObject({type:z.literal('edit'),operations:z.array(editOperation).min(1).max(100).refine(ops=>ops.every(op=>!nativeOperations.has(op.type)),'Native workflows require the existing dedicated edit tools')}),
 z.strictObject({type:z.literal('export_batch'),items:z.array(z.strictObject({name:id,format:z.enum(['pdf','png']),layout:z.string().min(1).max(255).default('Model'),region:region.optional(),plot:plot.optional()}).refine(v=>!v.plot||v.format==='pdf','Explicit engineering plot settings require PDF')).min(1).max(50).refine(items=>new Set(items.map(i=>(i.name+'.'+i.format).toLowerCase())).size===items.length,'Duplicate output names')})
]);
const exclude=z.strictObject({layers:z.array(cadLayer).max(100).default([]),handles:z.array(handle).max(1000).default([]),blockNames:z.array(z.string().min(1).max(255)).max(100).default([]),regions:z.array(region).max(30).default([])});
schemas.workflow=z.strictObject({drawing:str,requestId:z.uuid(),host,filter:schemas.query_entities.shape.filter,scope:queryScope.optional(),exclude:exclude.optional(),plan:workflowPlans,preview:z.boolean().optional(),reviewRegion:region.optional(),response:z.enum(['summary','full']).default('full'),delivery:z.strictObject({csv:z.boolean().default(false),exports:workflowPlans.options.find(p=>p.shape.type.value==='export_batch').shape.items.optional()}).optional()});
// Keep common-task discovery small. Every edit still passes the full strict
// workflow/operation contract in createExecutor before any journal or CAD call.
// cad_edit advertises the complete operation-specific argument schemas on demand.
export const publicWorkflowSchema=schemas.workflow.extend({plan:z.discriminatedUnion('type',[...workflowPlans.options.filter(p=>p.shape.type.value!=='edit'),z.strictObject({type:z.literal('edit'),operations:z.array(z.record(z.string(),z.unknown())).min(1).max(100)})])});
const sessionEditTypes=new Set(['move','copy','rotate','scale','mirror','array','erase','set_text','set_attributes','set_layer','upsert_layer','add_geometry','insert_block','offset','trim','extend_line','add_dimension']);
schemas.session=z.discriminatedUnion('action',[
 z.strictObject({action:z.literal('status')}),
 z.strictObject({action:z.literal('list')}),
 z.strictObject({action:z.literal('connect'),pid:z.number().int().positive().optional()}),
 z.strictObject({action:z.literal('context'),sessionId:z.uuid()}),
 z.strictObject({action:z.literal('recover'),sessionId:z.uuid(),requestId:z.uuid()}),
 z.strictObject({action:z.literal('cancel'),sessionId:z.uuid(),requestId:z.uuid()}),
 z.strictObject({action:z.literal('query'),sessionId:z.uuid(),documentId:z.uuid(),expectedRevision:z.number().int().nonnegative(),filter:schemas.query_entities.shape.filter,limit:z.number().int().min(1).max(5000).default(1000),allowUnsaved:z.boolean().default(false)}),
 z.strictObject({action:z.literal('snapshot'),sessionId:z.uuid(),documentId:z.uuid(),expectedRevision:z.number().int().nonnegative(),requestId:z.uuid(),allowUnsaved:z.boolean().default(false)}),
 z.strictObject({action:z.literal('edit'),sessionId:z.uuid(),documentId:z.uuid(),expectedRevision:z.number().int().nonnegative(),requestId:z.uuid(),operations:z.array(editOperation).min(1).max(100).refine(ops=>ops.every(op=>sessionEditTypes.has(op.type)),'Only ordinary session edit operations are supported'),saveCopy:z.boolean().default(true),allowUnsaved:z.boolean().default(false)})
]);
export const readonlyWorkflowSchema=schemas.workflow.extend({plan:z.discriminatedUnion('type',workflowPlans.options.filter(plan=>['takeoff','export_batch'].includes(plan.shape.type.value)))});
export const readonlySessionSchema=z.discriminatedUnion('action',schemas.session.options.filter(action=>['list','status','context','query','recover','snapshot'].includes(action.shape.action.value)));
schemas.read_result=schemas.read_result.extend({filter:schemas.query_entities.shape.filter.removeDefault().optional(),fields:z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)).min(1).max(30).optional(),expectedResultSha256:z.string().regex(/^[a-fA-F0-9]{64}$/).optional()});
const analysisFilter=schemas.query_entities.shape.filter;
const ruleBase=z.strictObject({id,filter:analysisFilter,severity:z.enum(['info','warning','error']).default('warning'),authority:z.string().min(1).max(512).optional()});
schemas.analyze=z.strictObject({captureJobId:z.string().regex(/^job-[A-Za-z0-9_-]+$/),expectedResultSha256:z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),filter:analysisFilter,exclude:exclude.optional(),checks:z.array(z.discriminatedUnion('type',[
 ruleBase.extend({type:z.literal('duplicate_attribute'),tag:z.string().min(1).max(64),caseSensitive:z.boolean().default(false)}),
 ruleBase.extend({type:z.literal('required_attributes'),tags:z.array(z.string().min(1).max(64)).min(1).max(20)}),
 ruleBase.extend({type:z.literal('forbidden_text'),text:z.string().min(1).max(512),caseSensitive:z.boolean().default(false)}),
 ruleBase.extend({type:z.literal('allowed_layers'),layers:z.array(cadLayer).min(1).max(100)}),
 ruleBase.extend({type:z.literal('minimum_length'),minimum:z.number().finite().nonnegative().max(1e12),unit:z.enum(['drawing','mm']).default('mm')}),
 ruleBase.extend({type:z.literal('text_height'),minimumMm:z.number().finite().nonnegative().max(100000),maximumMm:z.number().finite().positive().max(100000)})
 ])).max(100).default([]),quantities:z.array(z.strictObject({id,version:z.string().min(1).max(64),filter:analysisFilter,meaning:z.enum(['drawing_occurrences','installed_rule','procurement_rule']).default('drawing_occurrences'),measure:z.enum(['count','length']),unit:z.enum(['mm','m']).default('m'),factor:z.number().finite().positive().max(1e6).default(1),wastePercent:z.number().finite().min(0).max(1000).default(0),roundUpTo:z.number().finite().positive().max(1e9).optional(),authority:z.string().min(1).max(512).optional()})).max(100).default([])}).superRefine((v,ctx)=>{const ids=[...v.checks,...v.quantities].map(r=>r.id);if(new Set(ids).size!==ids.length)ctx.addIssue({code:'custom',message:'Rule IDs must be unique'});if(!ids.length)ctx.addIssue({code:'custom',message:'Provide checks or quantity rules'});for(const r of v.checks)if(r.type==='text_height'&&r.minimumMm>r.maximumMm)ctx.addIssue({code:'custom',message:'Invalid text height range'});});
schemas.read_result=schemas.read_result.extend({kind:z.enum([...schemas.read_result.shape.kind.options,'quantityRows','quantityResults','checkResults','files','items'])});
const projectItem=schemas.workflow.omit({requestId:true,response:true}).extend({id:id.refine(v=>!/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(v),'Reserved Windows file name'),expectedSha256:z.string().regex(/^[a-fA-F0-9]{64}$/).optional()});
schemas.project=z.discriminatedUnion('action',[
 z.strictObject({action:z.literal('start'),requestId:z.uuid(),failurePolicy:z.enum(['stop','continue']).default('stop'),items:z.array(projectItem).min(1).max(100).refine(items=>new Set(items.map(i=>i.id.toUpperCase())).size===items.length,'Duplicate item IDs')}),
 z.strictObject({action:z.literal('list'),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(100).default(20)}),
 z.strictObject({action:z.literal('reexport'),jobId:z.string().regex(/^job-project-[a-fA-F0-9-]{36}$/),itemId:id,requestId:z.uuid(),names:z.array(id).min(1).max(50).optional()}),
 z.strictObject({action:z.literal('status'),jobId:z.string().regex(/^job-project-[a-fA-F0-9-]{36}$/),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(20).default(20)}),
 ...['cancel','resume'].map(action=>z.strictObject({action:z.literal(action),jobId:z.string().regex(/^job-project-[a-fA-F0-9-]{36}$/)}))
]);
schemas.export_many=z.strictObject({drawing:str,host,items:workflowPlans.options.find(p=>p.shape.type.value==='export_batch').shape.items});
export const readonlyProjectSchema=z.discriminatedUnion('action',schemas.project.options.map(option=>option.shape.action.value==='start'?option.extend({items:z.array(projectItem.extend({plan:readonlyWorkflowSchema.shape.plan})).min(1).max(100)}):option));
schemas.engineering=engineeringSchema;
schemas.engineering_task=engineeringTaskSchema;
export const publicProjectSchema=z.discriminatedUnion('action',schemas.project.options.map(option=>option.shape.action.value==='start'?option.extend({items:z.array(projectItem.extend({plan:publicWorkflowSchema.shape.plan})).min(1).max(100)}):option));
