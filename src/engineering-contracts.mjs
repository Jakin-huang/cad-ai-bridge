import {z} from 'zod';
import {architectureInspectionSchema,architecturalPackRef} from './architectural-contracts.mjs';
import {inspectSpacePolygon,spaceInteriorsOverlap} from './architectural-spaces.mjs';

const id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const digest=z.string().regex(/^[a-f0-9]{64}$/i);
const isoDay=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v,'Invalid calendar date');
const point=z.tuple([z.number().finite().min(-1e8).max(1e8),z.number().finite().min(-1e8).max(1e8)]);
const source=z.strictObject({id,role:z.enum(['architecture','brief','standard','catalog','review_instruction']),sha256:digest,description:z.string().min(1).max(1000),location:z.string().max(1000).optional(),derivedFromFinalDrawing:z.boolean().default(false)});
const requirementValue=z.union([z.number().finite(),z.string().min(1).max(128)]).describe('Units: target_lux=lx; max_lpd=W/m2; max_spacing and mounting_height=m; max_devices=count; max_circuit_watts=W; max_drop=percentage points, use 3 for 3 percent, not 0.03. min_uniformity=Emin/Eavg fraction (0,1]; max_avg_lux=lx. control_mode accepts only local (就地), regional_manual (区域集中并手动), occupancy_manual (感应并可手动).');
const requirement=z.strictObject({id,rule:z.enum(['target_lux','max_lpd','max_spacing','max_devices','max_circuit_watts','max_drop','control_mode','mounting_height','min_uniformity','max_avg_lux']),value:requirementValue,roomIds:z.array(id).min(1).max(100),sourceIds:z.array(id).min(1).max(20),rationale:z.string().min(1).max(1000),status:z.enum(['documented','interpreted','assumed'])});
const primitive=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('line'),points:z.array(point).length(2)}),
 z.strictObject({kind:z.literal('polyline'),points:z.array(point).min(2).max(500),closed:z.boolean()})
]);
export const engineeringInputSchema=z.strictObject({
 schemaVersion:z.literal(1),projectId:id,title:z.string().min(1).max(128),designDate:isoDay,
 discipline:z.literal('ordinary-lighting'),scope:z.string().min(20).max(3000),brief:z.string().min(20).max(16000),
 sources:z.array(source).min(1).max(100),requirements:z.array(requirement).min(1).max(1000),
 standards:z.array(z.strictObject({id,code:z.string().min(1).max(128),edition:z.string().min(1).max(128),effectiveFrom:isoDay,effectiveUntil:isoDay.optional(),sourceId:id,clauses:z.array(z.strictObject({id,locator:z.string().min(1).max(128),verified:z.boolean(),summary:z.string().min(1).max(1500),check:z.enum(['terminal_protection','low_mount_rcd','corridor_control','professional_review']),roomIds:z.array(id).max(100)})).max(100)})).max(100),
 rooms:z.array(z.strictObject({id,name:z.string().min(1).max(128),use:z.enum(['office','duty','teaching','corridor','pantry','clinical','unknown']),polygon:z.array(point).min(3).max(100),doors:z.array(point).max(20),obstacles:z.array(z.array(point).min(3).max(50)).max(20).default([]),sourceIds:z.array(id).min(1).max(20),geometryStatus:z.enum(['issued','inferred']),heightM:z.number().min(2).max(10),workplaneM:z.number().min(0).max(2),standardSpace:z.strictObject({classId:id,classification:z.enum(['documented','interpreted','assumed']),sourceIds:z.array(id).min(1).max(20),reason:z.string().min(1).max(1000)}).optional()})).min(1).max(100),
 architecture:z.array(primitive).max(8000),
 luminaires:z.array(z.strictObject({id,label:z.string().min(1).max(128),watts:z.number().positive().max(500),lumens:z.number().positive().max(100000),utilizationFactor:z.number().positive().max(1),maintenanceFactor:z.number().positive().max(1),sourceId:id,photometry:z.enum(['assumed','catalog_only','ies_verified']),iesFile:z.strictObject({file:z.string().min(1).max(2000),sha256:digest}).optional(),rotationDegrees:z.number().finite().min(-360).max(360).optional(),schematicSymbol:z.enum(['panel','downlight']).optional(),allowedRoomUses:z.array(z.enum(['office','duty','teaching','corridor','pantry'])).min(1).max(5).optional(),ra:z.number().min(0).max(100),cctK:z.number().int().min(2000).max(7000)})).min(1).max(20),
 lightingStandards:z.strictObject({profileId:id,expectedProfileSHA256:digest}).optional(),
 photometricDesign:z.strictObject({method:z.literal('ies_direct_point'),gridSpacingM:z.number().min(.1).max(2),edgeOffsetM:z.number().min(.05).max(1),boundaryModel:z.literal('opaque_vertical_room_walls')}).optional(),
 electrical:z.strictObject({panelId:id,panelPosition:point,voltage:z.number().min(100).max(300),powerFactor:z.number().positive().max(1),wireSectionMm2:z.number().positive().max(25),copperOhmMm2PerM:z.number().positive().max(0.05),assumedIzA:z.number().positive().max(100),breakerA:z.number().positive().max(100),extraLengthM:z.number().nonnegative().max(100),shortCircuitProtection:z.boolean(),overloadProtection:z.boolean(),earthFaultProtection:z.boolean(),rcd:z.boolean(),sourceIds:z.array(id).min(1).max(20)}),
 missingInputs:z.array(z.strictObject({id,description:z.string().min(1).max(1000),severity:z.enum(['blocking','review']),sourceIds:z.array(id).max(20)})).max(100)
}).superRefine((p,ctx)=>{
 for(const room of p.rooms)if(!inspectSpacePolygon(room.polygon).ok)ctx.addIssue({code:'custom',message:'Invalid room polygon: '+room.id});
 for(let i=0;i<p.rooms.length;i++)for(let j=i+1;j<p.rooms.length;j++)if(spaceInteriorsOverlap(p.rooms[i].polygon,p.rooms[j].polygon))ctx.addIssue({code:'custom',message:'Overlapping room interiors: '+p.rooms[i].id+' / '+p.rooms[j].id});
 for(const [label,items] of [['source',p.sources],['room',p.rooms],['requirement',p.requirements],['standard',p.standards],['luminaire',p.luminaires]])if(new Set(items.map(i=>i.id)).size!==items.length)ctx.addIssue({code:'custom',message:'Duplicate '+label+' identity'});
 const sources=new Set(p.sources.map(s=>s.id)),rooms=new Set(p.rooms.map(r=>r.id));
 for(const item of [...p.rooms,...p.rooms.flatMap(r=>r.standardSpace?[r.standardSpace]:[]),...p.requirements,p.electrical,...p.missingInputs])for(const ref of item.sourceIds)if(!sources.has(ref))ctx.addIssue({code:'custom',message:'Unknown source '+ref});
 for(const item of [...p.luminaires,...p.standards])if(!sources.has(item.sourceId))ctx.addIssue({code:'custom',message:'Unknown source '+item.sourceId});
 for(const req of p.requirements)for(const ref of req.roomIds)if(!rooms.has(ref))ctx.addIssue({code:'custom',message:'Unknown requirement room '+ref});
 for(const standard of p.standards)for(const clause of standard.clauses)for(const ref of clause.roomIds)if(!rooms.has(ref))ctx.addIssue({code:'custom',message:'Unknown clause room '+ref});
});

