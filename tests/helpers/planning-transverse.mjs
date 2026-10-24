// Independent declared development shell/program, not a reference drawing.
import crypto from 'node:crypto';import {spaceTestInput,planningBrief} from './space-input.mjs';
export function transverseInput(entrySide='west'){
 const p=spaceTestInput(),vertical=['north','south'].includes(entrySide),reverse=['east','north'].includes(entrySide),length=28000,breadth=5200;
 p.projectId='TRANSVERSE_QA';p.title='浅进深工位方案验证';p.shell={rect:{min:[500,-300],max:vertical?[500+breadth,-300+length]:[500+length,-300+breadth]},entry:{side:entrySide,offsetMm:1100,clearWidthMm:1000},windows:Array.from({length:4},(_,i)=>{const from=1000+7000*i,to=from+1000;return {id:'WINDOW_'+i,side:vertical?'east':'north',fromMm:reverse?length-to:from,toMm:reverse?length-from:to};}),keepouts:[],sourceIds:['SHELL','BRIEF'],status:'declared',description:'Explicit shallow rectangular development shell; fixed entry and source facade windows, no final-layout geometry'};
 p.parameters={...p.parameters,corridorMinMm:2200,corridorMaxMm:2200,maxUnassignedAreaM2:8};
 p.program=Array.from({length:4},(_,i)=>({...p.program[0],id:'ROOM_'+(i+1),name:'工作间'+(i+1),activity:'workstations',occupants:4,minAreaM2:19,maxAreaM2:22,preferredAreaM2:19.72,minFrontageMm:6000,minDepthMm:2800,minWindowMm:800,maxEntryRouteMm:30000}));
 p.relations=[{id:'NEIGHBORS',a:'ROOM_1',b:'ROOM_2',kind:'shared_wall',valueMm:2000,sourceIds:['BRIEF'],status:'interpreted',evidenceQuote:'placeholder'}];p.sources[1].sha256=crypto.createHash('sha256').update(JSON.stringify(p.shell)).digest('hex');return planningBrief(p);
}
