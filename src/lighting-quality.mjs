import {planLightingAssessment,assessmentDeadline,assertAssessmentActive,mapAssessmentRooms,partitionRecord,auditAssessmentPlan} from './lighting-assessment-plan.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {readRadianceRuntime} from './radiance-runtime.mjs';
import {traceRadianceScene} from './radiance-scene.mjs';
import {resolveEngineeringPhotometry,roomLineOfSight} from './engineering-photometry.mjs';
import {spaceContainment,spaceInteriorsOverlap} from './architectural-spaces.mjs';
import {hashFile} from './drawings.mjs';
import {engineeringDigest} from './engineering-design.mjs';
import {csvCell} from './files.mjs';
import {traceUgrRoom,writeUgrAssessment,auditUgrReport} from './ugr-assessment.mjs';
import {resolveUgrMethod} from './ugr-evidence.mjs';

import {qualityProfiles} from './radiance-presets.mjs';
export {qualityProfiles} from './radiance-presets.mjs';
const statistics=xs=>{const averageLux=xs.reduce((a,b)=>a+b,0)/xs.length,minimumLux=Math.min(...xs);return {averageLux,minimumLux,maximumLux:Math.max(...xs),uniformity:averageLux?minimumLux/averageLux:0};};
const polygon=(modifier,name,ps)=>`${modifier} polygon ${name}\n0\n0\n${ps.length*3}\n${ps.map(p=>p.join(' ')).join('\n')}\n`;
const material=(name,r)=>`void plastic ${name}\n0\n0\n5 ${r} ${r} ${r} 0 0\n`;

export function lightingRoomScene(model,room,evidence){
 const environment=model.input.lightingEnvironment;if(!environment)throw Error('LIGHTING_ENVIRONMENT_REQUIRED');const condition=environment.rooms.find(r=>r.roomId===room.id);if(!condition||room.obstacles.length)throw Error('LIGHTING_ENCLOSURE_UNSUPPORTED: '+room.id);
 const floor=room.polygon.map(p=>[p[0]/1000,p[1]/1000,0]),ceiling=floor.map(p=>[p[0],p[1],room.heightM]).reverse(),footprints=[];
 let scene=material('floor',condition.floorReflectance)+material('wall',condition.wallReflectance)+material('ceiling',condition.ceilingReflectance)+polygon('floor','floor_surface',floor)+polygon('ceiling','ceiling_surface',ceiling);
 for(let i=0;i<floor.length;i++){const a=floor[i],b=floor[(i+1)%floor.length];scene+=polygon('wall','wall_'+i,[a,b,[b[0],b[1],room.heightM],[a[0],a[1],room.heightM]]);}
 const lamps=model.devices.filter(d=>d.roomId===room.id).map(d=>{const fixture=model.input.luminaires.find(f=>f.id===d.fixture),photo=evidence.find(e=>e.fixtureId===fixture.id),dimensions=photo?.ies.signedOpeningDimensionsM;
  // Signed LM-63 fields must describe a supported nonzero rectangular opening.
  // Zero/negative shape encodings are not replaced with guessed luminaire sizes.
  if(!dimensions||!(dimensions[0]>0&&dimensions[1]>0&&dimensions[2]===0))throw Error('LIGHTING_OPENING_UNSUPPORTED: '+fixture.id);
  if(d.mountingHeightM>=room.heightM-.02)throw Error('LIGHTING_CEILING_OPENING_REQUIRED: '+d.id);
  const angle=(fixture.rotationDegrees??0)*Math.PI/180,width=dimensions[0]*1000,length=dimensions[1]*1000,footprint=[[-length/2,-width/2],[length/2,-width/2],[length/2,width/2],[-length/2,width/2]].map(([x,y])=>[d.position[0]+x*Math.cos(angle)-y*Math.sin(angle),d.position[1]+x*Math.sin(angle)+y*Math.cos(angle)]);
  if(footprint.some(p=>spaceContainment(p,room.polygon)!=='inside')||footprint.some((p,i)=>!roomLineOfSight(p,footprint[(i+1)%4],room.polygon))||footprints.some(p=>spaceInteriorsOverlap(p,footprint)))throw Error('LIGHTING_OPENING_COLLISION: '+d.id);footprints.push(footprint);
  return {id:d.id,sourceFile:photo.sourceFile,sourceSHA256:photo.sourceSHA256,positionM:[d.position[0]/1000,d.position[1]/1000,d.mountingHeightM],rotationDegrees:fixture.rotationDegrees??0,maintenanceFactor:fixture.maintenanceFactor,openingDimensionsM:dimensions};
 });return {scene,lamps,condition,geometry:'Opaque floor/walls/ceiling; uniform finite rectangular luminous-opening approximation of far-field IES; suspended below ceiling; no windows, door apertures, daylight, internal obstructions or specular materials'};
}

