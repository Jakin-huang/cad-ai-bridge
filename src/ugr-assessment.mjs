import fs from 'node:fs/promises';
import path from 'node:path';
import {resolveUgrMethod} from './ugr-evidence.mjs';
import {buildUgrReference} from './ugr-reference.mjs';
import {sumUgr,ugrPositionIndex} from './ugr.mjs';
import {iesCandela} from './ies-photometry.mjs';
import {qualityProfiles} from './radiance-presets.mjs';
import {traceRadianceScene} from './radiance-scene.mjs';
import {engineeringDigest} from './engineering-design.mjs';
import {csvCell} from './files.mjs';
export function auditUgrReport(model,report,{method}={}){
 const checks=[],add=(id,ok)=>checks.push({id,ok}),request=model.input.glareAssessment;
 if(!request)return {ok:!report,checks:[],professionalApproval:false};
 add('ugr_verified_method',!!method&&method.sha256===request.expectedProfileSHA256.toLowerCase());
 add('ugr_fixed_settings',JSON.stringify(report?.settings)===JSON.stringify(qualityProfiles.filter(p=>p.id!=='coarse')));
 add('ugr_frozen_method_and_conditions',!!report&&report.profileId===request.profileId&&report.profileSHA256===request.expectedProfileSHA256.toLowerCase()&&report.modelSHA256===engineeringDigest(model)&&report.conditionsSHA256===engineeringDigest(request)&&report.initialOutputMaintenanceFactor===1);
 add('ugr_all_rooms',!!report&&report.rooms.length===model.input.rooms.length&&new Set(report.rooms.map(r=>r.roomId)).size===model.input.rooms.length&&model.input.rooms.every(r=>report.rooms.some(q=>q.roomId===r.id)));
 for(const room of model.input.rooms){
  const r=report?.rooms.find(r=>r.roomId===room.id),condition=request.rooms.find(r=>r.roomId===room.id),limit=Math.min(condition.maximumUgr,model.lightingStandardEvidence.rooms.find(r=>r.roomId===room.id).maximumUgr),ds=model.devices.filter(d=>d.roomId===room.id),eye=condition.posture==='seated'?1.2:1.5,center=[0,1].map(axis=>room.polygon.reduce((n,p)=>n+p[axis],0)/4);
  const walls={WALL_X_MIN:[0,3],WALL_X_MAX:[1,2],WALL_Y_MIN:[0,1],WALL_Y_MAX:[3,2]};
  add('ugr_observer_coverage_'+room.id,!!r&&r.observers.length===4&&new Set(r.observers.map(o=>o.observer.id)).size===4&&r.observers.every(o=>walls[o.observer.id]));
  add('ugr_reference_surfaces_'+room.id,!!r&&engineeringDigest(r.condition)===engineeringDigest(condition)&&r.geometry.referenceWorkplaneM===.75&&ds.every(d=>d.mountingHeightM===r.geometry.installationPlaneM)&&r.geometry.luminousHoles===ds.length&&Math.abs(r.geometry.roomWidthM-Math.hypot(room.polygon[1][0]-room.polygon[0][0],room.polygon[1][1]-room.polygon[0][1])/1000)<1e-8&&Math.abs(r.geometry.roomDepthM-Math.hypot(room.polygon[3][0]-room.polygon[0][0],room.polygon[3][1]-room.polygon[0][1])/1000)<1e-8&&Math.abs(r.geometry.ceilingAreaM2+r.geometry.luminousAreaM2-r.geometry.roomWidthM*r.geometry.roomDepthM)<1e-6);
  for(const obs of r?.observers??[]){
   const tag=room.id+'_'+obs.observer.id,indices=walls[obs.observer.id],position=indices?[0,1].map(axis=>(room.polygon[indices[0]][axis]+room.polygon[indices[1]][axis])/2000):[],direction=position.map((v,axis)=>center[axis]/1000-v),length=Math.hypot(...direction);
   add('ugr_observer_frame_'+tag,!!indices&&obs.observer.posture===condition.posture&&Math.hypot(obs.observer.positionM[0]-position[0],obs.observer.positionM[1]-position[1])<1e-8&&obs.observer.positionM[2]===eye&&obs.observer.direction.every((v,i)=>Math.abs(v-direction[i]/length)<1e-8));
   const valid=obs.issues.length===0&&obs.sources.length===ds.length&&new Set(obs.sources.map(s=>s.id)).size===ds.length&&obs.sources.every(s=>ds.some(d=>d.id===s.id));
   add('ugr_source_coverage_'+tag,valid);if(!valid||!method){add('ugr_background_and_limit_'+tag,false);continue;}
   const termsOK=obs.sources.every(s=>{try{
    const device=ds.find(d=>d.id===s.id),fixture=model.input.luminaires.find(f=>f.id===device.fixture),ies=model.photometricEvidence.find(e=>e.fixtureId===fixture.id).ies,dx=device.position[0]/1000-position[0],dy=device.position[1]/1000-position[1],dz=device.mountingHeightM-eye,distance=Math.hypot(dx,dy,dz),forward=dx*obs.observer.direction[0]+dy*obs.observer.direction[1],lateral=Math.abs(-dx*obs.observer.direction[1]+dy*obs.observer.direction[0]),area=ies.signedOpeningDimensionsM[0]*ies.signedOpeningDimensionsM[1],ap=area*dz/distance,p=ugrPositionIndex(method.profile.positionIndex,lateral/forward,dz/forward),gamma=Math.acos(dz/distance)*180/Math.PI,c=Math.atan2(-dy,-dx)*180/Math.PI-(fixture.rotationDegrees??0),intensity=iesCandela(ies,gamma,c),l=intensity/ap,w=ap/distance**2,term=l*l*w/p.value**2;
    return area>.005+1e-12&&area<1.5-1e-12&&forward>0&&Number.isFinite(s.term)&&s.term>=0&&Math.abs(s.forwardM-forward)<1e-8&&Math.abs(s.lateralM-lateral)<1e-8&&Math.abs(s.elevationM-dz)<1e-8&&Math.abs(s.distanceM-distance)<1e-8&&Math.abs(s.emittingAreaM2-area)<1e-9&&Math.abs(s.projectedAreaM2-ap)<1e-9&&s.positionIndex.value===p.value&&JSON.stringify(s.positionIndex.cells)===JSON.stringify(p.cells)&&Math.abs(s.gammaDegrees-gamma)<1e-8&&Math.abs(s.cDegrees-c)<1e-8&&Math.abs(s.intensityCd-intensity)<1e-4&&Math.abs(s.luminanceCdM2-l)<1e-4&&Math.abs(s.solidAngleSr-w)<1e-9&&Math.abs(s.term-term)<1e-4&&s.outputBasis.startsWith('Initial');
   }catch{return false;}});add('ugr_formula_terms_'+tag,termsOK);
   let medium,fine;try{medium=sumUgr(obs.sources,obs.eyeLux.medium-obs.eyeLux.direct);fine=sumUgr(obs.sources,obs.eyeLux.fine-obs.eyeLux.direct);}catch{add('ugr_background_and_limit_'+tag,false);continue;}
   add('ugr_rating_stability_'+tag,Math.abs(medium.ugr-fine.ugr)<=.25);add('ugr_background_and_limit_'+tag,Math.max(medium.ugr,fine.ugr)<=limit);
   obs.result={medium,fine,conservativeUgr:Math.max(medium.ugr,fine.ugr),maximumUgr:limit,observedUgrChange:Math.abs(medium.ugr-fine.ugr)};
  }
 }
 return {ok:checks.every(c=>c.ok),checks,scope:'Initial-output UGR on explicit Appendix A reference box and active table brackets; 0.25 UGR stability is a software criterion, not a formal error bound or whole-project glare approval',professionalApproval:false};
}
export async function assessUgr(model,{folder,runtime,evidence,ugrProfileFile,onProgress}={}){
 const loaded=await resolveUgrMethod(model,ugrProfileFile?{file:ugrProfileFile}:undefined);if(!loaded)return undefined;await fs.mkdir(folder);const method=loaded.profile,rooms=[],commands=[];for(const [i,room] of model.input.rooms.entries()){
  const condition=model.input.glareAssessment.rooms.find(r=>r.roomId===room.id),reference=buildUgrReference(model,room,condition,method,evidence);let values;
  if(reference.calculations.every(o=>!o.issues.length)){const traced=await traceRadianceScene({runtime,folder:path.join(folder,'room-'+i),scene:reference.scene,lamps:reference.lamps,sensors:reference.observers.map(o=>({positionM:o.positionM,normal:[...o.direction,0]})),profiles:qualityProfiles.filter(p=>p.id!=='coarse'),onProfile:async profile=>onProgress?.({roomId:room.id,roomNumber:i+1,roomCount:model.input.rooms.length,profile:'ugr_'+profile,startedAt:new Date().toISOString()})});values=traced.values;commands.push(...traced.commands);}
  rooms.push({roomId:room.id,condition,geometry:reference.geometry,symmetry:reference.lamps.map(l=>({fixtureId:l.fixtureId,...l.symmetry})),observers:reference.calculations.map((o,index)=>({...o,eyeLux:values?{direct:values.direct[index],medium:values.medium[index],fine:values.fine[index]}:undefined}))});
 }
 const report={schemaVersion:1,method:'gb50034_appendix_a_reference_ugr',profileId:method.id,profileSHA256:loaded.sha256,modelSHA256:engineeringDigest(model),conditionsSHA256:engineeringDigest(model.input.glareAssessment),source:{code:method.source.code,edition:method.source.edition,sha256:method.source.sha256,url:method.source.url,witnesses:method.witnesses.map(({pdfPage,pixelSHA256,scope})=>({pdfPage,pixelSHA256,scope}))},positionIndexInterpretation:method.positionIndex.interpretation,initialOutputMaintenanceFactor:1,settings:qualityProfiles.filter(p=>p.id!=='coarse'),rooms,professionalApproval:false};report.audit=auditUgrReport(model,report,{method:loaded});report.passed=report.audit.ok;
 const rows=[['room','observer','posture','direct_eye_lx','medium_total_eye_lx','fine_total_eye_lx','fine_indirect_eye_lx','reference_ugr','limit','issues']];for(const room of rooms)for(const o of room.observers)rows.push([room.roomId,o.observer.id,o.observer.posture,o.eyeLux?.direct,o.eyeLux?.medium,o.eyeLux?.fine,o.result?.fine.indirectEyeLux,o.result?.conservativeUgr,o.result?.maximumUgr,o.issues.map(i=>i.code).join(';')]);await fs.writeFile(path.join(folder,'ugr-observers.csv'),rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n',{flag:'wx'});await fs.writeFile(path.join(folder,'commands.json'),JSON.stringify(commands,null,2),{flag:'wx'});await fs.writeFile(path.join(folder,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});const after=await resolveUgrMethod(model,ugrProfileFile?{file:ugrProfileFile}:undefined);if(after.sha256!==loaded.sha256)throw Error('UGR_PROFILE_CHANGED');return {report,method:loaded};
}
