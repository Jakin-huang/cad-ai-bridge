import fs from 'node:fs/promises';
import path from 'node:path';
import {atomicJson,csvCell} from './files.mjs';
import {hashFile,isWithin} from './drawings.mjs';
import {engineeringDigest} from './engineering-design.mjs';
import {compileArchitecturalSpaces} from './architectural-spaces.mjs';
import {architecturalReviewHtml} from './architectural-review.mjs';

export async function inspectArchitecture(q,{runs,execute}){
 const jobId='job-architecture-'+q.requestId,dir=path.join(runs,jobId),fingerprint=engineeringDigest(q);
 await fs.mkdir(runs,{recursive:true});try{await fs.mkdir(dir);}catch(error){if(error.code!=='EEXIST')throw error;const prior=JSON.parse(await fs.readFile(path.join(dir,'request.json'),'utf8'));if(prior.fingerprint!==fingerprint)throw Error('ARCHITECTURE_REQUEST_CONFLICT');const result=JSON.parse(await fs.readFile(path.join(dir,'result.json'),'utf8').catch(()=>'{"ok":false,"status":"unconfirmed","safeToRetry":false}'));for(const f of result.files||[])if(await hashFile(f.file)!==f.sha256)throw Error('ARCHITECTURE_RESULT_CHANGED');return {...result,jobId,replayed:true};}
 await atomicJson(path.join(dir,'request.json'),{fingerprint,request:q});const task={jobId,requestId:q.requestId,action:'architecture',status:'running',phase:'capturing_architecture',updatedAt:new Date().toISOString(),ownerPid:process.pid};await atomicJson(path.join(dir,'task.json'),task);
 try{
  if(await hashFile(q.drawing)!==q.expectedSha256.toLowerCase())throw Error('ARCHITECTURE_SOURCE_CHANGED');
  const capture=await execute('scan',{drawing:q.drawing,scope:q.scope,limit:100000,exportDxf:false});if(!capture.ok)throw Error('ARCHITECTURE_CAPTURE_FAILED: '+JSON.stringify(capture.error));if(!isWithin(runs,capture.jobRoot))throw Error('ARCHITECTURE_CAPTURE_OUTSIDE_RUNS');
  const rawFile=path.join(capture.jobRoot,'result.json'),raw=JSON.parse(await fs.readFile(rawFile,'utf8'));if(raw.inputSha256!==q.expectedSha256.toLowerCase()||await hashFile(q.drawing)!==q.expectedSha256.toLowerCase())throw Error('ARCHITECTURE_SOURCE_CHANGED');
  const pack={...compileArchitecturalSpaces(raw.query,q),sourceSHA256:q.expectedSha256.toLowerCase(),captureJobId:path.basename(capture.jobRoot),captureSHA256:await hashFile(rawFile),traversal:raw.query.traversal};const packFile=path.join(dir,'spaces.json');await atomicJson(packFile,pack);
  const files=[{kind:'json',file:packFile,sha256:await hashFile(packFile)}];
  for(const [name,rows]of [['rooms.csv',[['id','name','areaM2','geometryStatus','labelPath','boundaryPath'],...pack.rooms.map(r=>[r.id,r.name,r.areaM2,r.geometryStatus,(r.label.instancePaths||[r.label.instancePath]).map(p=>p.join('/')).join(';'),r.boundaryInstancePath?.join('/')])]],['issues.csv',[['code','severity','message','references'],...pack.issues.map(i=>[i.code,i.severity,i.message,i.refs.join(';')])]]]){const file=path.join(dir,name);await fs.writeFile(file,'\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n');files.push({kind:'csv',file,sha256:await hashFile(file)});}
  const reviewFile=path.join(dir,'spatial-review.html');await fs.writeFile(reviewFile,architecturalReviewHtml(pack),{flag:'wx'});files.push({kind:'html',file:reviewFile,sha256:await hashFile(reviewFile)});
  const sourceTextSummary={sourceLabels:pack.sourceText.sourceLabelCount,declaredAssemblies:q.expectedRooms.filter(r=>r.labelInstancePaths).length,appliedAssemblies:pack.labelBindings.filter(r=>r.composition==='explicit_source_fragments').length,suggestedAssemblies:pack.sourceText.suggestedAssemblies.length,retainedIgnoredText:pack.sourceText.retainedIgnoredText.length,potentialProjectConditions:pack.sourceText.retainedIgnoredText.filter(n=>n.potentialProjectCondition).length,complete:pack.sourceText.complete};
  const result={ok:true,jobId,status:pack.coverage.completeInventory?'completed':'blocked',sourceSHA256:pack.sourceSHA256,packSHA256:files[0].sha256,coverage:pack.coverage,sourceTextSummary,issues:pack.issues,pending:pack.pending,traversal:pack.traversal,files,professionalApproval:false};task.status=result.status;task.phase='spatial_inventory_recorded';task.updatedAt=new Date().toISOString();await atomicJson(path.join(dir,'result.json'),result);await atomicJson(path.join(dir,'task.json'),task);return result;
 }catch(error){task.status='blocked';task.phase='architecture_capture_unconfirmed';task.updatedAt=new Date().toISOString();await atomicJson(path.join(dir,'task.json'),task);await atomicJson(path.join(dir,'result.json'),{ok:false,jobId,status:'unconfirmed',safeToRetry:false,error:{code:error.message.split(':')[0],message:error.message}});throw error;}
}

export async function loadArchitecturalPack(ref,{runs}){
 const file=path.join(runs,ref.jobId,'spaces.json'),real=await fs.realpath(file),record=JSON.parse(await fs.readFile(path.join(runs,ref.jobId,'result.json'),'utf8'));if(!isWithin(await fs.realpath(runs),real)||record.packSHA256!==ref.sha256.toLowerCase()||await hashFile(real)!==ref.sha256.toLowerCase())throw Error('ARCHITECTURE_PACK_CHANGED');const pack=JSON.parse(await fs.readFile(real,'utf8'));if(await hashFile(path.join(runs,pack.captureJobId,'result.json'))!==pack.captureSHA256)throw Error('ARCHITECTURE_CAPTURE_CHANGED');
 if(!pack.coverage.completeInventory||!pack.coverage.geometryComplete&&!ref.acceptInferredGeometry)throw Error('ARCHITECTURE_PACK_INCOMPLETE');
 return pack;
}
export async function mergeArchitecturalPack(seed,ref,{runs}){
 const pack=await loadArchitecturalPack(ref,{runs});
 const source=seed.sources.find(s=>s.id===pack.sourceId);if(source?.role!=='architecture'||source.sha256.toLowerCase()!==pack.sourceSHA256||source.derivedFromFinalDrawing!==(pack.sourceOrigin!=='declared_architecture'))throw Error('ARCHITECTURE_SOURCE_BINDING_MISMATCH');
 if(seed.rooms.length!==pack.rooms.length||seed.rooms.some(r=>!pack.rooms.some(p=>p.id===r.id&&p.name===r.name)))throw Error('ARCHITECTURE_ROOM_SCHEDULE_MISMATCH');
 return {...seed,rooms:seed.rooms.map(r=>{const p=pack.rooms.find(p=>p.id===r.id);return {...r,polygon:p.polygon,geometryStatus:p.geometryStatus==='inferred'?'inferred':'issued',sourceIds:[...new Set([...r.sourceIds,pack.sourceId])]};}),architecture:pack.architecture,missingInputs:[...seed.missingInputs,...pack.issues.filter(i=>i.severity==='review').map((i,n)=>({id:'ARCH_REVIEW_'+n,description:i.message,severity:'review',sourceIds:[pack.sourceId]}))]};
}
