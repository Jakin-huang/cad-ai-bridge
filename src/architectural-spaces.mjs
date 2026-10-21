import {inferRectangularRoom} from './engineering-spatial.mjs';
import {architecturalTextKey,normalizeArchitecturalText,composeArchitecturalLabel,inspectArchitecturalText,labelAnchor} from './architectural-text.mjs';

const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
export const spaceArea=ps=>Math.abs(ps.reduce((s,p,i)=>{const q=ps[(i+1)%ps.length];return s+p[0]*q[1]-q[0]*p[1];},0))/2;
function onSegment(p,a,b){return Math.abs(cross(a,b,p))<=1e-5*Math.max(1,dist(a,b))&&p[0]>=Math.min(a[0],b[0])-1e-5&&p[0]<=Math.max(a[0],b[0])+1e-5&&p[1]>=Math.min(a[1],b[1])-1e-5&&p[1]<=Math.max(a[1],b[1])+1e-5;}
export function spaceContainment(p,polygon){let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[j],b=polygon[i];if(onSegment(p,a,b))return 'boundary';if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside?'inside':'outside';}
const properCross=(a,b,c,d)=>cross(a,b,c)*cross(a,b,d)<-1e-8&&cross(c,d,a)*cross(c,d,b)<-1e-8;
export function inspectSpacePolygon(vertices){
 if(!Array.isArray(vertices)||vertices.length<3||vertices.some(v=>!Array.isArray(v)||v.length<2||v.some(n=>!Number.isFinite(n))))return {ok:false,reason:'Invalid finite vertices'};
 let ps=vertices.map(v=>v.slice(0,2));if(dist(ps[0],ps.at(-1))<1e-5)ps=ps.slice(0,-1);if(ps.length<3)return {ok:false,reason:'Fewer than three distinct vertices'};
 if(vertices.some(v=>Math.abs((v[2]??0)-(vertices[0][2]??0))>.001))return {ok:false,reason:'Non-planar room boundary'};
 for(let i=0;i<ps.length;i++){const a=ps[i],b=ps[(i+1)%ps.length];if(dist(a,b)<.001)return {ok:false,reason:'Degenerate boundary edge'};for(let j=i+1;j<ps.length;j++){if(j===i+1||i===0&&j===ps.length-1)continue;const c=ps[j],d=ps[(j+1)%ps.length];if(properCross(a,b,c,d)||onSegment(a,c,d)||onSegment(b,c,d)||onSegment(c,a,b)||onSegment(d,a,b))return {ok:false,reason:'Self-intersecting/touching boundary'};}}
 const areaM2=spaceArea(ps)/1e6;if(areaM2<.1)return {ok:false,reason:'Area below measurable room scope'};return {ok:true,polygon:ps,areaM2};
}
function interiorPoints(ps){const points=[];for(let i=0;i<ps.length;i++){const a=ps[i],b=ps[(i+1)%ps.length],c=ps[(i+2)%ps.length],p=[(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3];if(spaceContainment(p,ps)==='inside')points.push(p);}return points;}
function edgeInteriorSamples(ps,other){const samples=[];for(let i=0;i<ps.length;i++){const a=ps[i],b=ps[(i+1)%ps.length],r=[b[0]-a[0],b[1]-a[1]],length2=r[0]**2+r[1]**2,ts=[0,1];for(let j=0;j<other.length;j++){const c=other[j],d=other[(j+1)%other.length],s=[d[0]-c[0],d[1]-c[1]],delta=[c[0]-a[0],c[1]-a[1]],den=r[0]*s[1]-r[1]*s[0];if(Math.abs(den)>1e-8){const t=(delta[0]*s[1]-delta[1]*s[0])/den,u=(delta[0]*r[1]-delta[1]*r[0])/den;if(t>=0&&t<=1&&u>=0&&u<=1)ts.push(t);}else for(const p of [c,d])if(onSegment(p,a,b))ts.push(((p[0]-a[0])*r[0]+(p[1]-a[1])*r[1])/length2);}ts.sort((a,b)=>a-b);for(let k=1;k<ts.length;k++)if(ts[k]-ts[k-1]>1e-10){const t=(ts[k]+ts[k-1])/2;samples.push([a[0]+r[0]*t,a[1]+r[1]*t]);}}return samples;}
export function spaceInteriorsOverlap(a,b){return edgeInteriorSamples(a,b).some(p=>spaceContainment(p,b)==='inside')||edgeInteriorSamples(b,a).some(p=>spaceContainment(p,a)==='inside')||a.some(p=>spaceContainment(p,b)==='inside')||b.some(p=>spaceContainment(p,a)==='inside')||interiorPoints(a).some(p=>spaceContainment(p,b)==='inside')||interiorPoints(b).some(p=>spaceContainment(p,a)==='inside');}
const key=architecturalTextKey,text=normalizeArchitecturalText;
const inLayers=(e,layers)=>layers.some(l=>l.toUpperCase()===e.layer?.toUpperCase());

export function compileArchitecturalSpaces(query,options){
 const issues=[],add=(code,severity,message,refs=[])=>issues.push({code,severity,message,refs}),rows=query.entities||[],scope=query.traversal;
 if(query.truncated||query.errors?.length||!scope?.completeLocalScope)add('CAPTURE_INCOMPLETE','blocking','Source capture is incomplete or lacks independently recorded traversal coverage');
 if(options.scope?.includeNested!==true)add('NESTED_CAPTURE_REQUIRED','blocking','Architectural capture must explicitly expand local nested blocks');
 if(query.units!=='Millimeters')add('ARCHITECTURE_UNITS_UNSUPPORTED','blocking','Architectural geometry must explicitly be millimeters');
 if(scope?.excludedXrefs?.length)add('EXTERNAL_ARCHITECTURE_NOT_READ','blocking','Selected scope contains excluded external-reference contents');
 const labels=rows.filter(e=>['TEXT','MTEXT'].includes(e.type)&&inLayers(e,options.labelLayers)),ignored=new Set(options.ignoredLabels.map(i=>i.instancePath.map(h=>h.toUpperCase()).join('/'))),boundaries=[];
 for(const e of rows.filter(e=>inLayers(e,options.boundaryLayers)&&e.type!=='INSERT')){if(e.type!=='LWPOLYLINE'){add('ROOM_BOUNDARY_TYPE_UNSUPPORTED','blocking','Declared room-boundary layer contains unsupported non-polyline geometry',[key(e)]);continue;}if(!e.closed){add('OPEN_ROOM_BOUNDARY','blocking','Declared room boundary is not closed',[key(e)]);continue;}const bulges=e.bulges??e.definition_bulges;if(!Array.isArray(bulges)||bulges.some(n=>Math.abs(n)>1e-12)){add('CURVED_BOUNDARY_UNSUPPORTED','blocking','Curved or unverified bulge boundary was not approximated',[key(e)]);continue;}const geometry=inspectSpacePolygon(e.vertices);if(!geometry.ok){add('INVALID_BOUNDARY','blocking',geometry.reason,[key(e)]);continue;}boundaries.push({...geometry,entity:e,key:key(e)});}
 for(const path of ignored)if(!labels.some(l=>key(l)===path))add('IGNORED_LABEL_NOT_FOUND','blocking','Ignored label is not in selected capture',[path]);
 const usedLabels=new Set(),usedBoundaries=new Map(),rooms=[],labelBindings=[];
 function resolveLabel(def,roomId,relationship='primary_name'){
  const refs=[roomId,...(def.id!==roomId?[def.id]:[])];let assembly;
  if(def.labelInstancePaths){assembly=composeArchitecturalLabel(def.labelInstancePaths,labels,rows);if(!assembly.ok){add('ROOM_LABEL_ASSEMBLY_UNSUPPORTED','blocking',assembly.reason,refs);return;}if(assembly.members.some(m=>ignored.has(key(m)))){add('IGNORED_LABEL_USED_AS_ROOM','blocking','A composed source label member is also explicitly excluded',refs);return;}}
  const matches=assembly?(text(assembly.label.text)===text(def.name)?[assembly.label]:[]):labels.filter(l=>!ignored.has(key(l))&&text(l.text)===text(def.name)&&(!def.labelInstancePath||key(l)===def.labelInstancePath.map(h=>h.toUpperCase()).join('/')));
  if(matches.length!==1){add(matches.length?'ROOM_LABEL_AMBIGUOUS':'ROOM_LABEL_MISSING','blocking','Declared space name must identify exactly one source label or explicit composition',refs);return;}
  const label=matches[0],labelKeys=(assembly?.members||[label]).map(key);if(labelKeys.some(k=>usedLabels.has(k))){add('ROOM_LABEL_REUSED','blocking','One source text member cannot establish multiple physical spaces or additional labels',[...refs,...labelKeys]);return;}
  const anchor=labelAnchor(label);if(!anchor){add('ROOM_LABEL_LOCATION_UNKNOWN','blocking','Space label has no finite source anchor',[...refs,...labelKeys]);return;}for(const k of labelKeys)usedLabels.add(k);
  const record={instancePath:label.instancePath||[label.handle],text:label.text,...(assembly?{instancePaths:assembly.members.map(m=>m.instancePath),members:assembly.members,interpretation:assembly.interpretation}:{})};
  labelBindings.push({roomId,labelId:def.id,name:def.name,relationship,anchor,instancePaths:labelKeys.map(k=>k.split('/')),composition:assembly?'explicit_source_fragments':'single_source_text'});return {label,record,anchor};
 }
 for(const expected of options.expectedRooms){
  const primary=resolveLabel(expected,expected.id);if(!primary)continue;
  const aliases=(expected.aliases||[]).map(a=>({declaration:a,binding:resolveLabel(a,expected.id,a.relationship)}));
  const matchesBoundary=boundaries.filter(b=>spaceContainment(primary.anchor,b.polygon)!=='outside');let geometry,boundaryKey,geometryStatus='observed_closed_boundary';
  if(matchesBoundary.length===1){geometry=matchesBoundary[0];boundaryKey=geometry.key;if(usedBoundaries.has(boundaryKey)){add('ROOM_BOUNDARY_REUSED','blocking','Multiple physical spaces occupy the same closed boundary',[expected.id,usedBoundaries.get(boundaryKey)]);continue;}usedBoundaries.set(boundaryKey,expected.id);}
  else if(matchesBoundary.length>1){add('ROOM_BOUNDARY_AMBIGUOUS','blocking','Primary space label lies in multiple boundaries; smallest-area guessing is disabled',[expected.id,...matchesBoundary.map(b=>b.key)]);continue;}
  else if(options.inferRectangles){geometry=inferRectangularRoom(rows,primary.label);geometryStatus='inferred';if(!geometry.ok){add('ROOM_BOUNDARY_MISSING','blocking',geometry.reason,[expected.id]);continue;}add('ROOM_GEOMETRY_INFERRED','review','Wall-gap closure and rectangular inference require architectural confirmation',[expected.id]);}
  else{add('ROOM_BOUNDARY_MISSING','blocking','No explicit closed source boundary encloses this physical space label',[expected.id]);continue;}
  const additional=[];
  for(const {declaration:a,binding} of aliases){
   if(!binding)continue;const enclosing=boundaries.filter(b=>spaceContainment(binding.anchor,b.polygon)!=='outside'),inside=spaceContainment(binding.anchor,geometry.polygon)==='inside',sameBoundary=geometryStatus==='observed_closed_boundary'?enclosing.length===1&&enclosing[0].key===boundaryKey:enclosing.length===0;
   const spatialStatus=inside&&sameBoundary?(geometryStatus==='inferred'?'inside_inferred_boundary':'same_observed_boundary'):'unresolved';
   if(spatialStatus==='unresolved')add('SPACE_ALIAS_LOCATION_CONFLICT','blocking','An additional label is outside/on the boundary of its declared physical space, or identifies a different/ambiguous explicit source boundary',[expected.id,a.id]);
   add('SOURCE_SPACE_LABEL_RELATIONSHIP_UNVERIFIED','review','Additional source label '+a.name+' declared as '+a.relationship+': '+a.reason+'; spatial containment does not certify naming, use or applicability',[expected.id,a.id]);
   additional.push({id:a.id,name:a.name,relationship:a.relationship,reason:a.reason,status:'unverified_interpretation',spatialStatus,label:binding.record,sourceId:options.sourceId});
  }
  const entries=[];
  for(const path of expected.entryInstancePaths||[]){const entryKey=path.map(h=>h.toUpperCase()).join('/'),matches=rows.filter(e=>key(e)===entryKey);const entry=matches[0],position=entry?.position;
   if(geometryStatus!=='observed_closed_boundary'||geometry.entity.vertices.some(v=>Math.abs(v[2]??0)>.001)||matches.length!==1||!['TEXT','MTEXT','INSERT','POINT'].includes(entry?.type)||!Array.isArray(position)||position.length<2||position.some(n=>!Number.isFinite(n))||Math.abs(position[2]??0)>.001||spaceContainment(position.slice(0,2),geometry.polygon)!=='boundary'){add('ROOM_ENTRY_SOURCE_INVALID','blocking','Declared entry must identify one planar source anchor on its room boundary',[expected.id,entryKey]);continue;}
   if(entries.some(e=>e.instancePath.join('/')===entryKey||dist(e.position,position)<.001)){add('ROOM_ENTRY_DUPLICATE','blocking','Repeated entry source or coincident entry anchors are ambiguous',[expected.id,entryKey]);continue;}
   entries.push({instancePath:entryKey.split('/'),position:position.slice(0,2),entityType:entry.type,interpretation:'declared_entry_anchor_not_door_geometry_certification'});
  }
  if(entries.length)add('ENTRY_ROLE_REQUIRES_REVIEW','review','Source anchor positions are checked; their entrance semantics, opening width and circulation need architectural review',[expected.id]);
  rooms.push({id:expected.id,name:expected.name,polygon:geometry.polygon,areaM2:geometry.areaM2,geometryStatus,label:primary.record,...(additional.length?{aliases:additional}:{}),...(expected.entryInstancePaths?{entries}:{}),boundaryInstancePath:boundaryKey?.split('/'),sourceId:options.sourceId});
 }
 for(let i=0;i<rooms.length;i++)for(let j=i+1;j<rooms.length;j++)if(spaceInteriorsOverlap(rooms[i].polygon,rooms[j].polygon))add('ROOM_INTERIORS_OVERLAP','blocking','Selected room interiors overlap',[rooms[i].id,rooms[j].id]);
 const unmappedLabels=labels.filter(l=>!ignored.has(key(l))&&!usedLabels.has(key(l))).map(l=>({instancePath:l.instancePath||[l.handle],text:l.text})),unmappedBoundaries=boundaries.filter(b=>!usedBoundaries.has(b.key)).map(b=>b.key);
 if(unmappedLabels.length)add('UNMAPPED_ARCHITECTURAL_LABELS','blocking','Every label on declared room-label layers must be mapped or explicitly excluded with a reason');
 if(unmappedBoundaries.length)add('UNMAPPED_ROOM_BOUNDARIES','blocking','Declared room-boundary layers contain unassigned closed regions');
 if(options.inventoryOrigin==='source_labels')add('PROJECT_ROOM_SCHEDULE_MISSING','review','Inventory was derived from source labels; project-wide space coverage is not independently established');
 if(options.sourceOrigin!=='declared_architecture')add('ARCHITECTURAL_ORIGIN_UNVERIFIED','review','Source is historical or has unverified origin; independent prospective input acceptance remains pending');
 const sourceText=inspectArchitecturalText(rows,labels,options);if(!sourceText.complete)add('SOURCE_TEXT_BUDGET_EXCEEDED','blocking','Source label count exceeds the text-review budget; choose a smaller explicit architectural scope');
 for(const note of sourceText.retainedIgnoredText)add(note.potentialProjectCondition?'EXCLUDED_PROJECT_CONDITION_REQUIRES_REVIEW':'EXCLUDED_SOURCE_TEXT_RETAINED','review','Spatially excluded source text retained for requirement review: '+note.text,note.excludedMembers.map(m=>m.instancePath.join('/')));
 const architecture=[];for(const e of rows.filter(e=>inLayers(e,options.geometryLayers||options.boundaryLayers))){if(e.type==='LINE')architecture.push({kind:'line',points:[e.start.slice(0,2),e.end.slice(0,2)]});else if(e.type==='LWPOLYLINE'&&(e.bulges??e.definition_bulges)?.every(v=>Math.abs(v)<1e-12))architecture.push({kind:'polyline',points:e.vertices.map(v=>v.slice(0,2)),closed:e.closed});}
 const omittedGeometry=rows.filter(e=>inLayers(e,options.geometryLayers||options.boundaryLayers)&&!['LINE','INSERT'].includes(e.type)&&!(e.type==='LWPOLYLINE'&&(e.bulges??e.definition_bulges)?.every(v=>Math.abs(v)<1e-12))).map(e=>({type:e.type,instancePath:e.instancePath||[e.handle]}));if(omittedGeometry.length)add('CONTEXT_GEOMETRY_NOT_RENDERED','review','Unsupported contextual geometry is retained in capture but omitted from the straight-line design context; source drawing remains authoritative');
 const completeInventory=!issues.some(i=>i.severity==='blocking')&&rooms.length===options.expectedRooms.length,geometryComplete=completeInventory&&rooms.every(r=>r.geometryStatus==='observed_closed_boundary');
 return {schemaVersion:1,sourceId:options.sourceId,sourceOrigin:options.sourceOrigin,inventoryOrigin:options.inventoryOrigin,scope:options.scope,spaceSchedule:options.expectedRooms,labelBindings,rooms,architecture,sourceText,issues,omittedGeometry,ignoredLabels:options.ignoredLabels,coverage:{expectedRooms:options.expectedRooms.length,expectedLabelEntries:options.expectedRooms.reduce((n,r)=>n+1+(r.aliases?.length||0),0),matchedLabelEntries:labelBindings.length,additionalLabels:labelBindings.filter(b=>b.relationship!=='primary_name').length,secondaryUseLabels:labelBindings.filter(b=>b.relationship==='secondary_use').length,resolvedRooms:rooms.length,observedBoundaries:rooms.filter(r=>r.geometryStatus==='observed_closed_boundary').length,inferredRooms:rooms.filter(r=>r.geometryStatus==='inferred').length,unmappedLabels,unmappedBoundaries,completeInventory,geometryComplete,independentProjectAcceptance:false},pending:['Entrance positions, ceiling conditions, room use and project requirements need source-linked input','Excluded architectural text must be checked for project conditions; it is not automatically converted to executable requirements','Room-source origin and professional architectural acceptance are not certified by CAD geometry'],professionalApproval:false};
}
