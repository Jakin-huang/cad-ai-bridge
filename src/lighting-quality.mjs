import fs from 'node:fs/promises';
import path from 'node:path';
import {readRadianceRuntime,runRadiance} from './radiance-runtime.mjs';
import {resolveEngineeringPhotometry,roomLineOfSight} from './engineering-photometry.mjs';
import {spaceContainment,spaceInteriorsOverlap} from './architectural-spaces.mjs';
import {hashFile} from './drawings.mjs';
import {engineeringDigest} from './engineering-design.mjs';
import {csvCell} from './files.mjs';

export const qualityProfiles=[{id:'direct',bounces:0,samples:0,superSamples:0,weight:.000001,depth:20,sampling:.05,accuracy:0,resolution:0},{id:'coarse',bounces:2,samples:128,superSamples:32,weight:.001,depth:-12,sampling:.2,accuracy:.2,resolution:32},{id:'medium',bounces:4,samples:512,superSamples:128,weight:.0005,depth:-16,sampling:.1,accuracy:.15,resolution:64},{id:'fine',bounces:5,samples:1024,superSamples:256,weight:.0001,depth:-20,sampling:.1,accuracy:.1,resolution:128}];
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

export function auditLightingQuality(model,report){
 const checks=[],add=(id,ok)=>checks.push({id,ok}),env=model.input.lightingEnvironment;
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
 return {ok:checks.every(c=>c.ok),checks,scope:'Finite-source direct plus bounded diffuse interreflection on explicit closed-room assumptions; convergence observation is not a formal error bound; UGR and actual project suitability remain unverified',professionalApproval:false};
}

