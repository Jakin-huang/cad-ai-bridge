// Installation coordinates are projected without changing the electrical model.
// Coordinate IDs identify locations, never electrical junctions at crossings.
export function installationPlanPoints(circuit){
 const points=[],index=new Map();
 for(const run of circuit.runs)for(const p of run.vertices){const key=JSON.stringify(p.slice(0,2));if(!index.has(key)){index.set(key,points.length);points.push({id:'V'+(points.length+1),xy:p.slice(0,2)});}}
 return {points,paths:circuit.runs.map(r=>({id:r.id,sequence:r.vertices.map(p=>points[index.get(JSON.stringify(p.slice(0,2)))].id+'@'+Number(p[2].toFixed(3))).join(' > ')}))};
}
export function drawLightingInstallationPlans(model,{sheet,text,line}){
 if(!model.installation)return;
 for(const [ci,c]of model.installation.circuits.entries()){
  const label='Q'+String(ci+1).padStart(2,'0'),{points,paths}=installationPlanPoints(c),room=model.input.rooms.find(r=>r.id===c.roomId);
  const all=[...points.map(p=>p.xy),...room.polygon],lo=[0,1].map(i=>Math.min(...all.map(p=>p[i]))),hi=[0,1].map(i=>Math.max(...all.map(p=>p[i])));
  const scale=Math.min(19500/Math.max(1,hi[0]-lo[0]),15000/Math.max(1,hi[1]-lo[1])),offsetX=1800+(19500-(hi[0]-lo[0])*scale)/2;
  const callouts=[...points].sort((a,b)=>b.xy[1]-a.xy[1]||b.xy[0]-a.xy[0]);
  // A separate coordinate rail keeps labels off the actual installation paths.
  // More than 18 points gets another full plan with the remaining callouts.
  for(let start=0;start<points.length;start+=18){
   const s=sheet('E08-'+label+'-'+(start/18+1),'安装路径定位 '+label+' / '+(start/18+1)),x=s.origin[0];
   const map=p=>[x+offsetX+(p[0]-lo[0])*scale,6000+(p[1]-lo[1])*scale];
   s.installationPlan={circuitId:c.circuitId,scale,worldMin:lo,offset:[offsetX,6000],pointStart:start,pointCount:Math.min(18,points.length-start)};
   const t=(px,y,v,h=220)=>text([x+px,y],v,h);
   t(1500,22200,c.circuitId+' / '+c.roomId+' | 坐标单位mm；平面缩放示意，以坐标表定位。');
   for(const [i,p]of room.polygon.entries())line(map(p),map(room.polygon[(i+1)%room.polygon.length]),'E-ARCH');
   for(const obstacle of room.obstacles)for(const [i,p]of obstacle.entries())line(map(p),map(obstacle[(i+1)%obstacle.length]),'E-ARCH');
   const segments=new Set();
   for(const r of c.runs)for(let i=1;i<r.vertices.length;i++){
    const a=r.vertices[i-1].slice(0,2),b=r.vertices[i].slice(0,2);if(JSON.stringify(a)===JSON.stringify(b))continue;
    const key=[JSON.stringify(a),JSON.stringify(b)].sort().join('|');if(segments.has(key))continue;segments.add(key);line(map(a),map(b),'E-INSTALL-PATH');
   }
   for(const p of points){const [px,py]=map(p.xy),d=65;line([px-d,py-d],[px+d,py+d],'E-INSTALL-NODE');line([px-d,py+d],[px+d,py-d],'E-INSTALL-NODE');}
   callouts.slice(start,start+18).forEach((p,i)=>{
    const y=21000-i*850,pos=map(p.xy),end=[x+23500,y];
    // Explicit dash geometry survives monochrome.ctb without a DLL/style change.
    for(let dash=0;dash<12;dash++)line(pos.map((v,k)=>v+(end[k]-v)*(2*dash/23)),pos.map((v,k)=>v+(end[k]-v)*((2*dash+1)/23)),'E-INSTALL-REF');
    t(23800,y,p.id+'  X='+Number(p.xy[0].toFixed(3))+' Y='+Number(p.xy[1].toFixed(3)),210);
    const nodes=c.nodes.filter(n=>n.position[0]===p.xy[0]&&n.position[1]===p.xy[1]);
    t(23800,y-330,nodes.length?nodes.map(n=>n.id+'@'+n.position[2]).join(' / '):'路径转折位置',200);
   });
   t(1500,4400,'实线：当前回路路径投影；虚线：定位索引；叉记：端点或转折投影，非接线符号。',230);
   t(1500,3700,'同XY可有不同标高；交叉不自动连接。完整顺序/标高见E09-'+label+'，端子及导体见E07-'+label+'。',220);
   t(1500,3000,'仅当前回路及所属房间边界；其他空间和建筑协调见总平面。来源等级 '+model.installation.authority+'；待专业审核。',210);
  }
  // Wrapped path rows, with continued rows preserving the run identity.
  const rows=[];
  for(const p of paths){const tokens=p.sequence.split(' > ');let row='';for(const token of tokens){if((row+' > '+token).length>100){rows.push({id:p.id,text:row});row=token;}else row+=(row?' > ':'')+token;}rows.push({id:p.id,text:row});}
  for(let start=0;start<rows.length;start+=20){
   const s=sheet('E09-'+label+'-'+(start/20+1),'路径顺序与标高 '+label+' / '+(start/20+1)),x=s.origin[0];
   text([x+1500,22200],c.circuitId+' | V对应E08定位索引；V@Z，Z单位mm；重复V表示竖向段。',230);
   rows.slice(start,start+20).forEach((r,i)=>text([x+1500,21000-i*800],r.id+' | '+r.text,220));
   text([x+1500,3800],'同一W多行时按行顺序续接；路径交叉和同坐标均不表示端子连通，接线以E07为准。',230);
   text([x+1500,3000],'原路径、导体与压降不变；本图不证明管槽容量、穿墙或三维障碍协调通过。',230);
  }
 }
}
