import {inferRectangularRoom} from './engineering-spatial.mjs';

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
const key=e=>(e.instancePath||[e.handle]).map(h=>h.toUpperCase()).join('/');
const text=v=>String(v??'').replace(/\\P/g,' ').replace(/\\[A-Za-z][^;]*;/g,'').replace(/[{}]/g,'').replace(/\s/g,'');
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
 const usedLabels=new Set(),usedBoundaries=new Map(),rooms=[];
 for(const expected of options.expectedRooms){
  const matches=labels.filter(l=>!ignored.has(key(l))&&text(l.text)===text(expected.name)&&(!expected.labelInstancePath||key(l)===expected.labelInstancePath.map(h=>h.toUpperCase()).join('/')));
  if(matches.length!==1){add(matches.length?'ROOM_LABEL_AMBIGUOUS':'ROOM_LABEL_MISSING','blocking','Expected room must identify exactly one source label',[expected.id]);continue;}
  const label=matches[0],labelKey=key(label);if(usedLabels.has(labelKey)){add('ROOM_LABEL_REUSED','blocking','One label cannot establish multiple expected rooms',[expected.id,labelKey]);continue;}usedLabels.add(labelKey);
  const anchor=label.bounds?[(label.bounds.min[0]+label.bounds.max[0])/2,(label.bounds.min[1]+label.bounds.max[1])/2]:label.position?.slice(0,2),matchesBoundary=boundaries.filter(b=>spaceContainment(anchor,b.polygon)!=='outside');
  let geometry,boundaryKey,geometryStatus='observed_closed_boundary';
  if(matchesBoundary.length===1){geometry=matchesBoundary[0];boundaryKey=geometry.key;if(usedBoundaries.has(boundaryKey)){add('ROOM_BOUNDARY_REUSED','blocking','Multiple labels occupy the same closed boundary',[expected.id,usedBoundaries.get(boundaryKey)]);continue;}usedBoundaries.set(boundaryKey,expected.id);}
  else if(matchesBoundary.length>1){add('ROOM_BOUNDARY_AMBIGUOUS','blocking','Room label lies in multiple boundaries; smallest-area guessing is disabled',[expected.id,...matchesBoundary.map(b=>b.key)]);continue;}
  else if(options.inferRectangles){geometry=inferRectangularRoom(rows,label);geometryStatus='inferred';if(!geometry.ok){add('ROOM_BOUNDARY_MISSING','blocking',geometry.reason,[expected.id]);continue;}add('ROOM_GEOMETRY_INFERRED','review','Wall-gap closure and rectangular inference require architectural confirmation',[expected.id]);}
  else{add('ROOM_BOUNDARY_MISSING','blocking','No explicit closed source boundary encloses this room label',[expected.id]);continue;}
  rooms.push({id:expected.id,name:expected.name,polygon:geometry.polygon,areaM2:geometry.areaM2,geometryStatus,label:{instancePath:label.instancePath||[label.handle],text:label.text},boundaryInstancePath:boundaryKey?.split('/'),sourceId:options.sourceId});
 }
 for(let i=0;i<rooms.length;i++)for(let j=i+1;j<rooms.length;j++)if(spaceInteriorsOverlap(rooms[i].polygon,rooms[j].polygon))add('ROOM_INTERIORS_OVERLAP','blocking','Selected room interiors overlap',[rooms[i].id,rooms[j].id]);
 const unmappedLabels=labels.filter(l=>!ignored.has(key(l))&&!usedLabels.has(key(l))).map(l=>({instancePath:l.instancePath||[l.handle],text:l.text})),unmappedBoundaries=boundaries.filter(b=>!usedBoundaries.has(b.key)).map(b=>b.key);
 if(unmappedLabels.length)add('UNMAPPED_ARCHITECTURAL_LABELS','blocking','Every label on declared room-label layers must be mapped or explicitly excluded with a reason');
 if(unmappedBoundaries.length)add('UNMAPPED_ROOM_BOUNDARIES','blocking','Declared room-boundary layers contain unassigned closed regions');
 if(options.inventoryOrigin==='source_labels')add('PROJECT_ROOM_SCHEDULE_MISSING','review','Inventory was derived from source labels; project-wide space coverage is not independently established');
 if(options.sourceOrigin!=='declared_architecture')add('ARCHITECTURAL_ORIGIN_UNVERIFIED','review','Source is historical or has unverified origin; independent prospective input acceptance remains pending');
 const architecture=[];for(const e of rows.filter(e=>inLayers(e,options.geometryLayers||options.boundaryLayers))){if(e.type==='LINE')architecture.push({kind:'line',points:[e.start.slice(0,2),e.end.slice(0,2)]});else if(e.type==='LWPOLYLINE'&&(e.bulges??e.definition_bulges)?.every(v=>Math.abs(v)<1e-12))architecture.push({kind:'polyline',points:e.vertices.map(v=>v.slice(0,2)),closed:e.closed});}
 const omittedGeometry=rows.filter(e=>inLayers(e,options.geometryLayers||options.boundaryLayers)&&!['LINE','INSERT'].includes(e.type)&&!(e.type==='LWPOLYLINE'&&(e.bulges??e.definition_bulges)?.every(v=>Math.abs(v)<1e-12))).map(e=>({type:e.type,instancePath:e.instancePath||[e.handle]}));if(omittedGeometry.length)add('CONTEXT_GEOMETRY_NOT_RENDERED','review','Unsupported contextual geometry is retained in capture but omitted from the straight-line design context; source drawing remains authoritative');
 const completeInventory=!issues.some(i=>i.severity==='blocking')&&rooms.length===options.expectedRooms.length,geometryComplete=completeInventory&&rooms.every(r=>r.geometryStatus==='observed_closed_boundary');
 return {schemaVersion:1,sourceId:options.sourceId,sourceOrigin:options.sourceOrigin,inventoryOrigin:options.inventoryOrigin,scope:options.scope,rooms,architecture,issues,omittedGeometry,ignoredLabels:options.ignoredLabels,coverage:{expectedRooms:options.expectedRooms.length,resolvedRooms:rooms.length,observedBoundaries:rooms.filter(r=>r.geometryStatus==='observed_closed_boundary').length,inferredRooms:rooms.filter(r=>r.geometryStatus==='inferred').length,unmappedLabels,unmappedBoundaries,completeInventory,geometryComplete,independentProjectAcceptance:false},pending:['Entrance positions, ceiling conditions, room use and project requirements need source-linked input','Room-source origin and professional architectural acceptance are not certified by CAD geometry'],professionalApproval:false};
}