export function auditLightingQuality(model,report,{ugrMethod}={}){
 const checks=[],add=(id,ok)=>checks.push({id,ok}),env=model.input.lightingEnvironment;
 if(report.schemaVersion===2||report.assessmentPlan||model.input.rooms.length>10||model.devices.length>100||model.roomCalculations.reduce((n,r)=>n+(r.photometry?.points.length??0),0)>1000)add('complete_partition_plan',auditAssessmentPlan(model,report));
 add('fixed_settings',JSON.stringify(report.settings)===JSON.stringify(qualityProfiles));add('frozen_model',!!env&&report.modelSHA256===engineeringDigest(model)&&report.environmentSHA256===engineeringDigest(env));add('all_rooms',report.rooms.length===model.input.rooms.length&&new Set(report.rooms.map(r=>r.roomId)).size===report.rooms.length&&model.input.rooms.every(r=>report.rooms.some(v=>v.roomId===r.id)));
 for(const room of model.input.rooms){const result=report.rooms.find(r=>r.roomId===room.id),calc=model.roomCalculations.find(c=>c.roomId===room.id),points=calc.photometry?.points,profiles=result?.profiles,valid=!!points&&qualityProfiles.every(p=>Array.isArray(profiles?.[p.id])&&profiles[p.id].length===points.length&&profiles[p.id].every(v=>Number.isFinite(v)&&v>=0));add('complete_grid_'+room.id,valid&&JSON.stringify(result?.points)===JSON.stringify(points.map(p=>p.positionM)));if(!valid)continue;
  const medium=profiles.medium,fine=profiles.fine,a=statistics(medium),b=statistics(fine),direct=statistics(profiles.direct),pointDelta=fine.map((v,i)=>Math.abs(v-medium[i]));
  add('point_convergence_'+room.id,pointDelta.every((v,i)=>v<=1+.02*Math.max(medium[i],fine[i])));add('mean_convergence_'+room.id,Math.abs(a.averageLux-b.averageLux)<=.5+.01*Math.max(a.averageLux,b.averageLux));add('nonnegative_reflected_'+room.id,fine.every((v,i)=>v+1+.005*profiles.direct[i]>=profiles.direct[i]));
  const required=key=>model.input.requirements.find(q=>q.rule===key&&q.roomIds.includes(room.id)).value,min=calc.targetLux,max=required('max_avg_lux'),u=calc.effectiveTargets?.minimumUniformity??required('min_uniformity');
  add('total_mean_and_uniformity_'+room.id,[a,b].every(s=>s.averageLux>=min&&s.averageLux<=max&&s.uniformity>=u));
  // This is a numerical-stability gate at two finite settings, not a rigorous
  // error bound or a substitute for independent professional model review.
  result.summary={...b,directAverageLux:direct.averageLux,indirectAverageLux:b.averageLux-direct.averageLux,medium:a,maximumPointChange:Math.max(...pointDelta),targets:{minimumLux:min,maximumAverageLux:max,minimumUniformity:u}};
 }
 if(model.input.glareAssessment){const glare=auditUgrReport(model,report.ugr,{method:ugrMethod});checks.push(...glare.checks);}
 return {ok:checks.every(c=>c.ok),checks,scope:'Finite-source diffuse illuminance and, when explicitly requested, Appendix A reference-room UGR; numerical stability is not a formal error bound or actual project approval',professionalApproval:false};
}

