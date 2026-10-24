// Explicit project dimensions only; no building-code or ergonomic certification.
import {transverseWorkstations} from './planning-transverse-furniture.mjs';
const rect=(x,y,w,h)=>({min:[x,y],max:[x+w,y+h]});
export function planningFurniture(p,program,width,depth){
 const g=p.parameters,front=Math.max(g.doorApproachDepthMm,g.doorWidthMm,g.aisleMm),items=[],seats=[],aisles=[{id:'FRONT',rect:rect(0,0,width,front)}];if(width<g.doorWidthMm+2*g.wallThicknessMm||depth<front||g.chairDepthMm>g.seatClearDepthMm)return undefined;
 const chair=(id,zone)=>{const [w,h]=zone.max.map((v,i)=>v-zone.min[i]),cw=Math.min(g.chairDepthMm,w),ch=g.chairWidthMm;if(ch>h)return false;items.push({id:'CHAIR_'+id,type:'chair',rect:rect((zone.min[0]+zone.max[0]-cw)/2,(zone.min[1]+zone.max[1]-ch)/2,cw,ch)});seats.push({id,clearRect:zone});return true;};
 if(program.activity==='unfurnished')return {items,seats,aisles,doorClear:rect((width-g.doorWidthMm)/2,0,g.doorWidthMm,front),scope:'Unfurnished spatial provision only'};
 if(program.activity==='workstations'){
  const occupied=g.deskDepthMm+g.seatClearDepthMm,rows=Math.floor((depth-front+g.deskGapMm)/(g.deskWidthMm+g.deskGapMm)),banks=[2,1].find(n=>width>=n*occupied+g.aisleMm&&program.occupants<=n*rows);if(!banks||g.chairWidthMm>g.deskWidthMm)return undefined;
  aisles.push({id:'MAIN',rect:rect(occupied,front,width-banks*occupied,depth-front)});
  for(let i=0;i<program.occupants;i++){const bank=banks===2?i%2:0,row=banks===2?Math.floor(i/2):i,v=front+row*(g.deskWidthMm+g.deskGapMm),right=bank===1,x=right?width-g.deskDepthMm:0;items.push({id:'DESK_'+(i+1),type:'desk',rect:rect(x,v,g.deskDepthMm,g.deskWidthMm)});const zone=rect(right?width-occupied:g.deskDepthMm,v,g.seatClearDepthMm,g.deskWidthMm);if(!chair('SEAT_'+(i+1),zone))return undefined;}
 }else{
  const n=Math.ceil(program.occupants/2),length=n*g.meetingSeatPitchMm,occupied=g.meetingTableDepthMm+2*g.seatClearDepthMm;if(width<occupied+2*g.aisleMm||depth<front+length+g.aisleMm||g.chairWidthMm>g.meetingSeatPitchMm)return undefined;
  const x=(width-g.meetingTableDepthMm)/2;items.push({id:'MEETING_TABLE',type:'table',rect:rect(x,front,g.meetingTableDepthMm,length)});aisles.push({id:'LEFT',rect:rect(0,front,x-g.seatClearDepthMm,length+g.aisleMm)},{id:'RIGHT',rect:rect(x+g.meetingTableDepthMm+g.seatClearDepthMm,front,x-g.seatClearDepthMm,length+g.aisleMm)},{id:'BACK',rect:rect(0,front+length,width,g.aisleMm)});
  for(let i=0;i<program.occupants;i++){const side=i%2,row=Math.floor(i/2),zone=rect(side?x+g.meetingTableDepthMm:x-g.seatClearDepthMm,front+row*g.meetingSeatPitchMm,g.seatClearDepthMm,g.meetingSeatPitchMm);if(!chair('SEAT_'+(i+1),zone))return undefined;}
 }
 return {items,seats,aisles,doorClear:rect((width-g.doorWidthMm)/2,0,g.doorWidthMm,front),scope:'Footprints, explicit seat clearance and aisle rectangles only; accessibility, ergonomics and construction details pending'};
}
export function planningFurnitureChoices(input,program,width,depth,mode){const original=planningFurniture(input,program,width,depth),transverse=mode==='allow_transverse_workstations'?transverseWorkstations(input,program,width,depth):undefined;return [original,transverse].filter(Boolean);}
export function furnitureToWorld(room,local,frame){const front=room.side===0?room.v1:room.v0,convert=r=>frame.rect(room.u0+r.min[0],room.side===0?front-r.max[1]:front+r.min[1],room.u0+r.max[0],room.side===0?front-r.min[1]:front+r.max[1]);return {items:local.items.map(i=>({...i,rect:convert(i.rect)})),seats:local.seats.map(i=>({...i,clearRect:convert(i.clearRect)})),aisles:local.aisles.map(i=>({...i,rect:convert(i.rect)})),doorClear:convert(local.doorClear),scope:local.scope,...(local.layout?{layout:local.layout}:{})};}
