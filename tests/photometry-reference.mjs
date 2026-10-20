// Produce cases for a separate Radiance implementation. Manufacturer files stay local.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {analyticIes} from './helpers/photometric-input.mjs';
import {parseIes,directPointLux} from '../src/ies-photometry.mjs';
import {roomLineOfSight} from '../src/engineering-photometry.mjs';
const [directory,...sources]=process.argv.slice(2);if(!directory||!sources.length)throw Error('Usage: node tests/photometry-reference.mjs NEW-OUTPUT-DIR SOURCE.ies ...');const folder=path.resolve(directory);await fs.mkdir(folder);const cases=[];
const generated=[['axial',analyticIes()],['quadrant',analyticIes({horizontal:[0,90],rows:[[1000,800,0],[1000,400,0]],multiplier:1.7})],['bilateral',analyticIes({horizontal:[0,90,180],rows:[[1000,800,0],[1000,400,0],[1000,200,0]]})],['asymmetric',analyticIes({horizontal:[0,90,180,270,360],rows:[[1000,800,0],[1000,400,0],[1000,200,0],[1000,100,0],[1000,800,0]]})]];
for(const [name,text]of generated){const file=path.join(folder,name+'.ies');await fs.writeFile(file,text);sources.push(file);}
for(const [index,source]of sources.entries()){
 const bytes=await fs.readFile(source),ies=parseIes(bytes.toString('utf8')),lamps=[{positionM:[.1,-.2,3],rotationDegrees:37,maintenanceFactor:.8},{positionM:[3,1,4],rotationDegrees:143,maintenanceFactor:.8}],points=[];
 for(const gamma of [0,10,25,45,65,80])for(const c of [0,33,90,135,180,247,315,359]){const r=2.25*Math.tan(gamma*Math.PI/180);points.push([lamps[0].positionM[0]+r*Math.cos(c*Math.PI/180),lamps[0].positionM[1]+r*Math.sin(c*Math.PI/180),.75]);}
 cases.push({id:'case-'+index,source:path.resolve(source),sourceSHA256:crypto.createHash('sha256').update(bytes).digest('hex'),lamps,points,expectedLux:points.map(p=>lamps.reduce((n,l)=>n+directPointLux(ies,l,p),0)),scope:'Direct point source, rotations, maintained factor, no walls/reflections'});
}
const polygon=[[0,0],[4000,0],[4000,1000],[1000,1000],[1000,4000],[0,4000]],source=sources.at(-1),bytes=await fs.readFile(source),ies=parseIes(bytes.toString('utf8')),lamp={positionM:[.5,3,3],rotationDegrees:37,maintenanceFactor:.8},points=[[3,.5,.75],[.5,.5,.75],[.5,3,.75],[3.5,.5,.75]];
cases.push({id:'concave-occlusion',source:path.resolve(source),sourceSHA256:crypto.createHash('sha256').update(bytes).digest('hex'),lamps:[lamp],points,expectedLux:points.map(p=>roomLineOfSight(lamp.positionM.slice(0,2).map(n=>n*1000),p.slice(0,2).map(n=>n*1000),polygon)?directPointLux(ies,lamp,p):0),walls:polygon.map((a,i)=>{const b=polygon[(i+1)%polygon.length];return [[a[0]/1000,a[1]/1000,0],[b[0]/1000,b[1]/1000,0],[b[0]/1000,b[1]/1000,3.3],[a[0]/1000,a[1]/1000,3.3]];})});
await fs.writeFile(path.join(folder,'cases.json'),JSON.stringify({schemaVersion:1,cases},null,2));console.log(JSON.stringify({ok:true,cases:cases.length,points:cases.reduce((n,c)=>n+c.points.length,0),file:path.join(folder,'cases.json')}));
