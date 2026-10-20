import crypto from 'node:crypto';
import {inspectEngineeringInput} from './engineering-contracts.mjs';
import {sceneSchema} from './contracts.mjs';

export const engineeringDigest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const polygonArea=ps=>Math.abs(ps.reduce((s,p,i)=>{const q=ps[(i+1)%ps.length];return s+p[0]*q[1]-q[0]*p[1];},0))/2;
export function insidePolygon(p,ps){let inside=false;for(let i=0,j=ps.length-1;i<ps.length;j=i++){const a=ps[i],b=ps[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
const round=n=>Math.round(n*1e6)/1e6;
const bounds=ps=>({min:[Math.min(...ps.map(p=>p[0])),Math.min(...ps.map(p=>p[1]))],max:[Math.max(...ps.map(p=>p[0])),Math.max(...ps.map(p=>p[1]))]});
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const rule=(p,room,key)=>p.requirements.find(r=>r.rule===key&&r.roomIds.includes(room.id));
const value=(p,room,key)=>rule(p,room,key).value;

function layoutRoom(p,room){
 const areaM2=polygonArea(room.polygon)/1e6,b=bounds(room.polygon),width=b.max[0]-b.min[0],height=b.max[1]-b.min[1];
 if(areaM2<1||width<500||height<500)throw Error('ROOM_GEOMETRY_INVALID: '+room.id);
 const targetLux=value(p,room,'target_lux'),maxLpd=value(p,room,'max_lpd'),maxSpacingM=value(p,room,'max_spacing');
 const candidates=[];
 for(const fixture of p.luminaires){
  const need=Math.ceil(targetLux*areaM2/(fixture.lumens*fixture.utilizationFactor*fixture.maintenanceFactor));
  const minX=Math.max(1,Math.ceil(width/1000/maxSpacingM)),minY=Math.max(1,Math.ceil(height/1000/maxSpacingM));
  for(let nx=minX;nx<=Math.min(40,minX+20);nx++)for(let ny=minY;ny<=Math.min(40,minY+20);ny++){
   if(nx*ny<need||nx*ny>500)continue;
   let positions=[];for(let x=0;x<nx;x++)for(let y=0;y<ny;y++){const pos=[b.min[0]+width*(x+.5)/nx,b.min[1]+height*(y+.5)/ny];if(insidePolygon(pos,room.polygon)&&!room.obstacles.some(o=>insidePolygon(pos,o)))positions.push(pos.map(round));}
   const desired=Math.max(need,minX*minY);
   if(positions.length>desired){const pool=[...positions],selected=[],center=[(b.min[0]+b.max[0])/2,(b.min[1]+b.max[1])/2];pool.sort((a,b)=>distance(a,center)-distance(b,center));selected.push(pool.shift());while(selected.length<desired&&pool.length){pool.sort((a,b)=>Math.min(...selected.map(p=>distance(b,p)))-Math.min(...selected.map(p=>distance(a,p))));selected.push(pool.shift());}positions=selected;}
   if([0,1].some(axis=>{const xs=[...new Set(positions.map(p=>p[axis]))].sort((a,b)=>a-b);return !xs.length||xs[0]-b.min[axis]>maxSpacingM*500+1e-4||b.max[axis]-xs.at(-1)>maxSpacingM*500+1e-4||xs.slice(1).some((x,i)=>x-xs[i]>maxSpacingM*1000+1e-4);}))continue;
   const count=positions.length,estimatedLux=count*fixture.lumens*fixture.utilizationFactor*fixture.maintenanceFactor/areaM2,lpd=count*fixture.watts/areaM2;
   if(count<need||estimatedLux<targetLux-1e-8||lpd>maxLpd+1e-8)continue;
   candidates.push({fixture:fixture.id,positions,count,areaM2:round(areaM2),targetLux,estimatedLux:round(estimatedLux),lpd:round(lpd),maxLpd,grid:[nx,ny],gridSpacingM:[round(width/nx/1000),round(height/ny/1000)],score:count*fixture.watts+(nx*ny-count)*.1+Math.abs(width/nx-height/ny)/100000});
  }
 }
 candidates.sort((a,b)=>a.score-b.score||a.fixture.localeCompare(b.fixture)||a.grid[0]-b.grid[0]);
 if(!candidates.length)throw Error('NO_FEASIBLE_LIGHTING_LAYOUT: '+room.id+'; targets, geometry or catalogue conflict');
 return {...candidates[0],roomId:room.id,method:'lumen_flux_estimate',formula:'E=N*Phi*UF*MF/A; LPD=N*W/A',requirementIds:p.requirements.filter(r=>r.roomIds.includes(room.id)).map(r=>r.id),alternatives:candidates.slice(1,4).map(({fixture,count,lpd,estimatedLux})=>({fixture,count,lpd,estimatedLux}))};
}

export function makeEngineeringDesign(raw,{revision=0,standardEvidence=[]}={}){
 const intake=inspectEngineeringInput(raw);if(!intake.ok)return {ok:false,stage:'requirements',issues:intake.issues};
 const p=intake.input,roomCalculations=p.rooms.map(r=>layoutRoom(p,r)),fixtures=new Map(p.luminaires.map(f=>[f.id,f])),devices=[],circuits=[],controls=[],routes=[];
 for(const room of p.rooms){
  const calc=roomCalculations.find(c=>c.roomId===room.id),f=fixtures.get(calc.fixture),maxDevices=Math.floor(value(p,room,'max_devices')),maxWatts=value(p,room,'max_circuit_watts'),chunk=Math.min(maxDevices,Math.floor(maxWatts/f.watts));
  if(chunk<1)throw Error('CIRCUIT_CAPACITY_INFEASIBLE: '+room.id);
  const door=room.doors[0];if(!door)throw Error('ROOM_ENTRANCE_MISSING: '+room.id);
  const roomDevices=calc.positions.map((position,i)=>({id:'L_'+room.id+'_'+String(i+1).padStart(3,'0'),roomId:room.id,fixture:f.id,position,watts:f.watts,mountingHeightM:value(p,room,'mounting_height'),circuitId:null,controlId:null}));
  for(let start=0;start<roomDevices.length;start+=chunk){
   const selected=roomDevices.slice(start,start+chunk),id='C_'+room.id+'_'+(Math.floor(start/chunk)+1),controlId='S_'+room.id+'_'+(Math.floor(start/chunk)+1),mode=value(p,room,'control_mode');
   const sorted=[...selected].sort((a,b)=>distance(a.position,door)-distance(b.position,door));
   const vertices=[p.electrical.panelPosition,[door[0],p.electrical.panelPosition[1]],door];let last=door;
   for(const d of sorted){vertices.push([d.position[0],last[1]],d.position);last=d.position;}
   const clean=vertices.filter((v,i)=>!i||distance(v,vertices[i-1])>1e-6).map(v=>v.map(round));
   const routeM=clean.slice(1).reduce((n,v,i)=>n+distance(v,clean[i]),0)/1000,estimatedLengthM=routeM+p.electrical.extraLengthM,watts=selected.length*f.watts,currentA=watts/(p.electrical.voltage*p.electrical.powerFactor),dropPercent=2*p.electrical.copperOhmMm2PerM*estimatedLengthM*currentA/p.electrical.wireSectionMm2/p.electrical.voltage*100;
   for(const d of selected){d.circuitId=id;d.controlId=controlId;}
   circuits.push({id,roomId:room.id,panelId:p.electrical.panelId,deviceIds:selected.map(d=>d.id),watts,currentA:round(currentA),routeLengthM:round(routeM),estimatedLengthM:round(estimatedLengthM),dropPercent:round(dropPercent),maxDropPercent:value(p,room,'max_drop'),maxDevices,maxWatts,breakerA:p.electrical.breakerA,assumedIzA:p.electrical.assumedIzA,wireSectionMm2:p.electrical.wireSectionMm2,conductors:'L+N+PE',shortCircuitProtection:p.electrical.shortCircuitProtection,overloadProtection:p.electrical.overloadProtection,earthFaultProtection:p.electrical.earthFaultProtection,rcd:p.electrical.rcd,scope:'Circuit affiliation and conservative drawn path; installation routing/protective coordination require review'});
   controls.push({id:controlId,roomId:room.id,mode,position:[door[0]+250,door[1]+250],deviceIds:selected.map(d=>d.id),circuitId:id,accessibleIdentification:true});routes.push({id:'R_'+id,circuitId:id,vertices:clean});
  }
  devices.push(...roomDevices);
 }
 devices.forEach((d,i)=>d.label='L'+String(i+1).padStart(2,'0'));controls.forEach((c,i)=>c.label='S'+String(i+1).padStart(2,'0'));
 const model={schemaVersion:1,engineVersion:'1.0.0',ok:true,projectId:p.projectId,title:p.title,revision,inputSHA256:engineeringDigest(p),designDate:p.designDate,input:p,standardEvidence,roomCalculations,devices,circuits,controls,routes,issues:intake.issues,decisions:roomCalculations.map(c=>({roomId:c.roomId,fixture:c.fixture,count:c.count,reason:'Lowest installed watts among feasible explicit grid candidates',requirementIds:c.requirementIds,formula:c.formula,alternatives:c.alternatives})),reviewStatus:'awaiting_human_review',professionalApproval:false};
 const drawing=makeEngineeringScene(model);return {...model,...drawing};
}

export function makeEngineeringScene(model){
 const p=model.input,entities=[],sheets=[],placements=[],geometryWarnings=[],layers=[['E-ARCH',8],['E-LIGHT',2],['E-WIRE',3],['E-CONTROL',6],['E-TEXT',7],['E-FRAME',7]].map(([name,color])=>({name,color}));
 const point=p=>[...p,0],line=(a,b,layer='E-FRAME')=>{if(distance(a,b)<1e-6){geometryWarnings.push({code:'DEGENERATE_SEGMENT_OMITTED',layer,position:a,reason:'Zero-length segment has no drawable extent'});return;}entities.push({kind:'line',layer,points:[point(a),point(b)]});};
 const text=(pos,t,h=250,layer='E-TEXT')=>entities.push({kind:'text',layer,position:point(pos),text:String(t).replace(/[\r\n]/g,' '),height:h,rotationRadians:0});
 const symbol=(name,geometry)=>({name,geometry,attributes:['DEVICE_ID','ROOM','CIRCUIT','CONTROL','MODEL','PHYSICAL_ID'].map((tag,i)=>({tag,position:[0,-300-i*200,0],height:160,visible:false,value:''}))});
 const symbols=[symbol('ENG_LED',[{kind:'polyline',layer:'0',points:[[-300,-120,0],[300,-120,0],[300,120,0],[-300,120,0]],closed:true},{kind:'line',layer:'0',points:[[-250,0,0],[250,0,0]]}]),symbol('ENG_SWITCH',[{kind:'circle',layer:'0',position:[0,0,0],radius:100}]),symbol('ENG_PANEL',[{kind:'polyline',layer:'0',points:[[-250,-350,0],[250,-350,0],[250,350,0],[-250,350,0]],closed:true}])];
 function sheet(id,title){const x=sheets.length*45000,factor=['E02','E03'].includes(id)?.5:1,s={id,title,paperDenominator:factor*100,origin:[x,0],region:{min:[x,0,0],max:[x+39000*factor,26000*factor,0]},view:{name:id,center:[x+19500*factor,13000*factor,0],width:39000*factor,height:26000*factor}};sheets.push(s);for(const [a,b]of [[[500,500],[38500,500]],[[38500,500],[38500,25500]],[[38500,25500],[500,25500]],[[500,25500],[500,500]],[[500,23500],[38500,23500]]])line([x+a[0]*factor,a[1]*factor],[x+b[0]*factor,b[1]*factor]);text([x+1200*factor,24500*factor],p.title+' - '+title,420*factor);text([x+1200*factor,1100*factor],id+' | 修订 '+model.revision+' | '+p.designDate+' | 待人工审核，非签审施工文件',240*factor);return s;}
 let notes=sheet('E01','设计说明及依据'),notePage=1,y=22200;const note=t=>{for(let i=0;i<t.length;i+=65){if(y<3000){notes=sheet('E01-'+(++notePage),'设计说明及依据（续）');y=22200;}text([notes.origin[0]+1500,y],t.slice(i,i+65),280);y-=600;}};
 for(const t of ['设计范围：'+p.scope,'设计方法：房间功能与明确约束驱动的网格候选选择、利用系数法估算、回路和控制同源生成。','估算公式 E=N*Phi*UF*MF/A；LPD=N*W/A。无IES时不判定逐点照度、均匀度、UGR合格。','配电：L、N、PE分开；终端短路、过负荷及接地故障保护按设计模型。保护配合与敷设修正待专项复核。','照明连线表示回路归属；吊顶、梁、风口、现场敷设及开关线数量需深化协调。',...p.standards.map(s=>'依据：'+s.code+' '+s.edition+'；生效 '+s.effectiveFrom+'；本机证据条款 '+model.standardEvidence.filter(c=>c.standardId===s.id).map(c=>c.locator).join('/')),'输入：'+(p.sources.some(s=>s.derivedFromFinalDrawing)?'历史成图剥离建筑条件；回溯复现测试，不是独立新项目验收。':'项目提供建筑条件。'),'主要待审：'+[...new Set(model.issues.filter(i=>i.severity==='review').map(i=>i.code))].join('、')])note(t);
 const allPoints=[...p.rooms.flatMap(r=>r.polygon),...p.architecture.flatMap(a=>a.points)],b=bounds(allPoints),w=b.max[0]-b.min[0],h=b.max[1]-b.min[1],scale=Math.min(1,16500/w,8000/h),map=(s,v)=>[s.origin[0]+1500+(v[0]-b.min[0])*scale,2800+(v[1]-b.min[1])*scale];
 if(scale<1)throw Error('PLAN_PAGINATION_REQUIRED: architecture exceeds the current full-size plan window; split the scope instead of shrinking model geometry');
 for(const [id,title,control]of [['E02','普通照明平面',false],['E03','开关控制及回路归属',true]]){
  const s=sheet(id,title);
  for(const a of p.architecture){const ps=a.points.map(v=>map(s,v));for(let i=1;i<ps.length;i++)line(ps[i-1],ps[i],'E-ARCH');if(a.closed)line(ps.at(-1),ps[0],'E-ARCH');}
  for(const room of p.rooms){text(map(s,[Math.min(...room.polygon.map(v=>v[0]))+150,Math.max(...room.polygon.map(p=>p[1]))-300]),room.name,140);}
  for(const d of model.devices){const pos=map(s,d.position),representationId=d.id+(control?'_CTL':'');placements.push({symbol:'ENG_LED',id:representationId,position:point(pos),layer:'E-LIGHT',attributes:{DEVICE_ID:representationId,ROOM:d.roomId,CIRCUIT:d.circuitId,CONTROL:d.controlId,MODEL:d.fixture,PHYSICAL_ID:d.id}});text([pos[0]+100,pos[1]-300],d.label,110);}
  if(control)for(const c of model.controls){const sw=map(s,c.position);placements.push({symbol:'ENG_SWITCH',id:c.id,position:point(sw),layer:'E-CONTROL',attributes:{DEVICE_ID:c.id,ROOM:c.roomId,CIRCUIT:c.circuitId,CONTROL:c.mode,MODEL:'SWITCH',PHYSICAL_ID:c.id}});for(const d of model.devices.filter(d=>c.deviceIds.includes(d.id)))line(sw,map(s,d.position),'E-CONTROL');}
  else{for(const r of model.routes)for(let i=1;i<r.vertices.length;i++)line(map(s,r.vertices[i-1]),map(s,r.vertices[i]),'E-WIRE');placements.push({symbol:'ENG_PANEL',id:p.electrical.panelId,position:point(map(s,p.electrical.panelPosition)),layer:'E-WIRE',attributes:{DEVICE_ID:p.electrical.panelId,ROOM:'SUPPLY',CIRCUIT:'INCOMING',CONTROL:'MANUAL',MODEL:'PANEL',PHYSICAL_ID:p.electrical.panelId}});}
  text([s.origin[0]+900,1600],'显示系数 '+scale.toFixed(5)+'；图框输出1:'+s.paperDenominator+'；回路为归属示意，敷设/吊顶待核对。',130);
 }
 for(let offset=0;offset<model.circuits.length;offset+=27){const system=sheet(offset?'E04-'+(offset/27+1):'E04','照明配电系统及回路表');text([system.origin[0]+1800,22000],p.electrical.panelId+'  '+p.electrical.voltage+'V | 支路L+N+PE | 总负荷 '+model.circuits.reduce((s,c)=>s+c.watts,0)+'W',300);line([system.origin[0]+2200,21200],[system.origin[0]+2200,3000],'E-WIRE');
 model.circuits.slice(offset,offset+27).forEach((c,i)=>{const yy=20100-i*600;line([system.origin[0]+2200,yy],[system.origin[0]+5000,yy],'E-WIRE');text([system.origin[0]+5500,yy],`${c.id}  ${c.watts}W  Ib=${c.currentA.toFixed(2)}A  ${c.breakerA}A  Cu ${c.wireSectionMm2}mm2  L+N+PE`,230);});}
 for(let offset=0;offset<model.roomCalculations.length;offset+=24){const calc=sheet(offset?'E05-'+(offset/24+1):'E05','计算及灯具清单');text([calc.origin[0]+1500,22200],'房间 | 灯具数 | 估算lx/目标lx | W/m2 | 灯具型号',280);
 model.roomCalculations.slice(offset,offset+24).forEach((c,i)=>text([calc.origin[0]+1500,21200-i*700],`${p.rooms.find(r=>r.id===c.roomId).name} | ${c.count} | ${c.estimatedLux.toFixed(1)}/${c.targetLux} | ${c.lpd.toFixed(2)} | ${c.fixture}`,260));
 text([calc.origin[0]+1500,3500],'本表照度为利用系数法估算；光度、眩光和实际保护条件仍需专业复核。',270);}
 const {name:initialViewName,...initialView}=sheets.find(s=>s.id==='E02').view;
 const scene=sceneSchema.parse({layers,symbols,entities,views:sheets.map(s=>s.view),view:initialView});
 return {scene,placements,sheets,geometryWarnings,drawingScale:scale,representations:{luminairePlan:'E02',controlPlan:'E03'}};
}