const jobId=z.string().regex(/^job-design-[a-f0-9-]{36}$/i);
export const engineeringSchema=z.discriminatedUnion('action',[
 architectureInspectionSchema,
 z.strictObject({action:z.literal('lighting_basis')}),
 z.strictObject({action:z.literal('prepare'),requestId:z.uuid(),project:engineeringInputSchema}),
 z.strictObject({action:z.literal('prepare_from_seed'),requestId:z.uuid(),seedFile:z.string().min(1).max(2000),expectedSeedSHA256:digest,requirements:z.array(requirement).min(1).max(1000),architecturalPack:architecturalPackRef.optional()}),
 z.strictObject({action:z.literal('status'),jobId,section:z.enum(['summary','input','model','checks','delivery','review','history']).default('summary')}),
 z.strictObject({action:z.literal('design'),jobId,expectedRevision:z.number().int().nonnegative()}),
 z.strictObject({action:z.literal('deliver'),jobId,requestId:z.uuid(),expectedModelSHA256:digest}),
 z.strictObject({action:z.literal('revise'),jobId,expectedRevision:z.number().int().nonnegative(),changes:z.array(z.strictObject({requirementId:id,value:requirementValue,reason:z.string().min(1).max(1000),sourceId:id})).min(1).max(100)}),
 z.strictObject({action:z.literal('review'),jobId,expectedModelSHA256:digest,origin:z.enum(['simulation','unverified_external_record']),reviewer:z.string().min(1).max(128),comments:z.array(z.strictObject({id,target:z.string().min(1).max(128),decision:z.enum(['comment','revise','claimed_accepted']),text:z.string().min(1).max(2000)})).min(1).max(100)})
]);
export const readonlyEngineeringSchema=z.discriminatedUnion('action',engineeringSchema.options.filter(s=>s.shape.action.value!=='deliver'));

