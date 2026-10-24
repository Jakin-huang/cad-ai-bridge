import {rectContains,rectOverlap,localFrame} from './planning-geometry.mjs';
const overlap=(a,b,c,d)=>Math.max(0,Math.min(b,d)-Math.max(a,c));
export function corridorDoorSweep(room,width,frame){const r=frame.local(room.rect),mid=(r.u0+r.u1)/2;return room.side===0?frame.rect(mid-width/2,r.v1-width,mid+width/2,r.v1):frame.rect(mid-width/2,r.v0,mid+width/2,r.v0+width);}
function accessible(zone,room,width){return room.furniture.aisles.some(a=>{const lengths=zone.max.map((v,i)=>overlap(zone.min[i],v,a.rect.min[i],a.rect.max[i]));return Math.min(...lengths)>=width-1e-6;});}
function subtract(wall,hole){if(!rectOverlap(wall,hole))return [wall];if(!rectContains(wall,hole))throw Error('DIRECT_DOOR_PARTITION_SHAPE_UNSUPPORTED');const axis=wall.max.findIndex((v,i)=>Math.abs(v-wall.min[i]-(hole.max[i]-hole.min[i]))<1e-6),cross=1-axis;return [{min:wall.min,max:wall.max.map((v,i)=>i===cross?hole.min[i]:v)},{min:wall.min.map((v,i)=>i===cross?hole.max[i]:v),max:wall.max}].filter(r=>r.max.every((v,i)=>v>r.min[i]+1e-6));}

// Bounded openings in same-side room partitions; no routing through a corridor,
// no invented access control hardware or fire/accessible design approval.
export function planningDirectDoors(input,rooms,walls){
 const relations=input.relations.filter(r=>r.kind==='direct_door');if(!relations.length)return {walls,directDoors:[]};
 const frame=localFrame(input),g=input.parameters,W=g.wallThicknessMm,front=Math.max(g.doorApproachDepthMm,g.doorWidthMm,g.aisleMm),result=[];let partitions=walls;
 for(const relation of relations){
  const pair=[rooms.find(r=>r.id===relation.a),rooms.find(r=>r.id===relation.b)].sort((a,b)=>a.u0-b.u0),[left,right]=pair;
  if(left.side!==right.side||Math.abs(left.u1+W-right.u0)>1e-6)return undefined;
  const D=Math.max(g.doorWidthMm,relation.valueMm),depth=Math.max(g.doorApproachDepthMm,D,g.aisleMm),low=Math.max(left.v0,right.v0)+W,high=Math.min(left.v1,right.v1)-W-D;
  if(high<low||left.u1-left.u0<depth||right.u1-right.u0<depth)return undefined;
  const starts=[left.side===0?high:low];for(let v=Math.ceil(low/g.gridMm)*g.gridMm;v<=high;v+=g.gridMm)starts.push(v);
  let chosen;
  for(const v0 of [...new Set(starts)]){
   const v1=v0+D,threshold=frame.rect(left.u1,v0,right.u0,v1),clearances=[{roomId:left.id,rect:frame.rect(left.u1-depth,v0,left.u1,v1)},{roomId:right.id,rect:frame.rect(right.u0,v0,right.u0+depth,v1)}];
   if(!partitions.some(w=>rectContains(w,threshold))||input.shell.keepouts.some(k=>rectOverlap(k.rect,threshold)))continue;
   if(clearances.some((c,i)=>!rectContains(pair[i].rect,c.rect)||pair[i].furniture.items.some(item=>rectOverlap(c.rect,item.rect))||pair[i].furniture.seats.some(s=>rectOverlap(c.rect,s.clearRect))||(pair[i].assets??[]).some(a=>rectOverlap(c.rect,a.clearRect))||!accessible(c.rect,pair[i],Math.min(D,g.aisleMm))))continue;
   for(const swingRoom of [right,left]){
    const intoRight=swingRoom===right,hinge=frame.world(intoRight?right.u0:left.u1,v0),closedEnd=frame.world(intoRight?right.u0:left.u1,v1),openEnd=frame.world((intoRight?right.u0:left.u1)+(intoRight?D:-D),v0),swingBounds=frame.rect(intoRight?right.u0:left.u1-D,v0,intoRight?right.u0+D:left.u1,v1);
    if((swingRoom.assets??[]).some(a=>rectOverlap(swingBounds,a.clearRect))||rectOverlap(swingBounds,corridorDoorSweep(swingRoom,g.doorWidthMm,frame))||result.some(d=>d.swingRoomId===swingRoom.id&&rectOverlap(d.swingBounds,swingBounds)))continue;
    chosen={id:relation.id,a:relation.a,b:relation.b,widthMm:D,lockable:relation.lockable,threshold,clearances,entries:[{roomId:left.id,position:frame.world(left.u1,(v0+v1)/2)},{roomId:right.id,position:frame.world(right.u0,(v0+v1)/2)}],swingRoomId:swingRoom.id,hinge,closedEnd,openEnd,swingBounds,hardwareApproval:false};break;
   }
   if(chosen)break;
  }
  if(!chosen)return undefined;result.push(chosen);partitions=partitions.flatMap(w=>subtract(w,chosen.threshold));
 }
 return {walls:partitions,directDoors:result};
}
