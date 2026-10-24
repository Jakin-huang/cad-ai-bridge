// Reconstruct declared orientation/clearances independently of placement search.
import {rectContains,rectOverlap} from './planning-geometry.mjs';
const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-6,same=(a,b)=>a&&b&&a.min.every((v,i)=>close(v,b.min[i]))&&a.max.every((v,i)=>close(v,b.max[i]));
export function auditPlanningAssets(input,plan){
 const declarations=input.assets??[],observed=plan.rooms.flatMap(r=>(r.assets??[]).map(a=>({...a,actualRoom:r.id})));if(!declarations.length&&!observed.length)return [];
 const checks=[],add=(id,ok)=>checks.push({id,ok:!!ok});add('asset_coverage',observed.length===declarations.length&&new Set(observed.map(a=>a.id)).size===observed.length&&declarations.every(a=>observed.some(g=>g.id===a.id)));
 for(const a of declarations){const g=observed.find(g=>g.id===a.id),room=plan.rooms.find(r=>r.id===a.roomId);if(!g||!room){add('asset_missing_'+a.id,false);continue;}
  const o=g.orientationDegrees,c=a.clearances,w=a.widthMm,d=a.depthMm,expectedSize=o===0||o===180?[w,d]:[d,w],pads=o===0?[c.leftMm,c.frontMm,c.rightMm,c.backMm]:o===90?[c.backMm,c.leftMm,c.frontMm,c.rightMm]:o===180?[c.rightMm,c.backMm,c.leftMm,c.frontMm]:[c.frontMm,c.rightMm,c.backMm,c.leftMm],expectedClear={min:g.rect.min.map((v,i)=>v-pads[i]),max:g.rect.max.map((v,i)=>v+pads[i+2])};
  const front=c.frontMm>0?o===0?{min:[g.rect.min[0],g.rect.min[1]-c.frontMm],max:[g.rect.max[0],g.rect.min[1]]}:o===90?{min:[g.rect.max[0],g.rect.min[1]],max:[g.rect.max[0]+c.frontMm,g.rect.max[1]]}:o===180?{min:[g.rect.min[0],g.rect.max[1]],max:[g.rect.max[0],g.rect.max[1]+c.frontMm]}:{min:[g.rect.min[0]-c.frontMm,g.rect.min[1]],max:[g.rect.min[0],g.rect.max[1]]}:undefined;
  add('asset_dimensions_'+a.id,a.orientations.includes(o)&&g.roomId===a.roomId&&g.actualRoom===a.roomId&&g.name===a.name&&g.fixed===!!a.fixed&&g.position?.every((v,i)=>close(v,g.rect.min[i]))&&expectedSize.every((v,i)=>close(v,g.rect.max[i]-g.rect.min[i]))&&same(g.clearRect,expectedClear)&&(front?same(g.frontRect,front):g.frontRect===undefined));
  add('asset_retention_'+a.id,!a.fixed||a.fixed.orientationDegrees===o&&a.fixed.position.every((v,i)=>close(v,g.position[i])));
  const f=room.furniture;add('asset_clearance_'+a.id,rectContains(room.rect,expectedClear)&&![...f.items.map(i=>i.rect),...f.seats.map(s=>s.clearRect)].some(r=>rectOverlap(expectedClear,r))&&!f.aisles.some(r=>rectOverlap(g.rect,r.rect))&&!rectOverlap(expectedClear,f.doorClear)&&!observed.some(other=>other!==g&&other.id!==a.id&&other.actualRoom===a.roomId&&rectOverlap(expectedClear,other.clearRect))&&!(plan.directDoors??[]).some(d=>d.clearances.some(c=>c.roomId===a.roomId&&rectOverlap(expectedClear,c.rect))||d.swingRoomId===a.roomId&&rectOverlap(expectedClear,d.swingBounds)));
  const access=a.minFrontAccessMm===0||front&&f.aisles.some(({rect:r})=>{const v=[0,1].map(i=>Math.min(r.max[i],front.max[i])-Math.max(r.min[i],front.min[i]));return v.every(n=>n>=-1e-6)&&v[o===0||o===180?0:1]>=a.minFrontAccessMm-1e-6;});add('asset_front_access_'+a.id,access);
 }
 return checks;
}
