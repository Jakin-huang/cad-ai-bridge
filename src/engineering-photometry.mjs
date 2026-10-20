import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {isWithin} from './drawings.mjs';
import {parseIes,directPointLux} from './ies-photometry.mjs';
import {spaceContainment} from './architectural-spaces.mjs';
export async function resolveEngineeringPhotometry(input,{inputRoot}={}){
 const files=input.luminaires.filter(f=>f.iesFile);if(!files.length)return [];
 const root=await fs.realpath(inputRoot),result=[];
 for(const fixture of files){
  const file=await fs.realpath(fixture.iesFile.file);if(!isWithin(root,file)||path.extname(file).toLowerCase()!=='.ies')throw Error('IES_OUTSIDE_INPUT_ROOT');
  const stat=await fs.stat(file);if(stat.size>16*1024*1024)throw Error('IES_TOO_LARGE');const bytes=await fs.readFile(file),sha256=crypto.createHash('sha256').update(bytes).digest('hex'),source=input.sources.find(s=>s.id===fixture.sourceId);
  if(sha256!==fixture.iesFile.sha256.toLowerCase()||source?.role!=='catalog'||source.sha256.toLowerCase()!==sha256)throw Error('IES_SOURCE_BINDING_MISMATCH: '+fixture.id);
  const ies=parseIes(bytes.toString('utf8'));if(Math.abs(ies.watts-fixture.watts)>Math.max(.1,ies.watts*.01))throw Error('IES_POWER_MISMATCH: '+fixture.id);
  if(!ies.absolute&&Math.abs(ies.lamps*ies.lumensPerLamp-fixture.lumens)>Math.max(1,fixture.lumens*.01))throw Error('IES_LAMP_LUMENS_MISMATCH: '+fixture.id);
  const issueDate=/^\d{4}-\d{2}-\d{2}$/.test(ies.header.ISSUEDATE??'')?ies.header.ISSUEDATE:undefined;
  if(issueDate&&issueDate>input.designDate)throw Error('IES_AFTER_DESIGN_DATE: '+fixture.id+' issued '+issueDate+' after '+input.designDate);
  result.push({fixtureId:fixture.id,sourceId:fixture.sourceId,sourceSHA256:sha256,sourceFile:file,issueDate,issueDateScope:'File-declared issue date only; product availability and suitability require external evidence',ies,productAcceptance:'source_file_bound_not_project_approved'});
 }
 return result;
}
export function roomPhotometricGrid(room,settings){
 const ps=room.polygon,min=[0,1].map(axis=>Math.min(...ps.map(p=>p[axis]))),max=[0,1].map(axis=>Math.max(...ps.map(p=>p[axis]))),step=settings.gridSpacingM*1000,offset=settings.edgeOffsetM*1000;
 const coordinates=[0,1].map(axis=>{const low=min[axis]+offset,high=max[axis]-offset;if(low>high)throw Error('PHOTOMETRIC_GRID_EMPTY: '+room.id);const count=Math.max(1,Math.ceil((high-low)/step)),spacing=(high-low)/count;return high===low?[low]:Array.from({length:count+1},(_,i)=>low+i*spacing);});
 if(coordinates[0].length*coordinates[1].length>2500)throw Error('PHOTOMETRIC_GRID_LIMIT: refine scope or explicitly choose a coarser grid');
 const points=[];for(const x of coordinates[0])for(const y of coordinates[1]){const point=[x,y];if(spaceContainment(point,ps)==='inside'&&boundaryDistance(point,ps)+1e-5>=offset)points.push([x/1000,y/1000,room.workplaneM]);}
 if(!points.length)throw Error('PHOTOMETRIC_GRID_EMPTY: '+room.id);return points;
}
const segmentDistance=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dy*t);};
const boundaryDistance=(p,ps)=>Math.min(...ps.map((v,i)=>segmentDistance(p,v,ps[(i+1)%ps.length])));
export function roomLineOfSight(a,b,polygon){
 // Segment is inside the polygon iff every interval split by wall crossings is inside.
 const ts=[0,1],r=[b[0]-a[0],b[1]-a[1]];for(let i=0;i<polygon.length;i++){const c=polygon[i],d=polygon[(i+1)%polygon.length],s=[d[0]-c[0],d[1]-c[1]],den=r[0]*s[1]-r[1]*s[0];if(Math.abs(den)<1e-8)continue;const delta=[c[0]-a[0],c[1]-a[1]],t=(delta[0]*s[1]-delta[1]*s[0])/den,u=(delta[0]*r[1]-delta[1]*r[0])/den;if(t>0&&t<1&&u>=0&&u<=1)ts.push(t);}
 ts.sort((a,b)=>a-b);return ts.slice(1).every((t,i)=>{const v=(t+ts[i])/2;return spaceContainment([a[0]+r[0]*v,a[1]+r[1]*v],polygon)!=='outside';});
}
export function evaluateRoomPhotometry(room,positions,fixture,mountingHeightM,settings,evidence,grid=roomPhotometricGrid(room,settings)){
 if(!evidence||evidence.fixtureId!==fixture.id)throw Error('IES_EVIDENCE_REQUIRED: '+fixture.id);
 if(room.obstacles.length)throw Error('PHOTOMETRIC_OBSTACLE_HEIGHT_REQUIRED: '+room.id);
 if(mountingHeightM<=room.workplaneM||mountingHeightM>room.heightM)throw Error('PHOTOMETRIC_HEIGHT_INVALID: '+room.id);
 const points=grid.map(pointM=>({positionM:pointM,lux:positions.reduce((sum,p)=>sum+(roomLineOfSight(p,pointM.slice(0,2).map(n=>n*1000),room.polygon)?directPointLux(evidence.ies,{positionM:[p[0]/1000,p[1]/1000,mountingHeightM],rotationDegrees:fixture.rotationDegrees??0,maintenanceFactor:fixture.maintenanceFactor},pointM):0),0)})),values=points.map(p=>p.lux),averageLux=values.reduce((a,b)=>a+b,0)/values.length,minimumLux=Math.min(...values),maximumLux=Math.max(...values);
 return {method:'ies_direct_point',sourceSHA256:evidence.sourceSHA256,averageLux,minimumLux,maximumLux,uniformity:averageLux?minimumLux/averageLux:0,grid:settings,points,maintenanceFactor:fixture.maintenanceFactor,rotationDegrees:fixture.rotationDegrees??0,minimumHeightToOpeningRatio:(mountingHeightM-room.workplaneM)/Math.max(...evidence.ies.dimensionsM,1e-9),scope:'Maintained direct horizontal point-source illuminance; opaque vertical room walls; no reflections, daylight, cross-room contributions or UGR; source size and actual installation require review'};
}