export function inspectEngineeringInput(raw){
 const input=engineeringInputSchema.parse(raw),issues=[];
 const add=(code,severity,message,refs=[])=>issues.push({code,severity,message,refs});
 const rules=['target_lux','max_lpd','max_spacing','max_devices','max_circuit_watts','max_drop','control_mode','mounting_height',...(input.photometricDesign?['min_uniformity','max_avg_lux']:[])];
 for(const room of input.rooms){
  if(['clinical','unknown'].includes(room.use))add('ROOM_USE_REQUIRES_SPECIALIST','blocking','Unsupported clinical/unknown room classification: '+room.id,[room.id]);
  if(room.geometryStatus==='inferred')add('ROOM_GEOMETRY_INFERRED','review','Room boundary requires architectural confirmation',[room.id]);
  for(const rule of rules){const found=input.requirements.filter(r=>r.rule===rule&&r.roomIds.includes(room.id));
   if(!found.length)add('REQUIREMENT_MISSING','blocking',room.id+' is missing '+rule,[room.id]);
   else if(new Set(found.map(v=>JSON.stringify(v.value))).size>1)add('REQUIREMENT_CONFLICT','blocking',room.id+' has conflicting '+rule,found.map(r=>r.id));
   else if(rule==='control_mode'?!['local','regional_manual','occupancy_manual'].includes(found[0].value):typeof found[0].value!=='number'||found[0].value<=0)add('REQUIREMENT_INVALID','blocking',room.id+' has invalid '+rule+' = '+JSON.stringify(found[0].value)+(rule==='control_mode'?'; allowed: local (就地), regional_manual (区域集中并手动), occupancy_manual (感应并可手动)':'; use a positive number in the documented units; max_drop=3 means 3 percent'),found.map(r=>r.id));
   if(found.some(v=>v.status==='assumed'))add('REQUIREMENT_ASSUMED','review',room.id+' '+rule+' is a declared project assumption',found.map(r=>r.id));
  }
 }
 for(const s of input.standards){const applicable=s.effectiveFrom<=input.designDate&&(!s.effectiveUntil||input.designDate<s.effectiveUntil);for(const c of s.clauses){if(!applicable)add('STANDARD_OUTSIDE_DATE','review',s.id+' is outside the declared design date',[c.id]);else if(!c.verified)add('STANDARD_CLAUSE_UNVERIFIED','review',s.id+' '+c.locator+' text is not verified',[c.id]);}}
 if(!input.standards.length)add('STANDARDS_MISSING','review','No project standards supplied');
 if(input.sources.some(s=>s.derivedFromFinalDrawing))add('RETROSPECTIVE_INPUT','review','Architectural inputs were derived from historical final drawings; not a prospective blind trial');
 if(input.photometricDesign){
  if(input.luminaires.some(f=>!f.iesFile))add('IES_FILE_REQUIRED','blocking','Every candidate requires a source-bound IES file in direct-point mode');
  for(const room of input.rooms){const uniformity=input.requirements.find(r=>r.rule==='min_uniformity'&&r.roomIds.includes(room.id)),upper=input.requirements.find(r=>r.rule==='max_avg_lux'&&r.roomIds.includes(room.id)),target=input.requirements.find(r=>r.rule==='target_lux'&&r.roomIds.includes(room.id));if(uniformity&&!(uniformity.value>0&&uniformity.value<=1))add('UNIFORMITY_INVALID','blocking','Uniformity must be a fraction in (0,1]',[room.id]);if(upper&&target&&upper.value<target.value)add('ILLUMINANCE_RANGE_CONFLICT','blocking','Maximum average illuminance is below target',[room.id]);if(room.obstacles.length)add('PHOTOMETRIC_OBSTACLE_HEIGHT_REQUIRED','blocking','Obstacle heights and photometric surfaces are not supplied',[room.id]);}
  add('PHOTOMETRIC_SCOPE_LIMITATIONS','review','Direct point-source model excludes reflected light, UGR and daylight; actual luminous-opening size, surfaces and installation need validation');
 }
 if(!input.photometricDesign)add('PHOTOMETRY_UNVERIFIED','review','Flux-method estimate is not point illuminance, uniformity or UGR verification');
 for(const m of input.missingInputs)add('MISSING_PROJECT_INPUT',m.severity,m.description,[m.id]);
 return {ok:!issues.some(i=>i.severity==='blocking'),issues,requirements:input.requirements.length,rooms:input.rooms.length,input};
}
