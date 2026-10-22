import crypto from 'node:crypto';
import {spaceTestInput,planningBrief} from './space-input.mjs';
// Independent developer constraints, no finished plan or candidate coordinates.
export function singleSidedSpaceInput(){
 const p=spaceTestInput();p.projectId='NARROW_SUITE';p.title='靠边入口办公空间开发验证';
 p.shell.rect={min:[0,0],max:[14000,6000]};p.shell.entry={side:'west',offsetMm:1000,clearWidthMm:1000};
 p.shell.windows=[{id:'N1',side:'north',fromMm:500,toMm:2000},{id:'N2',side:'north',fromMm:8000,toMm:10000}];p.shell.keepouts=[];
 p.parameters.corridorMinMm=2000;p.parameters.corridorMaxMm=2000;p.parameters.maxUnassignedAreaM2=10;
 p.program=p.program.filter(r=>['OFFICE_A','OFFICE_B'].includes(r.id)).map(r=>({...r,occupants:2,minAreaM2:20,maxAreaM2:28,preferredAreaM2:24,minDepthMm:3800,minWindowMm:800,maxEntryRouteMm:20000}));
 p.relations=p.relations.filter(r=>r.id==='AB');p.sources.find(s=>s.id==='SHELL').sha256=crypto.createHash('sha256').update(JSON.stringify(p.shell)).digest('hex');return planningBrief(p);
}
