// Extensions register deterministic executors in code. Manifests alone never
// enable a host; compatibility and actual acceptance are separate facts.
import {z} from 'zod';
const operation=z.enum(['read','write','repair','render','native','session']);
export const backendManifestSchema=z.strictObject({schemaVersion:z.literal(1),id:z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),version:z.string().regex(/^\d+\.\d+\.\d+$/),host:z.string().min(1).max(128),platform:z.enum(['win32','linux','darwin']),formats:z.array(z.enum(['dwg','dxf'])).min(1),operations:z.array(operation).min(1),writeUnits:z.array(z.enum(['mm','cm','m','in','ft'])).default([]),coordinates:z.literal('planar WCS XY'),acceptance:z.enum(['current-machine','external-validated','experimental','unverified']),evidence:z.array(z.string().min(1).max(260)).max(30).default([]),limitations:z.array(z.string().min(1).max(512)).max(50).default([])}).superRefine((m,ctx)=>{if(m.operations.includes('write')&&!m.writeUnits.length)ctx.addIssue({code:'custom',message:'Write adapters must declare explicit units'});if(['current-machine','external-validated'].includes(m.acceptance)&&!m.evidence.length)ctx.addIssue({code:'custom',message:'Validated adapters require evidence references'});});
export const builtInBackends=Object.freeze([
 {schemaVersion:1,id:'autocad-2022-core',version:'1.0.0',host:'AutoCAD 2022 zh-CN',platform:'win32',formats:['dwg'],operations:['read','write','repair','render'],writeUnits:['mm'],coordinates:'planar WCS XY',acceptance:'current-machine',evidence:['docs/practical-validation.json'],limitations:['Current Windows account and licensed AutoCAD 2022 only; additional hosts need independent acceptance','Nested entities, dynamic blocks, xrefs and opaque vendor objects are read-only or unsupported','Geometry and DXF preservation checks cover declared subsets','Repair preserves declared units and is separate from ordinary mm-only editing']},
 {schemaVersion:1,id:'autocad-2022-tangent-v8',version:'1.0.0',host:'AutoCAD 2022 + Tangent Electrical V8',platform:'win32',formats:['dwg'],operations:['read','write','repair','render','native'],writeUnits:['mm'],coordinates:'planar WCS XY',acceptance:'current-machine',evidence:['docs/practical-validation.json'],limitations:['Requires installed and licensed Tangent Electrical V8','Native tray/label operations are a dedicated subset, not all Tangent objects']}
].map(m=>Object.freeze(backendManifestSchema.parse(m))));
export function requireBackendCapability(manifest,{operation,format='dwg',units,platform=process.platform}={}){
 const m=backendManifestSchema.parse(manifest);
 if(m.platform!==platform)throw Error('BACKEND_PLATFORM_UNSUPPORTED');
 if(!m.operations.includes(operation)||!m.formats.includes(format))throw Error('BACKEND_CAPABILITY_UNSUPPORTED');
 if(operation==='write'&&(!units||!m.writeUnits.includes(units)))throw Error('BACKEND_WRITE_UNITS_UNSUPPORTED');
 return {backendId:m.id,adapterVersion:m.version,declaredAcceptance:m.acceptance,evidence:m.evidence,limitations:m.limitations};
}
export function createBackendRegistry(){
 const entries=new Map();
 return {register(manifest,executor){const m=backendManifestSchema.parse(manifest);if(typeof executor!=='function')throw Error('BACKEND_EXECUTOR_REQUIRED');if(entries.has(m.id))throw Error('BACKEND_DUPLICATE');entries.set(m.id,{manifest:m,executor});return m;},list(){return [...entries.values()].map(e=>structuredClone(e.manifest));},async execute(id,request){const entry=entries.get(id);if(!entry)throw Error('BACKEND_UNAVAILABLE');const capability=requireBackendCapability(entry.manifest,request);const result=await entry.executor(request);if(!result||typeof result.ok!=='boolean')throw Error('BACKEND_RESULT_INVALID');if(request.operation==='write'&&result.ok&&(!result.drawingSaved||!/^[a-f0-9]{64}$/i.test(result.drawingSha256??'')))throw Error('BACKEND_WRITE_EVIDENCE_REQUIRED');return {...result,capability};}};
}