export async function assessLightingQuality(model,{folder,inputRoot,runtimeFile,onProgress}={}){
 if(!model.input.lightingEnvironment)throw Error('LIGHTING_ENVIRONMENT_REQUIRED');const points=model.roomCalculations.reduce((n,r)=>n+(r.photometry?.points.length??0),0);if(model.input.rooms.length>10||model.devices.length>100||points>1000)throw Error('LIGHTING_ASSESSMENT_BUDGET: at most 10 rooms, 100 luminaires and 1000 points');
 const runtime=await readRadianceRuntime(runtimeFile?{file:runtimeFile}:undefined),evidence=await resolveEngineeringPhotometry(model.input,{inputRoot}),rooms=model.input.rooms.map(room=>({room,...lightingRoomScene(model,room,evidence)}));
 await fs.mkdir(folder);const commands=[],results=[];
 const run=async(tool,args,cwd,input)=>{if(await hashFile(path.join(runtime.root,'bin',tool+'.exe'))!==runtime.tools.find(t=>t.file===tool+'.exe').sha256.toLowerCase())throw Error('RADIANCE_RUNTIME_CHANGED: '+tool);const started=Date.now(),r=await runRadiance(runtime,tool,args,{cwd,input,timeoutMs:tool==='rtrace'?180000:120000});commands.push({tool,args,exitCode:r.code,elapsedMs:Date.now()-started,stderr:r.stderr});return r.stdout;};
 for(const [index,entry] of rooms.entries()){
  const dir=path.join(folder,'room-'+index);await fs.mkdir(dir);let scene=entry.scene;
  for(const [i,lamp] of entry.lamps.entries()){const name='lamp'+i;await fs.copyFile(lamp.sourceFile,path.join(dir,name+'.ies'),fs.constants.COPYFILE_EXCL);if(await hashFile(path.join(dir,name+'.ies'))!==lamp.sourceSHA256)throw Error('IES_SOURCE_CHANGED');await run('ies2rad',['-t','default','-m',lamp.maintenanceFactor,'-o',name,name+'.ies'],dir);const converted=await fs.readFile(path.join(dir,name+'.rad'),'utf8');if(/^\s*!/m.test(converted))throw Error('RADIANCE_INLINE_COMMAND_REJECTED');scene+=(await run('xform',['-rz',lamp.rotationDegrees,'-t',...lamp.positionM,name+'.rad'],dir)).toString('utf8');}
  await fs.writeFile(path.join(dir,'scene.rad'),scene,{flag:'wx'});await fs.writeFile(path.join(dir,'scene.oct'),await run('oconv',['scene.rad'],dir),{flag:'wx'});
  const grid=model.roomCalculations.find(c=>c.roomId===entry.room.id).photometry.points.map(p=>p.positionM),sensors=grid.map(p=>p.join(' ')+' 0 0 1').join('\n')+'\n',profiles={};await fs.writeFile(path.join(dir,'sensors.txt'),sensors,{flag:'wx'});
  for(const p of qualityProfiles){await onProgress?.({roomId:entry.room.id,roomNumber:index+1,roomCount:rooms.length,profile:p.id,startedAt:new Date().toISOString()});const args=['-I+','-h-','-u-','-n',1,'-ab',p.bounces,'-av',0,0,0,'-aw',0,'-aa',p.accuracy,'-ar',p.resolution,'-ad',p.samples,'-as',p.superSamples,'-lw',p.weight,'-lr',p.depth,'-dt',0,'-dc',1,'-dj',0,'-ds',p.sampling,'scene.oct'],raw=await run('rtrace',args,dir,sensors);await fs.writeFile(path.join(dir,p.id+'.txt'),raw,{flag:'wx'});const rows=raw.toString('utf8').trim().split(/\r?\n/).map(line=>line.trim().split(/\s+/).map(Number));if(rows.length!==grid.length||rows.some(r=>r.length!==3||r.some(v=>!Number.isFinite(v)||v<0)))throw Error('RADIANCE_GRID_INVALID');profiles[p.id]=rows.map(([r,g,b])=>179*(.265*r+.670*g+.065*b));}
  results.push({roomId:entry.room.id,condition:entry.condition,geometry:entry.geometry,lamps:entry.lamps.map(({sourceFile,...lamp})=>lamp),points:grid,profiles});
 }
 const finalRuntime=await readRadianceRuntime({file:runtime.profileFile});if(finalRuntime.profileSHA256!==runtime.profileSHA256)throw Error('RADIANCE_PROFILE_CHANGED');await resolveEngineeringPhotometry(model.input,{inputRoot});
 const report={schemaVersion:1,method:'radiance_finite_diffuse',modelSHA256:engineeringDigest(model),environmentSHA256:engineeringDigest(model.input.lightingEnvironment),runtime:{version:runtime.version,profileSHA256:runtime.profileSHA256,tools:runtime.tools,supportFiles:runtime.supportFiles},settings:qualityProfiles,rooms:results,professionalApproval:false};report.audit=auditLightingQuality(model,report);report.passed=report.audit.ok;
 const rows=[['room','x_m','y_m','z_m','direct_lx','coarse_total_lx','medium_total_lx','fine_total_lx']];for(const room of results)room.points.forEach((p,i)=>rows.push([room.roomId,...p,room.profiles.direct[i],room.profiles.coarse[i],room.profiles.medium[i],room.profiles.fine[i]]));await fs.writeFile(path.join(folder,'total-illuminance.csv'),rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n',{flag:'wx'});await fs.writeFile(path.join(folder,'commands.json'),JSON.stringify(commands,null,2),{flag:'wx'});
 const files=[];async function inventory(relative=''){for(const entry of await fs.readdir(path.join(folder,relative),{withFileTypes:true})){const name=relative?relative+'/'+entry.name:entry.name;if(entry.isSymbolicLink())throw Error('LIGHTING_ARTIFACT_SYMLINK');if(entry.isDirectory())await inventory(name);else files.push({file:name,sha256:await hashFile(path.join(folder,name))});}}await inventory();report.artifacts=files;return report;
}

export async function verifyLightingQualityArtifacts(folder,report){for(const file of report.artifacts){const target=path.resolve(folder,file.file);if(!target.startsWith(path.resolve(folder)+path.sep)||await hashFile(target)!==file.sha256)throw Error('LIGHTING_QUALITY_ARTIFACT_CHANGED');}}
