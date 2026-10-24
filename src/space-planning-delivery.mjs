import {retainAssetChangeReport} from './planning-asset-change-report.mjs';
import {exportEngineeringSheets} from './engineering-sheet-export.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {atomicJson,csvCell} from './files.mjs';
import {hashFile} from './drawings.mjs';
import {verifySceneCapture} from './scene-capture-verification.mjs';
import {rectArea} from './planning-geometry.mjs';
import {retainSourceDocumentIndex} from './source-document-index.mjs';
export async function deliverSpacePlan({model,state,dir,execute,save}){
 const native=async(action,args)=>{const r=await execute(action,args);state.nativeSteps.push({action,jobRoot:r.jobRoot,ok:r.ok,drawing:r.drawing,drawingSha256:r.drawingSha256});await save();if(!r.ok)throw Error('PLANNING_NATIVE_FAILED: '+JSON.stringify(r.error));return r;};
 let current=await native('create_drawing',{scene:model.scene});
 for(const symbol of [...new Set(model.placements.map(p=>p.symbol))]){const placements=model.placements.filter(p=>p.symbol===symbol);for(let i=0;i<placements.length;i+=100){const instances=placements.slice(i,i+100).map(({symbol,...instance})=>instance);current=await native('apply',{drawing:current.drawing,expectedSha256:current.drawingSha256,documentId:current.snapshot.documentId,expectedRevision:current.snapshot.revision,requestId:crypto.randomUUID(),units:'mm',operations:[{type:'place_symbols',blockName:symbol,instances}]});}}
 const drawing=path.join(dir,'design-'+state.revision+'.dwg');await fs.copyFile(current.drawing,drawing,fs.constants.COPYFILE_EXCL);const drawingSHA256=await hashFile(drawing),scan=await native('scan',{drawing,limit:100000,exportDxf:true}),retained=JSON.parse((await fs.readFile(path.join(scan.jobRoot,'result.json'),'utf8')).replace(/^\uFEFF/,'')),verification={...verifySceneCapture(model.scene,model.placements,retained.query),scanJob:scan.jobRoot,drawingSHA256};
 const verificationFile=path.join(dir,'cad-verification-'+state.revision+'.json');await atomicJson(verificationFile,verification);if(!verification.ok)throw Error('PLANNING_SAVED_DRAWING_CHECK_FAILED');
 const exported=await exportEngineeringSheets(native,drawing,model.sheets);
 const files=[],add=async(kind,file)=>files.push({kind,file,sha256:await hashFile(file)});await add('dwg',drawing);await add('json',verificationFile);
 for(const item of exported.exports??[]){const f=item.exported??item;if(f.file)await add(f.format??path.extname(f.file).slice(1),f.file);}
 if((exported.exports??[]).length!==model.sheets.length*2||(exported.exports??[]).some(r=>r.ok===false))throw Error('PLANNING_EXPORT_INCOMPLETE');
 const csv=path.join(dir,'program-'+state.revision+'.csv'),rows=[['spaceId','name','activity','netAreaM2','minimumM2','maximumM2','seats','windowContactMm','entryRouteMm','inputSHA256'],...model.plan.rooms.map(r=>{const p=model.input.program.find(p=>p.id===r.id);return [r.id,p.name,p.activity,rectArea(r.rect)/1e6,p.minAreaM2,p.maxAreaM2,p.occupants,r.windowMm,r.entryRouteMm,model.inputSHA256];})];await fs.writeFile(csv,'\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n',{flag:'wx'});await add('csv',csv);
 if(model.plan.directDoors?.length){const file=path.join(dir,'direct-doors-'+state.revision+'.csv'),rows=[['relationId','fromSpace','toSpace','clearWidthMm','lockableIntent','hardwareApproval','inputSHA256'],...model.plan.directDoors.map(d=>[d.id,d.a,d.b,d.widthMm,d.lockable,false,model.inputSHA256])];await fs.writeFile(file,'\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n',{flag:'wx'});await add('csv',file);}
 if(model.input.assets?.length){const file=path.join(dir,'assets-'+state.revision+'.csv'),rows=[['assetId','name','spaceId','widthMm','depthMm','xMm','yMm','orientationDegrees','fixed','frontMm','backMm','leftMm','rightMm','minFrontAccessMm','evidenceStatus','sourceIds','inputSHA256'],...model.input.assets.map(a=>{const g=model.plan.rooms.flatMap(r=>r.assets??[]).find(g=>g.id===a.id);return [a.id,a.name,a.roomId,a.widthMm,a.depthMm,...g.position,g.orientationDegrees,g.fixed,a.clearances.frontMm,a.clearances.backMm,a.clearances.leftMm,a.clearances.rightMm,a.minFrontAccessMm,a.status,a.sourceIds.join('|'),model.inputSHA256];})];await fs.writeFile(file,'\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n',{flag:'wx'});await add('csv',file);}
 files.push(...await retainAssetChangeReport({dir,revision:state.revision,report:model.assetChanges}));
 const reviewFile=path.join(dir,'review-package-'+state.revision+'.json');await fs.writeFile(reviewFile,JSON.stringify({schemaVersion:1,revision:state.revision,inputSHA256:state.inputSHA256,modelSHA256:state.modelSHA256,audit:model.audit,verification,alternatives:model.alternatives,sheets:model.sheets,files,reviewStatus:'awaiting_human_review',professionalApproval:false},null,2)+'\n',{flag:'wx'});await add('json',reviewFile);
 for(const name of ['input-'+state.revision+'.json','model-'+state.revision+'.json',state.studyFile])await add('json',path.join(dir,name));
 files.push(...await retainSourceDocumentIndex({dir,revision:state.revision,index:model.sourceDocuments}));
 if(await hashFile(drawing)!==drawingSHA256)throw Error('PLANNING_DRAWING_CHANGED');return {revision:state.revision,modelSHA256:state.modelSHA256,drawing,drawingSHA256,verification,files,reviewStatus:'awaiting_human_review',professionalApproval:false};
}