export async function assessLightingQuality(model,{folder,inputRoot,runtimeFile,ugrProfileFile,onProgress,maxMinutes=20,maxConcurrentRooms=1,deadlineMs:requestedDeadline}={}){
 const started=Date.now(),deadlineMs=assessmentDeadline({deadlineMs:requestedDeadline,maxMinutes});assertAssessmentActive({deadlineMs});
 if(!model.input.lightingEnvironment)throw Error('LIGHTING_ENVIRONMENT_REQUIRED');const assessmentPlan=planLightingAssessment(model,{maxConcurrentRooms});
 const method=await resolveUgrMethod(model,ugrProfileFile?{file:ugrProfileFile}:undefined),runtime=await readRadianceRuntime(runtimeFile?{file:runtimeFile}:undefined),evidence=await resolveEngineeringPhotometry(model.input,{inputRoot}),rooms=model.input.rooms.map(room=>({room,...lightingRoomScene(model,room,evidence)}));assertAssessmentActive({deadlineMs});
 await fs.mkdir(folder);if(method)await fs.mkdir(path.join(folder,'ugr'));await fs.mkdir(path.join(folder,'partitions'));
 await fs.writeFile(path.join(folder,'assessment-plan.json'),JSON.stringify(assessmentPlan,null,2),{flag:'wx'});
 let completedRooms=0,progressQueue=Promise.resolve();const active=new Map();
 const traced=await mapAssessmentRooms(rooms,maxConcurrentRooms,async(entry,index,signal)=>{
  const partition=assessmentPlan.partitions.find(p=>p.roomIds.includes(entry.room.id));active.set(entry.room.id,'preparing');
  const progress=async profile=>{assertAssessmentActive({deadlineMs,signal});active.set(entry.room.id,profile);const snapshot={roomId:entry.room.id,roomNumber:index+1,roomCount:rooms.length,profile,completedRooms,maxConcurrentRooms,partitionId:partition.id,partitionNumber:assessmentPlan.partitions.indexOf(partition)+1,partitionCount:assessmentPlan.partitions.length,activeRooms:[...active].map(([roomId,profile])=>({roomId,profile})),startedAt:new Date().toISOString()};progressQueue=progressQueue.then(async()=>{assertAssessmentActive({deadlineMs,signal});await fs.appendFile(path.join(folder,'progress.ndjson'),JSON.stringify(snapshot)+'\n');await onProgress?.(snapshot);});await progressQueue;};
  const grid=model.roomCalculations.find(c=>c.roomId===entry.room.id).photometry.points.map(p=>p.positionM),horizontal=await traceRadianceScene({runtime,folder:path.join(folder,'room-'+index),scene:entry.scene,lamps:entry.lamps,sensors:grid.map(positionM=>({positionM,normal:[0,0,1]})),profiles:qualityProfiles,deadlineMs,signal,onProfile:progress});
  const glare=method?await traceUgrRoom(model,entry.room,{folder:path.join(folder,'ugr','room-'+index),runtime,evidence,loaded:method,index,deadlineMs,signal,onProgress:p=>progress(p.profile)}):undefined;
  const result={roomId:entry.room.id,condition:entry.condition,geometry:entry.geometry,lamps:entry.lamps.map(({sourceFile,...lamp})=>lamp),points:grid,profiles:horizontal.values};
  await fs.writeFile(path.join(folder,'partitions','room-'+index+'.json'),JSON.stringify({modelSHA256:assessmentPlan.modelSHA256,partitionId:partition.id,phase:'complete_not_individual_approval',illuminance:result,...(glare?{ugr:glare.room}:{})},null,2),{flag:'wx'});completedRooms++;active.delete(entry.room.id);return {result,commands:horizontal.commands,glare};
 });
 await progressQueue;assertAssessmentActive({deadlineMs});const results=traced.map(r=>r.result),commands=traced.flatMap(r=>r.commands);
 const glare=method?await writeUgrAssessment(model,{folder:path.join(folder,'ugr'),loaded:method,rooms:traced.map(r=>r.glare.room),commands:traced.flatMap(r=>r.glare.commands),ugrProfileFile}):undefined;
 const finalRuntime=await readRadianceRuntime({file:runtime.profileFile});if(finalRuntime.profileSHA256!==runtime.profileSHA256)throw Error('RADIANCE_PROFILE_CHANGED');await resolveEngineeringPhotometry(model.input,{inputRoot});assertAssessmentActive({deadlineMs});
 const report={schemaVersion:2,method:'radiance_finite_diffuse',modelSHA256:engineeringDigest(model),environmentSHA256:engineeringDigest(model.input.lightingEnvironment),runtime:{version:runtime.version,profileSHA256:runtime.profileSHA256,tools:runtime.tools,supportFiles:runtime.supportFiles},settings:qualityProfiles,rooms:results,...(glare?{ugr:glare.report}:{}),assessmentPlan,timing:{elapsedMs:Date.now()-started,maxMinutes,maxConcurrentRooms},professionalApproval:false};
 report.partitionRecords=assessmentPlan.partitions.map(p=>partitionRecord(report,p));report.audit=auditLightingQuality(model,report,{ugrMethod:glare?.method});report.passed=report.audit.ok;
 for(const p of report.partitionRecords)await fs.writeFile(path.join(folder,'partitions',p.id+'.json'),JSON.stringify(p,null,2),{flag:'wx'});
 const rows=[['room','x_m','y_m','z_m','direct_lx','coarse_total_lx','medium_total_lx','fine_total_lx']];for(const room of results)room.points.forEach((p,i)=>rows.push([room.roomId,...p,room.profiles.direct[i],room.profiles.coarse[i],room.profiles.medium[i],room.profiles.fine[i]]));await fs.writeFile(path.join(folder,'total-illuminance.csv'),rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n',{flag:'wx'});await fs.writeFile(path.join(folder,'commands.json'),JSON.stringify(commands,null,2),{flag:'wx'});
 const files=[];async function inventory(relative=''){for(const entry of await fs.readdir(path.join(folder,relative),{withFileTypes:true})){const name=relative?relative+'/'+entry.name:entry.name;if(entry.isSymbolicLink())throw Error('LIGHTING_ARTIFACT_SYMLINK');if(entry.isDirectory())await inventory(name);else files.push({file:name,sha256:await hashFile(path.join(folder,name))});}}await inventory();report.artifacts=files;return report;
}

export async function verifyLightingQualityArtifacts(folder,report){for(const file of report.artifacts){const target=path.resolve(folder,file.file);if(!target.startsWith(path.resolve(folder)+path.sep)||await hashFile(target)!==file.sha256)throw Error('LIGHTING_QUALITY_ARTIFACT_CHANGED');}}
