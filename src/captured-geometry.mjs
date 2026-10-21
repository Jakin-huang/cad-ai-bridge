// Source identity/geometry only. Entity roles and project authority stay declared.
import {z} from 'zod';
import {jobDirectory,jobJson} from './jobs.mjs';
import {hashFile} from './drawings.mjs';
import path from 'node:path';
const sha=z.string().regex(/^[a-f0-9]{64}$/i),instancePath=z.array(z.string().regex(/^[a-f0-9]+$/i)).min(1).max(10),id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,47}$/);
export const capturedShellSchema=z.strictObject({captureJobId:z.string().regex(/^job-[A-Za-z0-9_-]+$/),captureSHA256:sha,drawingSHA256:sha,boundaryPath:instancePath,entryPath:instancePath,windows:z.array(z.strictObject({id,instancePath})).max(200),keepouts:z.array(z.strictObject({id,instancePath})).max(40)});
const near=(a,b)=>Math.abs(a-b)<.001,pointNear=(a,b)=>a.length>=2&&b.length>=2&&a.slice(0,2).every((v,i)=>near(v,b[i]));
function planar(points){return points.every(p=>Array.isArray(p)&&p.length>=2&&p.every(Number.isFinite)&&Math.abs(p[2]??0)<.001);}
export function capturedRectangle(e){
 const ps=e.vertices;if(e.type!=='LWPOLYLINE'||!e.closed||!Array.isArray(ps)||ps.length!==4||!planar(ps)||!Array.isArray(e.bulges)||e.bulges.some(n=>Math.abs(n)>1e-12)||Math.abs(e.width??0)>1e-12||e.variableWidth)throw Error('SOURCE_RECTANGLE_REQUIRED');
 const rect={min:[0,1].map(i=>Math.min(...ps.map(p=>p[i]))),max:[0,1].map(i=>Math.max(...ps.map(p=>p[i])))};if(rect.min.some((v,i)=>rect.max[i]-v<.001)||new Set(ps.map(p=>p.slice(0,2).join(','))).size!==4||ps.some((a,i)=>{const b=ps[(i+1)%4];return near(a[0],b[0])===near(a[1],b[1])||![rect.min[0],rect.max[0]].some(v=>near(a[0],v))||![rect.min[1],rect.max[1]].some(v=>near(a[1],v));}))throw Error('SOURCE_AXIS_RECTANGLE_REQUIRED');return rect;
}
export function capturedLine(e){if(e.type!=='LINE'||!planar([e.start,e.end])||pointNear(e.start,e.end))throw Error('SOURCE_STRAIGHT_LINE_REQUIRED');return [e.start.slice(0,2),e.end.slice(0,2)];}
export async function loadGeometryCapture(runs,ref){
 const dir=await jobDirectory(runs,ref.captureJobId),file=path.join(dir,'result.json');if(await hashFile(file)!==ref.captureSHA256.toLowerCase())throw Error('SOURCE_CAPTURE_CHANGED');const task=await jobJson(dir,'task.json'),raw=await jobJson(dir,'result.json'),q=raw.query;if(task.action!=='scan'||!raw.ok||raw.inputSha256!==ref.drawingSHA256.toLowerCase())throw Error('SOURCE_CAPTURE_IDENTITY_MISMATCH');if(q?.units!=='Millimeters'||q.truncated||!Array.isArray(q.errors)||q.errors.length||!q.traversal?.completeLocalScope||q.traversal.excludedXrefs?.length)throw Error('SOURCE_CAPTURE_INCOMPLETE');return {raw,query:q};
}
export async function verifyCapturedShell(input,{runs}){
 const shell=input.shell,ref=shell.capture;if(!ref){if(shell.status==='source_bound')throw Error('PLANNING_CAPTURE_BINDING_REQUIRED');return undefined;}if(shell.status!=='source_bound')throw Error('PLANNING_CAPTURE_STATUS_MISMATCH');
 const {query}=await loadGeometryCapture(runs,ref),key=p=>p.map(v=>v.toUpperCase()).join('/'),used=new Set(),find=path=>{const k=key(path),rows=query.entities.filter(e=>key(e.instancePath??[e.handle])===k);if(rows.length!==1||used.has(k))throw Error('SOURCE_ENTITY_MISSING_AMBIGUOUS_OR_REUSED');used.add(k);return rows[0];},rect=capturedRectangle(find(ref.boundaryPath));
 if(!pointNear(rect.min,shell.rect.min)||!pointNear(rect.max,shell.rect.max))throw Error('PLANNING_BOUNDARY_SOURCE_MISMATCH');
 if(!shell.sourceIds.some(id=>input.sources.some(s=>s.id===id&&s.role==='architecture'&&!s.supersededBy&&s.sha256.toLowerCase()===ref.drawingSHA256.toLowerCase())))throw Error('PLANNING_ARCHITECTURE_SOURCE_MISMATCH');
 const segment=(side,from,to)=>{const axis=['west','east'].includes(side)?1:0,fixed=side==='west'?rect.min[0]:side==='east'?rect.max[0]:side==='south'?rect.min[1]:rect.max[1],a=[0,0],b=[0,0];a[1-axis]=b[1-axis]=fixed;a[axis]=rect.min[axis]+from;b[axis]=rect.min[axis]+to;return [a,b];},sameLine=(a,b)=>pointNear(a[0],b[0])&&pointNear(a[1],b[1])||pointNear(a[0],b[1])&&pointNear(a[1],b[0]),entry=shell.entry;
 if(!sameLine(capturedLine(find(ref.entryPath)),segment(entry.side,entry.offsetMm-entry.clearWidthMm/2,entry.offsetMm+entry.clearWidthMm/2)))throw Error('PLANNING_ENTRY_SOURCE_MISMATCH');
 for(const [binding,expected,label]of [[ref.windows,shell.windows,'WINDOW'],[ref.keepouts,shell.keepouts,'KEEPOUT']]){if(binding.length!==expected.length||new Set(binding.map(r=>r.id)).size!==expected.length||expected.some(r=>!binding.some(b=>b.id===r.id)))throw Error('PLANNING_'+label+'_COVERAGE');for(const r of expected){const e=find(binding.find(b=>b.id===r.id).instancePath);if(label==='WINDOW'?!sameLine(capturedLine(e),segment(r.side,r.fromMm,r.toMm)):(()=>{const b=capturedRectangle(e);return !pointNear(b.min,r.rect.min)||!pointNear(b.max,r.rect.max);})())throw Error('PLANNING_'+label+'_SOURCE_MISMATCH');}}
 return {schemaVersion:1,captureJobId:ref.captureJobId,captureSHA256:ref.captureSHA256.toLowerCase(),drawingSHA256:ref.drawingSHA256.toLowerCase(),boundEntities:used.size,geometryToleranceMm:.001,scope:'Explicitly selected WCS axis-aligned source rectangle, entry/window line segments and retained rectangles. Roles, omissions, source authority and professional applicability remain unverified',professionalApproval:false};
}
