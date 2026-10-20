import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {atomicJson,csvCell} from './files.mjs';
import {hashFile,isWithin} from './drawings.mjs';
import {engineeringSchema,inspectEngineeringInput} from './engineering-contracts.mjs';
import {engineeringDigest,makeEngineeringDesign} from './engineering-design.mjs';
import {auditEngineeringDesign,verifyEngineeringCad} from './engineering-verification.mjs';
import {engineeringReviewHtml} from './engineering-report.mjs';
import {resolveLightingStandards,lightingBasisSummary} from './lighting-standard-evidence.mjs';
import {resolveEngineeringPhotometry} from './engineering-photometry.mjs';
import {resolveEngineeringStandards} from './engineering-evidence.mjs';
import {inspectArchitecture,mergeArchitecturalPack,loadArchitecturalPack} from './architectural-projects.mjs';

export function createEngineeringManager({runs,execute,lightingProfile,getInputRoot=async()=>{throw Error('ENGINEERING_INPUT_ROOT_REQUIRED');}}){
 let queue=Promise.resolve();
 const location=id=>path.join(runs,id),read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
  const result=state=>({ok:true,jobId:state.jobId,revision:state.revision,status:state.status,inputSHA256:state.inputSHA256,modelSHA256:state.modelSHA256,rooms:state.roomCount,issues:state.intake.issues,checks:state.checks?{passed:state.checks.checks.filter(c=>c.ok).length,failed:state.checks.checks.filter(c=>!c.ok).length,pending:state.checks.pending.length}:undefined,delivery:state.delivery?{...state.delivery,exportResult:undefined}:undefined,reviewStatus:'awaiting_human_review',professionalApproval:false});
 async function save(state){state.updatedAt=new Date().toISOString();const dir=location(state.jobId);await atomicJson(path.join(dir,'engineering.json'),state);await atomicJson(path.join(dir,'task.json'),{jobId:state.jobId,action:'engineering',status:state.status==='delivered'?'completed':state.status==='delivery_unconfirmed'?'blocked':state.status==='delivering'?'running':state.status==='blocked'?'blocked':'partial',phase:state.status,updatedAt:state.updatedAt,ownerPid:process.pid});await atomicJson(path.join(dir,'result.json'),{...result(state),jobRoot:dir,files:state.delivery?.files??[],drawing:state.delivery?.drawing,drawingSha256:state.delivery?.drawingSHA256,drawingSaved:!!state.delivery,outcome:state.delivery?'saved':state.status==='delivery_unconfirmed'?'unknown':'design_record',safeToRetry:false});}
 async function run(raw){
  const q=engineeringSchema.parse(raw);
  if(process.env.CADBRIDGE_READ_ONLY==='1'&&q.action==='deliver')throw Error('READ_ONLY: engineering CAD generation disabled');
  if(q.action==='lighting_basis')return lightingBasisSummary(lightingProfile?{file:lightingProfile}:undefined);
  if(q.action==='status'){
   const s=await read(path.join(location(q.jobId),'engineering.json'));
   if(q.section==='summary')return result(s);
   if(q.section==='input')return {ok:true,input:await read(path.join(location(q.jobId),'input-'+s.revision+'.json'))};
   if(q.section==='model')return {ok:true,model:await read(path.join(location(q.jobId),'model-'+s.revision+'.json'))};
   return {ok:true,[q.section]:s[q.section]??null,revision:s.revision,modelSHA256:s.modelSHA256};
  }
  const work=queue.then(()=>mutate(q));queue=work.catch(()=>{});return work;
 }
 async function mutate(q){
  if(q.action==='inspect_architecture')return inspectArchitecture(q,{runs,execute});
  if(q.action==='prepare_from_seed'){
   const root=await fs.realpath(await getInputRoot()),file=await fs.realpath(q.seedFile);if(!isWithin(root,file)||path.extname(file).toLowerCase()!=='.json')throw Error('ENGINEERING_SEED_OUTSIDE_INPUT_ROOT');const info=await fs.stat(file);if(info.size>2*1024*1024)throw Error('ENGINEERING_SEED_TOO_LARGE');const bytes=await fs.readFile(file),sha=crypto.createHash('sha256').update(bytes).digest('hex');if(sha!==q.expectedSeedSHA256.toLowerCase())throw Error('ENGINEERING_SEED_CHANGED');let seed=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));if(!Array.isArray(seed.requirements)||seed.requirements.length)throw Error('ENGINEERING_SEED_REQUIREMENTS_NOT_EMPTY');if(q.architecturalPack)seed=await mergeArchitecturalPack(seed,q.architecturalPack,{runs});q={action:'prepare',requestId:q.requestId,project:{...seed,requirements:q.requirements},seedEvidence:{file,sha256:sha,architecturalPack:q.architecturalPack}};
  }
  if(q.action==='prepare'){
   const jobId='job-design-'+q.requestId,dir=location(jobId),intake=inspectEngineeringInput(q.project),input=intake.input,inputSHA256=engineeringDigest(input);let old;
   try{old=await read(path.join(dir,'engineering.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
   if(old){if(old.history[0].inputSHA256!==inputSHA256)throw Error('ENGINEERING_REQUEST_CONFLICT');return {...result(old),replayed:true};}
   await fs.mkdir(runs,{recursive:true});try{await fs.mkdir(dir);}catch(error){if(error.code==='EEXIST')throw Error('ENGINEERING_PREPARATION_UNCONFIRMED: directory already exists; inspect its journal');throw error;}const state={schemaVersion:1,jobId,revision:0,status:intake.ok?'prepared':'blocked',roomCount:input.rooms.length,inputSHA256,intake:{...intake,input:undefined},history:[{event:'prepared',inputSHA256,at:new Date().toISOString()}],review:[],professionalApproval:false};
   if(q.seedEvidence)state.seedEvidence=q.seedEvidence;await atomicJson(path.join(dir,'input-0.json'),input);await save(state);return result(state);
  }
  const dir=location(q.jobId),lease=path.join(dir,'engineering.lock');let lock;
  try{lock=await fs.open(lease,'wx');}catch(e){if(e.code==='EEXIST')throw Error('ENGINEERING_BUSY: check the persisted owner before any recovery');throw e;}
  await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),action:q.action}));
  try{
   const state=await read(path.join(dir,'engineering.json')),input=await read(path.join(dir,'input-'+state.revision+'.json'));
   if(engineeringDigest(input)!==state.inputSHA256)throw Error('ENGINEERING_INPUT_CHANGED');
   if('expectedRevision'in q&&q.expectedRevision!==state.revision)throw Error('ENGINEERING_REVISION_CONFLICT');
   if(q.action==='revise'){
    if(['delivering','delivery_unconfirmed'].includes(state.status))throw Error('ENGINEERING_DELIVERY_UNCONFIRMED: reconcile saved outputs before revising');
    const next=structuredClone(input);for(const change of q.changes){const req=next.requirements.find(r=>r.id===change.requirementId);if(!req||!next.sources.some(s=>s.id===change.sourceId))throw Error('ENGINEERING_REVISION_REFERENCE_INVALID');req.value=change.value;req.sourceIds=[...new Set([...req.sourceIds,change.sourceId])];req.rationale=change.reason;req.status='interpreted';}
    const intake=inspectEngineeringInput(next);state.history.push({event:'revised',priorRevision:state.revision,priorModelSHA256:state.modelSHA256,priorDelivery:state.delivery,reviewInvalidated:true,changes:q.changes});state.revision++;state.inputSHA256=engineeringDigest(intake.input);state.intake={...intake,input:undefined};state.status=intake.ok?'prepared':'blocked';delete state.modelSHA256;delete state.delivery;delete state.checks;state.review=[];await atomicJson(path.join(dir,'input-'+state.revision+'.json'),intake.input);await save(state);return result(state);
   }
   if(q.action==='design'){
    if(state.status==='delivering'||state.status==='delivery_unconfirmed')throw Error('ENGINEERING_DELIVERY_UNCONFIRMED');
    if(state.modelSHA256){const existing=await read(path.join(dir,'model-'+state.revision+'.json'));if(engineeringDigest(existing)!==state.modelSHA256)throw Error('ENGINEERING_MODEL_CHANGED');return {...result(state),replayed:true};}
    let model;try{const ref=state.seedEvidence?.architecturalPack,pack=ref?await loadArchitecturalPack(ref,{runs}):undefined,architecturalEvidence=pack?{jobId:ref.jobId,packSHA256:ref.sha256,sourceSHA256:pack.sourceSHA256,captureJobId:pack.captureJobId,captureSHA256:pack.captureSHA256,sourceOrigin:pack.sourceOrigin,inventoryOrigin:pack.inventoryOrigin,coverage:pack.coverage}:undefined;const lightingStandardEvidence=await resolveLightingStandards(input,lightingProfile?{file:lightingProfile}:undefined);model=lightingStandardEvidence?.issues.some(i=>i.severity==='blocking')?{ok:false,issues:[...state.intake.issues,...lightingStandardEvidence.issues]}:makeEngineeringDesign(input,{lightingStandardEvidence,revision:state.revision,standardEvidence:await resolveEngineeringStandards(input),architecturalEvidence,photometricEvidence:await resolveEngineeringPhotometry(input,{inputRoot:input.luminaires.some(f=>f.iesFile)?await getInputRoot():undefined})});}catch(error){state.status='blocked';state.intake.issues.push({code:error.message.split(':')[0],severity:'blocking',message:error.message});await save(state);return result(state);}if(!model.ok){state.status='blocked';state.intake.issues=model.issues;await save(state);return result(state);}
    state.checks=auditEngineeringDesign(model);state.modelSHA256=engineeringDigest(model);state.status=state.checks.ok?'designed':'blocked';state.history.push({event:'designed',revision:state.revision,modelSHA256:state.modelSHA256});await atomicJson(path.join(dir,'model-'+state.revision+'.json'),model);await atomicJson(path.join(dir,'checks-'+state.revision+'.json'),state.checks);await fs.writeFile(path.join(dir,'review-'+state.revision+'.html'),engineeringReviewHtml(model,state.checks));await save(state);return result(state);
   }
   const model=await read(path.join(dir,'model-'+state.revision+'.json'));if(q.expectedModelSHA256!==state.modelSHA256||engineeringDigest(model)!==state.modelSHA256)throw Error('ENGINEERING_MODEL_CHANGED');
   if(q.action==='review'){
    const record={...q,recordedAt:new Date().toISOString(),authenticatedProfessionalReview:false};state.review.push(record);const reviewFile=path.join(dir,'review-record-'+state.revision+'-'+state.review.length+'.json');await atomicJson(reviewFile,record);if(state.delivery)state.delivery.files.push({kind:'json',file:reviewFile,sha256:await hashFile(reviewFile)});state.history.push({event:'review_recorded',origin:q.origin,modelSHA256:state.modelSHA256});await save(state);return {...result(state),recorded:true,approval:'not_established'};
   }
   if(q.action==='deliver'){
    if(state.delivery){if(state.delivery.requestId!==q.requestId)throw Error('ENGINEERING_DELIVERY_ALREADY_EXISTS');for(const f of state.delivery.files)if(await hashFile(f.file)!==f.sha256)throw Error('ENGINEERING_DELIVERY_CHANGED');return {...result(state),replayed:true};}
    if(['delivering','delivery_unconfirmed'].includes(state.status))throw Error('ENGINEERING_DELIVERY_UNCONFIRMED: do not repeat native creation');
    const currentLightingBasis=await resolveLightingStandards(input,lightingProfile?{file:lightingProfile}:undefined);if(currentLightingBasis?.issues.some(i=>i.severity==='blocking'))throw Error('LIGHTING_STANDARD_INPUT_CONFLICT');if(engineeringDigest(currentLightingBasis??null)!==engineeringDigest(model.lightingStandardEvidence??null))throw Error('LIGHTING_STANDARD_EVIDENCE_MISMATCH');await resolveEngineeringPhotometry(input,{inputRoot:input.luminaires.some(f=>f.iesFile)?await getInputRoot():undefined});const audit=auditEngineeringDesign(model);if(!audit.ok)throw Error('ENGINEERING_DESIGN_CHECK_FAILED');
    state.status='delivering';state.deliveryRequestId=q.requestId;state.nativeSteps=[];await save(state);
    const call=async(action,args)=>{const r=await execute(action,args);state.nativeSteps.push({action,jobRoot:r.jobRoot,ok:r.ok,drawing:r.drawing,drawingSha256:r.drawingSha256});await save(state);if(!r.ok)throw Error('ENGINEERING_NATIVE_FAILED: '+JSON.stringify(r.error));return r;};
    try{
     let current=await call('create_drawing',{scene:model.scene});
     const groups=new Map();for(const item of model.placements){if(!groups.has(item.symbol))groups.set(item.symbol,[]);const {symbol,...instance}=item;groups.get(symbol).push(instance);}
     const operations=[...groups].flatMap(([blockName,instances])=>{const chunks=[];for(let i=0;i<instances.length;i+=100)chunks.push({type:'place_symbols',blockName,instances:instances.slice(i,i+100)});return chunks;});
     for(let i=0;i<operations.length;i+=100)current=await call('apply',{drawing:current.drawing,expectedSha256:current.drawingSha256,documentId:current.snapshot.documentId,expectedRevision:current.snapshot.revision,requestId:crypto.randomUUID(),units:'mm',operations:operations.slice(i,i+100)});
     const drawing=path.join(dir,'design-'+state.revision+'.dwg');await fs.copyFile(current.drawing,drawing,fs.constants.COPYFILE_EXCL);const drawingSHA256=await hashFile(drawing);
     const scan=await call('scan',{drawing,limit:100000,exportDxf:true});const retained=await read(path.join(scan.jobRoot,'result.json'));
     const verification={...verifyEngineeringCad(model,retained.query,retained.snapshot),scanJob:scan.jobRoot,drawingSHA256};await atomicJson(path.join(dir,'cad-verification-'+state.revision+'.json'),verification);if(!verification.ok)throw Error('ENGINEERING_CAD_READBACK_FAILED');
     const exported=await call('export_many',{drawing,items:model.sheets.flatMap(s=>[{name:s.id,format:'pdf',region:s.region,plot:{paper:s.paper??'A3',orientation:'landscape',scale:'fixed',denominator:s.paperDenominator,style:'monochrome.ctb'}},{name:s.id,format:'png',region:s.region}])});
     const fileList=[{kind:'dwg',file:drawing,sha256:drawingSHA256}];
     for(const item of exported.exports||[]){const output=item.exported??item;if(output.file)fileList.push({kind:item.format??output.format??path.extname(output.file).slice(1),file:output.file,sha256:await hashFile(output.file)});}
     if(model.input.photometricDesign){const file=path.join(dir,'r'+state.revision+'-point-illuminance.csv'),rows=[['room','xM','yM','workplaneM','maintainedDirectLux','sourceSHA256'],...model.roomCalculations.flatMap(c=>c.photometry.points.map(p=>[c.roomId,...p.positionM,p.lux,c.photometry.sourceSHA256]))];await fs.writeFile(file,'\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n');fileList.push({kind:'csv',file,sha256:await hashFile(file)});}
     for(const [name,rows]of [['luminaire-catalog.csv',[['id','label','watts','declaredLumens','maintenanceFactor','allowedRoomUses','iesSHA256'],...model.input.luminaires.map(f=>[f.id,f.label,f.watts,f.lumens,f.maintenanceFactor,f.allowedRoomUses?.join(';'),f.iesFile?.sha256])]],['devices.csv',[['id','room','fixture','circuit','control','watts'],...model.devices.map(d=>[d.id,d.roomId,d.fixture,d.circuitId,d.controlId,d.watts])]],['circuits.csv',[['id','room','watts','currentA','estimatedLengthM','dropPercent','scope'],...model.circuits.map(c=>[c.id,c.roomId,c.watts,c.currentA,c.estimatedLengthM,c.dropPercent,c.scope])]],['room-calculations.csv',[['room','count','areaM2','estimatedLux','targetLux','lpd','method','directAverageLux','directMinimumLux','directMaximumLux','directUniformity','iesSHA256','standardClass','standardProfileSHA256','effectiveMaxLpd','effectiveMinimumUniformity'],...model.roomCalculations.map(c=>[c.roomId,c.count,c.areaM2,c.estimatedLux,c.targetLux,c.lpd,c.method,c.photometry?.averageLux,c.photometry?.minimumLux,c.photometry?.maximumLux,c.photometry?.uniformity,c.photometry?.sourceSHA256,c.effectiveTargets?.classId,c.effectiveTargets?.profileSHA256,c.maxLpd,c.effectiveTargets?.minimumUniformity])]]]){const file=path.join(dir,'r'+state.revision+'-'+name);await fs.writeFile(file,'\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n');fileList.push({kind:'csv',file,sha256:await hashFile(file)});}
     const reportFile=path.join(dir,'review-'+state.revision+'.html');fileList.push({kind:'html',file:reportFile,sha256:await hashFile(reportFile)});
     if(await hashFile(drawing)!==drawingSHA256)throw Error('ENGINEERING_DRAWING_CHANGED');
     state.delivery={requestId:q.requestId,revision:state.revision,modelSHA256:state.modelSHA256,drawing,drawingSHA256,verification,files:fileList,exportResult:exported,reviewStatus:'awaiting_human_review'};state.status='delivered';state.history.push({event:'delivered',revision:state.revision,modelSHA256:state.modelSHA256});await save(state);return result(state);
    }catch(error){state.status='delivery_unconfirmed';state.history.push({event:'delivery_interrupted',error:error.message,steps:state.nativeSteps});await save(state);return {ok:false,jobId:state.jobId,status:state.status,error:{code:'ENGINEERING_DELIVERY_UNCONFIRMED',message:error.message,next:'Read project status and saved native steps before recovery; do not issue duplicate generation.'},outcome:'unknown',safeToRetry:false,professionalApproval:false};}
   }
  }finally{await lock.close();await fs.unlink(lease);}
 }
 return {run};
}
