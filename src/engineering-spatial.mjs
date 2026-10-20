// Bounded inference for rectangular rooms. It does not certify architectural
// topology: the returned geometry remains inferred until a human confirms it.
export function inferRectangularRoom(rows,label,{minAreaM2=3,maxAreaM2=300}={}){
 const lines=[];
 for(const e of rows.filter(e=>['WALL','WALL-MOVE','COLUMN','WINDOW'].includes(e.layer))){
  if(e.type==='LINE')lines.push([e.start,e.end]);
  if(e.type==='LWPOLYLINE'&&e.vertices){for(let i=1;i<e.vertices.length;i++)lines.push([e.vertices[i-1],e.vertices[i]]);if(e.closed)lines.push([e.vertices.at(-1),e.vertices[0]]);}
 }
 // Closing short collinear gaps treats door/window openings as room boundaries.
 // This is an explicit inference, never an issued architectural polygon.
 for(const axis of [0,1]){
  const groups=new Map();for(const [a,b]of [...lines])if(Math.abs(a[axis]-b[axis])<1){const key=Math.round((a[axis]+b[axis])/2);(groups.get(key)||groups.set(key,[]).get(key)).push([Math.min(a[1-axis],b[1-axis]),Math.max(a[1-axis],b[1-axis])]);}
  for(const [coordinate,spans]of groups){spans.sort((a,b)=>a[0]-b[0]);let current;for(const span of spans){if(current&&span[0]-current[1]<=2400)current[1]=Math.max(current[1],span[1]);else{if(current)lines.push(axis===0?[[coordinate,current[0]],[coordinate,current[1]]]:[[current[0],coordinate],[current[1],coordinate]]);current=[...span];}}if(current)lines.push(axis===0?[[coordinate,current[0]],[coordinate,current[1]]]:[[current[0],coordinate],[current[1],coordinate]]);}
 }
 const b=label.bounds,anchor=b?[(b.min[0]+b.max[0])/2,(b.min[1]+b.max[1])/2]:label.position.slice(0,2),candidates=[];
 for(const dx of [0,-300,300,-600,600])for(const dy of [0,-300,300,-600,600]){
  const p=[anchor[0]+dx,anchor[1]+dy],xs=[],ys=[];
  for(const [a,b]of lines){if(Math.abs(a[0]-b[0])<1&&p[1]>=Math.min(a[1],b[1])-1&&p[1]<=Math.max(a[1],b[1])+1)xs.push((a[0]+b[0])/2);if(Math.abs(a[1]-b[1])<1&&p[0]>=Math.min(a[0],b[0])-1&&p[0]<=Math.max(a[0],b[0])+1)ys.push((a[1]+b[1])/2);}
  const left=Math.max(...xs.filter(x=>x<p[0]-100)),right=Math.min(...xs.filter(x=>x>p[0]+100)),bottom=Math.max(...ys.filter(y=>y<p[1]-100)),top=Math.min(...ys.filter(y=>y>p[1]+100)),area=(right-left)*(top-bottom)/1e6;
  if([left,right,bottom,top].every(Number.isFinite)&&area>=minAreaM2&&area<=maxAreaM2&&anchor[0]>left&&anchor[0]<right&&anchor[1]>bottom&&anchor[1]<top)candidates.push({left,right,bottom,top,area});
 }
 candidates.sort((a,b)=>a.area-b.area);const best=candidates[0];
 if(!best)return {ok:false,reason:'No bounded rectangular room found; explicit architectural geometry is required',labelHandle:label.handle};
 const {left:l,right:r,bottom:b0,top:t}=best;
 return {ok:true,polygon:[[l,b0],[r,b0],[r,t],[l,t]].map(p=>p.map(v=>Math.round(v*1000)/1000)),areaM2:best.area,geometryStatus:'inferred',labelHandle:label.handle,instancePath:label.instancePath,method:'Nearest axis-aligned wall/window intersections around architectural label; not a topology proof',candidateCount:candidates.length};
}
