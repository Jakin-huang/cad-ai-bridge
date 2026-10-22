import {loadPlanningHandoff} from './space-planning-handoff.mjs';
import {currentPdfReview} from './pdf-review-package.mjs';
import {planningDataSections,readPlanningData} from './space-planning-data.mjs';
import path from 'node:path';
import {createSpacePlanningManager} from './space-planning-projects.mjs';
import {planningPrepareSchema,planningOperationSchemas} from './space-planning-contracts.mjs';
export function createSpacePlanningAdapter(context){
 const manager=createSpacePlanningManager(context);
 return {dataSections:planningDataSections,readData:(binding,q,manifest)=>readPlanningData(manager,binding,q,manifest,context),id:'office-space-planning',version:1,complexDesign:true,limitations:'Bounded rectangular interior shell, fixed source entry/windows/keepouts, two-sided straight corridor or opt-in single-sided edge corridor and rectangular bays. Source-declared area, adjacency, furniture and aisle checks; no building/fire/accessibility/daylight/acoustic/MEP approval. Not independent customer acceptance.',prepareSchema:planningPrepareSchema,operationSchemas:planningOperationSchemas,constraintSensitiveOperations:['design','deliver'],
 validatePrepare:p=>planningPrepareSchema.parse(p),prepare:manager.prepare,inspect:manager.inspect,
 documentChildJobId:requestId=>'job-spaceplan-'+requestId,
 async documentInput(binding){const {s,input}=await manager.load(binding);return {childJobId:binding.childJobId,input,inputSHA256:s.inputSHA256,modelSHA256:s.modelSHA256};},
 validateOperation(op,p){if(!planningOperationSchemas[op])throw Error('TASK_OPERATION_UNSUPPORTED');return planningOperationSchemas[op].parse(p);},invoke:manager.invoke,
 async projectReviewScope({binding,manifest}){
  const {s}=await manager.load(binding);if(!s.sharedSpaces)return undefined;
  const loaded=await loadPlanningHandoff(s.sharedSpaces.ref,{runs:context.runs,expectedProjectId:manifest.project.id});
  return {providesScope:true,ref:s.sharedSpaces.ref,current:loaded.current,spaces:loaded.pack.spaces.map(s=>({id:s.id,name:s.name})),pending:loaded.pack.pending};
 },
 async dependencyNodes({binding}){
  const {s,input,model}=await manager.load(binding),nodes=[],add=(id,kind,label,value,dependsOn=[],authority='declared',available)=>{nodes.push({id,kind,label:label.slice(0,200),value:JSON.parse(JSON.stringify(value)),dependsOn,authority,...(kind==='source'?{sourceRole:'input'}:{}),...(['design','check','artifact','review'].includes(kind)?{available:!!available}:{})});};
  for(const source of input.sources)add('source:'+source.id,'source',source.description,source,[],source.supersededBy?'retired':'declared');
  add('condition:shell','condition','Source shell, entry, facade windows and retained keepouts',input.shell,input.shell.sourceIds.map(id=>'source:'+id),input.shell.status==='unresolved'?'unverified':'declared');
  add('condition:parameters','condition','Declared planning and clearance dimensions',input.parameters,input.parameters.sourceIds.map(id=>'source:'+id),input.parameters.status==='unresolved'?'unverified':input.parameters.status);
  for(const r of [...input.program,...input.relations])add('requirement:'+r.id,'requirement',r.name??r.id,r,r.sourceIds.map(id=>'source:'+id),r.status==='unresolved'?'unverified':r.status);
  if(input.selection)add('requirement:selection','requirement','Source-declared project objective order and bounds',input.selection,input.selection.sourceIds.map(id=>'source:'+id),input.selection.status==='unresolved'?'unverified':input.selection.status);
  for(const r of input.standards)add('standard:'+r.id,'standard',r.code+' '+r.edition,r,['source:'+r.sourceId],'unverified');
  for(const r of input.missingInputs)add('condition:missing:'+r.id,'condition',r.description,r,r.sourceIds.map(id=>'source:'+id),'unverified');
  add('design:model','design','Current space-planning model',{revision:s.revision,inputSHA256:s.inputSHA256,modelSHA256:s.modelSHA256},nodes.map(n=>n.id),'declared',!!model);
  add('check:model','check','Independent geometry, program and furniture checks',s.audit??null,['design:model'],'unverified',!!s.audit);
  for(const f of s.delivery?.files??[])add('artifact:'+path.basename(f.file),'artifact',path.basename(f.file),{kind:f.kind,sha256:f.sha256},['design:model','check:model'],'source_bound',true);
  for(const f of currentPdfReview(s)?.files??[])add('artifact:pdf-review:'+path.basename(f.file),'artifact','Review '+path.basename(f.file),{kind:f.kind,sha256:f.sha256,sourceSHA256:s.pdfReview.sourceSHA256},['design:model','check:model',...nodes.filter(n=>n.kind==='artifact').map(n=>n.id)],'source_bound',true);
  add('review:current','review','Current human-review record',{records:s.review,professionalApproval:false},nodes.filter(n=>['design','check','artifact'].includes(n.kind)).map(n=>n.id),'unverified',!!s.review?.length);return nodes;
 }
 };
}
