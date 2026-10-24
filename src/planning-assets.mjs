// Source-declared floor footprints. No inferred equipment dimensions or codes.
import {z} from 'zod';
import {rectContains,rectOverlap} from './planning-geometry.mjs';
const id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,47}$/),mm=z.number().finite().nonnegative().max(1000000),positive=mm.positive(),point=z.tuple([z.number().finite().min(-1e6).max(1e6),z.number().finite().min(-1e6).max(1e6)]),angle=z.union([z.literal(0),z.literal(90),z.literal(180),z.literal(270)]);
export const planningAssetSchema=z.strictObject({id,roomId:id,name:z.string().min(1).max(60),widthMm:positive,depthMm:positive,orientations:z.array(angle).min(1).max(4),fixed:z.strictObject({position:point,orientationDegrees:angle}).optional(),clearances:z.strictObject({frontMm:mm,backMm:mm,leftMm:mm,rightMm:mm}),minFrontAccessMm:mm,sourceIds:z.array(id).min(1).max(20),status:z.enum(['interpreted','assumed','unresolved']),evidenceQuote:z.string().min(5).max(2000)}).superRefine((a,c)=>{if(new Set(a.orientations).size!==a.orientations.length||a.fixed&&!a.orientations.includes(a.fixed.orientationDegrees))c.addIssue({code:'custom',message:'Asset orientations conflict'});if(a.minFrontAccessMm>a.widthMm||a.minFrontAccessMm>0&&a.clearances.frontMm===0)c.addIssue({code:'custom',message:'Front access needs an explicit front service zone and supported width'});});
export const planningAssetsSchema=z.array(planningAssetSchema).max(32);
const bounds=points=>({min:[0,1].map(i=>Math.min(...points.map(p=>p[i]))),max:[0,1].map(i=>Math.max(...points.map(p=>p[i])))});
export function assetGeometry(a,position,orientationDegrees){
 const w=a.widthMm,d=a.depthMm,c=a.clearances,rotate=([x,y])=>{const p=orientationDegrees===0?[x,y]:orientationDegrees===90?[d-y,x]:orientationDegrees===180?[w-x,d-y]:[y,w-x];return p.map((v,i)=>v+position[i]);},box=(x0,y0,x1,y1)=>bounds([[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(rotate));
 return {id:a.id,roomId:a.roomId,name:a.name,position:[...position],orientationDegrees,fixed:!!a.fixed,rect:box(0,0,w,d),clearRect:box(-c.leftMm,-c.frontMm,w+c.rightMm,d+c.backMm),...(c.frontMm>0?{frontRect:box(0,-c.frontMm,w,0)}:{})};
}
// The front service zone must contact an existing door-connected aisle by the
// explicitly requested width. This checks a planar interface, not accessibility.
export function assetFrontAccess(a,geometry,aisles){
 if(a.minFrontAccessMm===0)return true;const f=geometry.frontRect;if(!f)return false;
 return aisles.some(({rect:r})=>{const lengths=r.max.map((v,i)=>Math.min(v,f.max[i])-Math.max(r.min[i],f.min[i]));return lengths.every(v=>v>=-1e-6)&&lengths[geometry.orientationDegrees%180===0?0:1]>=a.minFrontAccessMm-1e-6;});
}
export function placePlanningAssets(input,room,furniture,consume){
 const required=(input.assets??[]).filter(a=>a.roomId===room.id);if(!required.length)return {assets:[]};
 const ordered=[...required].sort((a,b)=>Number(!!b.fixed)-Number(!!a.fixed)||b.widthMm*b.depthMm-a.widthMm*a.depthMm||a.id.localeCompare(b.id)),blocked=[...furniture.items.map(i=>i.rect),...furniture.seats.map(s=>s.clearRect)],grid=input.parameters.gridMm,origin=input.shell.rect.min;
 let budgetExhausted=false;
 function fits(g,a,placed){return rectContains(room.rect,g.clearRect)&&!blocked.some(r=>rectOverlap(g.clearRect,r))&&!furniture.aisles.some(r=>rectOverlap(g.rect,r.rect))&&!rectOverlap(g.clearRect,furniture.doorClear)&&!placed.some(r=>rectOverlap(g.clearRect,r.clearRect))&&assetFrontAccess(a,g,furniture.aisles);}
 function search(index,placed){if(index===ordered.length)return placed;const a=ordered[index];
  for(const orientation of a.fixed?[a.fixed.orientationDegrees]:a.orientations){
   const shape=assetGeometry(a,[0,0],orientation),axes=[0,1].map(axis=>{
    if(a.fixed)return [a.fixed.position[axis]];
    const candidates=[room.rect.min[axis]-shape.clearRect.min[axis],room.rect.max[axis]-shape.clearRect.max[axis]];
    for(const r of [...blocked,...placed.map(p=>p.clearRect)])candidates.push(r.max[axis]-shape.clearRect.min[axis],r.min[axis]-shape.clearRect.max[axis]);
    for(const {rect:r} of furniture.aisles)candidates.push(r.max[axis]-shape.rect.min[axis],r.min[axis]-shape.rect.max[axis]);
    return [...new Set(candidates.flatMap(v=>[Math.floor((v-origin[axis])/grid)*grid+origin[axis],Math.ceil((v-origin[axis])/grid)*grid+origin[axis]]))].filter(v=>v+shape.clearRect.min[axis]>=room.rect.min[axis]-1e-6&&v+shape.clearRect.max[axis]<=room.rect.max[axis]+1e-6).sort((a,b)=>a-b);
   });
   for(const x of axes[0])for(const y of axes[1]){if(!consume()){budgetExhausted=true;return;}const geometry=assetGeometry(a,[x,y],orientation);if(!fits(geometry,a,placed))continue;const found=search(index+1,[...placed,geometry]);if(found)return found;if(budgetExhausted)return;}
  }
 }
 const assets=search(0,[]);return assets?{assets:required.map(a=>assets.find(g=>g.id===a.id))}:{error:budgetExhausted?'ASSET_SEARCH_BUDGET':'ASSET_NO_CLEAR_PLACEMENT'};
}
