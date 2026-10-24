// One transverse bank along the rear of the room. The entry approach and
// connected front aisle are retained, rather than rotating an existing plan
// (which would rotate its doorway away from the corridor).
export function transverseWorkstations(input,program,width,depth){
 if(program.activity!=='workstations'||program.occupants<1)return undefined;
 const g=input.parameters,n=program.occupants,front=Math.max(g.doorApproachDepthMm,g.doorWidthMm,g.aisleMm),span=n*g.deskWidthMm+(n-1)*g.deskGapMm,zoneFront=depth-g.deskDepthMm-g.seatClearDepthMm;
 if(width<Math.max(span,g.doorWidthMm+2*g.wallThicknessMm)||zoneFront<front||g.chairWidthMm>g.deskWidthMm||g.chairDepthMm>g.seatClearDepthMm)return undefined;
 const rect=(x,y,w,h)=>({min:[x,y],max:[x+w,y+h]}),items=[],seats=[],start=(width-span)/2;
 for(let i=0;i<n;i++){const x=start+i*(g.deskWidthMm+g.deskGapMm),id='SEAT_'+(i+1);items.push({id:'DESK_'+(i+1),type:'desk',rect:rect(x,depth-g.deskDepthMm,g.deskWidthMm,g.deskDepthMm)},{id:'CHAIR_'+id,type:'chair',rect:rect(x+(g.deskWidthMm-g.chairWidthMm)/2,zoneFront+(g.seatClearDepthMm-g.chairDepthMm)/2,g.chairWidthMm,g.chairDepthMm)});seats.push({id,clearRect:rect(x,zoneFront,g.deskWidthMm,g.seatClearDepthMm)});}
 return {layout:'transverse_workstation_row',items,seats,aisles:[{id:'FRONT',rect:rect(0,0,width,zoneFront)}],doorClear:rect((width-g.doorWidthMm)/2,0,g.doorWidthMm,front),scope:'Single rear transverse workstation bank; original desk/chair dimensions, seat zones and front entry aisle only. No ergonomic, accessible, daylight or professional acceptance.'};
}
