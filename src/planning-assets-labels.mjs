import {rectContains,rectOverlap} from './planning-geometry.mjs';
// Annotation search only. Physical objects and their service zones never move.
export function assetRoomLabel(room,lines,size){
 const step=size*1.6,width=Math.max(...lines.map(t=>Array.from(t).reduce((n,c)=>n+(/[\x00-\x7f]/.test(c)?.65:1),0)))*size,height=(lines.length-1)*step,center=room.rect.min.map((v,i)=>(v+room.rect.max[i])/2),xs=[room.rect.min[0]+200,center[0]-width/2,room.rect.max[0]-width-200],ys=[center[1]+lines.length/2*step];
 for(let y=room.rect.min[1]+300+height;y<=room.rect.max[1]-300-size;y+=step/2)ys.push(y);
 for(const y of ys)for(const x of xs){const rect={min:[x,y-height-size*.2],max:[x+width,y+size]};if(!rectContains(room.rect,rect)||[...(room.assets??[]).map(a=>a.clearRect),room.furniture.doorClear].some(r=>rectOverlap(rect,r)))continue;return {rect,positions:lines.map((text,i)=>({text,position:[x,y-i*step],size}))};}
 throw Error('PLANNING_ASSET_LABEL_NO_CLEAR_REGION: '+room.id);
}
