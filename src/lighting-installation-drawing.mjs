// Circuit-local terminal labels are intentionally separate from CAD handles.
// E02/E03 retain their original affiliation diagrams; E07 is the explicit
// installation connection schedule and logic diagram, with 3D run coordinates.
export function drawLightingInstallation(model,{sheet,text,line}){
 if(!model.installation)return;
 for(const [ci,c]of model.installation.circuits.entries()){
  const nodes=new Map(c.nodes.map(n=>[n.id,n])),label='Q'+String(ci+1).padStart(2,'0'),pageSize=13;
  for(let offset=0;offset<c.runs.length;offset+=pageSize){
   const page=offset/pageSize+1,s=sheet('E07-'+label+'-'+page,'接线与安装路径 '+label+' / '+page),x=s.origin[0],t=(y,value,h=230)=>text([x+1500,y],value,h),ln=(a,b)=>line([x+a[0],a[1]],[x+b[0],b[1]],'E-WIRE');
   t(22200,label+' = '+c.circuitId+' | 房间 '+c.roomId+' | 开关 '+c.controlId+' | 各回路独立极、独立N/PE');
   // Switch symbol opens only the phase; N and PE have continuous rails.
   ln([2500,20800],[12500,20800]);ln([12500,20800],[14500,21400]);ln([15000,20800],[33000,20800]);
   ln([2500,19700],[33000,19700]);ln([2500,18600],[33000,18600]);
   text([x+1800,20900],'L',200);text([x+1800,19800],'N',200);text([x+1700,18700],'PE',200);text([x+15100,21000],'SL',200);
   text([x+11500,21800],'S: LINE / LOAD',210);text([x+29000,21800],'各灯并联 L / N / PE',210);
   t(17400,'逻辑示意非比例图；PE另接开关接地端。实际端子与三维路径见下表，交叉点不代表连接。',220);
   t(16600,'路径 | 起点(x,y,z mm) -> 终点(x,y,z mm) | 长度m / 导体截面mm2',230);
   const xyz=n=>n.position.map(v=>Number(v.toFixed(3))).join(',');
   c.runs.slice(offset,offset+pageSize).forEach((r,i)=>{
    const y=15700-i*850,a=nodes.get(r.from),b=nodes.get(r.to);
    t(y,`${r.id} | ${r.from}(${xyz(a)}) -> ${r.to}(${xyz(b)}) | ${r.lengthM.toFixed(3)}m / ${r.wireSectionMm2}mm2`,220);
    t(y-350,r.conductors.map(w=>`${w.role}: ${r.from}.${w.fromTerminal} -> ${r.to}.${w.toTerminal}`).join(' ; ')+(b.physicalId?' | '+b.physicalId:''),210);
   });
   t(4100,'计算电流 '+c.currentA.toFixed(3)+'A；开关声明 '+c.switch.ratingA+'A / '+c.switch.ratedVoltage+'V；最大支路压降 '+c.maximumDropPercent.toFixed(4)+'%。',220);
   t(3500,'导体实路径(m)：'+Object.entries(c.conductorLengthsM).map(([k,v])=>k+'='+v.toFixed(3)).join(' / ')+'；原未定位附加量 '+c.unlocatedAllowanceM+'m 单列。',210);
   t(2900,'位置/标高为声明条件；LED冲击电流、底盒极数/容量、管槽、穿墙及保护配合待审；非施工批准。',220);
  }
 }
}
export function installationRows(model){
 return [['circuit','room','run','from','to','startXmm','startYmm','startZmm','endXmm','endYmm','endZmm','lengthM','sectionMm2','conductors','verticesMm','sourceIds','authority'],...model.installation.circuits.flatMap(c=>c.runs.map(r=>[c.circuitId,c.roomId,r.id,r.from,r.to,...r.vertices[0],...r.vertices.at(-1),r.lengthM,r.wireSectionMm2,r.conductors.map(w=>w.role+':'+r.from+'.'+w.fromTerminal+'->'+r.to+'.'+w.toTerminal).join(';'),JSON.stringify(r.vertices),c.sourceIds.join(';'),model.installation.authority]))];
}
export function installationHtml(model,escape){
 if(!model.installation)return '';
 const s=model.installation;
 return '<h2>安装接线与竖向路径</h2><p>各回路独立单极控制；显式端子图核对关断相线、N/PE连续和逐灯支路压降。E07及安装CSV含端点标高、导体功能与路径。E02/E03、E06仍是原回路示意/平面估量，不能与本表相加采购。</p><table><tr><th>回路</th><th>安装路径m</th><th>L / SL / N / PE m</th><th>最大支路压降%</th><th>声明开关A/V</th></tr>'+s.circuits.map(c=>'<tr>'+[c.circuitId,c.physicalPathLengthM.toFixed(3),Object.values(c.conductorLengthsM).map(v=>v.toFixed(3)).join(' / '),c.maximumDropPercent.toFixed(4),c.switch.ratingA+' / '+c.switch.ratedVoltage].map(v=>'<td>'+escape(v)+'</td>').join('')+'</tr>').join('')+'</table><p>来源等级：'+escape(s.authority)+'。LED负载冲击电流、底盒/多联容量、管槽选型、穿墙、敷设修正与保护配合待专业复核；未定位附加估量另列，不能作为核定采购量。</p>';
}
