import crypto from 'node:crypto';
import {inspectEngineeringInput} from './engineering-contracts.mjs';
import {sceneSchema} from './contracts.mjs';
import {evaluateRoomPhotometry,roomPhotometricGrid} from './engineering-photometry.mjs';
import {selectEngineeringPlanSheet} from './engineering-sheets.mjs';

export const engineeringDigest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const polygonArea=ps=>Math.abs(ps.reduce((s,p,i)=>{const q=ps[(i+1)%ps.length];return s+p[0]*q[1]-q[0]*p[1];},0))/2;
export function insidePolygon(p,ps){let inside=false;for(let i=0,j=ps.length-1;i<ps.length;j=i++){const a=ps[i],b=ps[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
const round=n=>Math.round(n*1e6)/1e6;
const bounds=ps=>({min:[Math.min(...ps.map(p=>p[0])),Math.min(...ps.map(p=>p[1]))],max:[Math.max(...ps.map(p=>p[0])),Math.max(...ps.map(p=>p[1]))]});
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const rule=(p,room,key)=>p.requirements.find(r=>r.rule===key&&r.roomIds.includes(room.id));
const value=(p,room,key)=>rule(p,room,key).value;

function entryControlPosition(room,door,previous){
 for(let offset=250;offset<=2850;offset+=650)for(const delta of [[offset,250],[offset,-250],[-offset,250],[-offset,-250],[250,offset],[-250,offset],[250,-offset],[-250,-offset]]){
  const position=[door[0]+delta[0],door[1]+delta[1]];
  if(insidePolygon(position,room.polygon)&&!room.obstacles.some(o=>insidePolygon(position,o))&&previous.every(c=>distance(c.position,position)>=650))return position;
 }
 throw Error('CONTROL_LOCATION_UNRESOLVED: '+room.id);
}

// Diagram-only bus: it declares control membership, never an installation route.
export function controlDiagramSegments(model,control){
 const room=model.input.rooms.find(r=>r.id===control.roomId),group=model.controls.filter(c=>c.roomId===room.id).findIndex(c=>c.id===control.id),devices=model.devices.filter(d=>control.deviceIds.includes(d.id));
 const y=Math.min(...room.polygon.map(p=>p[1]))+150+group*200,xs=[control.position[0],...devices.map(d=>d.position[0])];
 return [[control.position,[control.position[0],y]],[[Math.min(...xs),y],[Math.max(...xs),y]],...devices.map(d=>[[d.position[0],y],d.position])];
}

function layoutRoom(p,room,photometricEvidence=[],lightingStandardEvidence){
 const areaM2=polygonArea(room.polygon)/1e6,b=bounds(room.polygon),width=b.max[0]-b.min[0],height=b.max[1]-b.min[1];
 if(areaM2<1||width<500||height<500)throw Error('ROOM_GEOMETRY_INVALID: '+room.id);
 const normative=lightingStandardEvidence?.rooms.find(r=>r.roomId===room.id),targetLux=Math.max(value(p,room,'target_lux'),normative?.minimumLux??0),maxLpd=Math.min(value(p,room,'max_lpd'),normative?.maximumLpd??Infinity),maxSpacingM=value(p,room,'max_spacing'),minimumUniformity=p.photometricDesign?Math.max(value(p,room,'min_uniformity'),normative?.minimumUniformity??0):undefined;
 const direct=!!p.photometricDesign,candidates=[];
 for(const fixture of p.luminaires){
  if(normative&&fixture.ra<normative.minimumRa)continue;
  if(fixture.allowedRoomUses&&!fixture.allowedRoomUses.includes(room.use))continue;
  const need=Math.ceil(targetLux*areaM2/(fixture.lumens*fixture.utilizationFactor*fixture.maintenanceFactor));
  const minX=Math.max(1,Math.ceil(width/1000/maxSpacingM)),minY=Math.max(1,Math.ceil(height/1000/maxSpacingM));
  const powerCount=Math.min(500,Math.floor(maxLpd*areaM2/fixture.watts)),maxX=Math.min(40,direct?Math.max(minX+8,Math.ceil(powerCount/minY)):minX+20),maxY=Math.min(40,direct?Math.max(minY+8,Math.ceil(powerCount/minX)):minY+20);
  for(let nx=minX;nx<=maxX;nx++)for(let ny=minY;ny<=maxY;ny++){
   if(!direct&&nx*ny<need||nx*ny>500)continue;
   let positions=[];for(let x=0;x<nx;x++)for(let y=0;y<ny;y++){const pos=[b.min[0]+width*(x+.5)/nx,b.min[1]+height*(y+.5)/ny];if(insidePolygon(pos,room.polygon)&&!room.obstacles.some(o=>insidePolygon(pos,o)))positions.push(pos.map(round));}
   const desired=Math.max(need,minX*minY);
   if(!direct&&positions.length>desired){const pool=[...positions],selected=[],center=[(b.min[0]+b.max[0])/2,(b.min[1]+b.max[1])/2];pool.sort((a,b)=>distance(a,center)-distance(b,center));selected.push(pool.shift());while(selected.length<desired&&pool.length){pool.sort((a,b)=>Math.min(...selected.map(p=>distance(b,p)))-Math.min(...selected.map(p=>distance(a,p))));selected.push(pool.shift());}positions=selected;}
   const layouts=[{positions,layoutSearch:'grid'}];
   // Odd counts can be feasible between an underlit full grid and an overpowered
   // next grid. Search bounded single removals, then recheck spacing and every point.
   if(direct&&positions.length>1&&positions.length<=Math.floor(maxLpd*areaM2/fixture.watts)+1){const samples=Math.min(32,positions.length);for(let i=0;i<samples;i++){const remove=Math.floor(i*(positions.length-1)/(samples-1));layouts.push({positions:positions.filter((_,index)=>index!==remove),layoutSearch:'single_removed_grid'});}}
   for(const layout of layouts){const ps=layout.positions;
    if([0,1].some(axis=>{const xs=[...new Set(ps.map(p=>p[axis]))].sort((a,b)=>a-b);return !xs.length||xs[0]-b.min[axis]>maxSpacingM*500+1e-4||b.max[axis]-xs.at(-1)>maxSpacingM*500+1e-4||xs.slice(1).some((x,i)=>x-xs[i]>maxSpacingM*1000+1e-4);}))continue;
    const count=ps.length,estimatedLux=count*fixture.lumens*fixture.utilizationFactor*fixture.maintenanceFactor/areaM2,lpd=count*fixture.watts/areaM2;
    if(!count||!direct&&(count<need||estimatedLux<targetLux-1e-8)||lpd>maxLpd+1e-8)continue;
    candidates.push({fixture:fixture.id,positions:ps,layoutSearch:layout.layoutSearch,count,areaM2:round(areaM2),targetLux,estimatedLux:round(estimatedLux),lpd:round(lpd),maxLpd,grid:[nx,ny],gridSpacingM:[round(width/nx/1000),round(height/ny/1000)],score:count*fixture.watts+(nx*ny-count)*.1+Math.abs(width/nx-height/ny)/100000});
    if(direct&&candidates.length>10000)throw Error('PHOTOMETRIC_CANDIDATE_LIMIT: '+room.id);
   }
  }
 }
 candidates.sort((a,b)=>a.score-b.score||a.fixture.localeCompare(b.fixture)||a.grid[0]-b.grid[0]);
 if(direct){const grid=roomPhotometricGrid(room,p.photometricDesign),feasible=[];let evaluations=0;for(const candidate of candidates){if((evaluations+=grid.length*candidate.count)>5000000){if(feasible.length)break;throw Error('PHOTOMETRIC_SEARCH_BUDGET: '+room.id);}const fixture=p.luminaires.find(f=>f.id===candidate.fixture),photometry=evaluateRoomPhotometry(room,candidate.positions,fixture,value(p,room,'mounting_height'),p.photometricDesign,photometricEvidence.find(e=>e.fixtureId===fixture.id),grid);if(photometry.averageLux+1e-8>=targetLux&&photometry.averageLux<=value(p,room,'max_avg_lux')+1e-8&&photometry.uniformity+1e-8>=minimumUniformity)feasible.push({...candidate,photometry});if(feasible.length>=4)break;}candidates.splice(0,candidates.length,...feasible);}
 if(!candidates.length)throw Error('NO_FEASIBLE_LIGHTING_LAYOUT: '+room.id+'; targets, geometry or catalogue conflict');
 return {...candidates[0],roomId:room.id,effectiveTargets:normative?{targetLux,maxLpd,minimumUniformity,profileSHA256:lightingStandardEvidence.profileSHA256,classId:normative.id,tableIds:normative.tableIds}:undefined,method:direct?'ies_direct_point':'lumen_flux_estimate',formula:direct?'E(point)=sum(I(C,gamma)*cos(gamma)/distance^2*MF); LPD=N*W/A':'E=N*Phi*UF*MF/A; LPD=N*W/A',requirementIds:p.requirements.filter(r=>r.roomIds.includes(room.id)).map(r=>r.id),alternatives:candidates.slice(1,4).map(({fixture,count,lpd,estimatedLux,photometry,layoutSearch})=>({fixture,count,lpd,estimatedLux,layoutSearch,directAverageLux:photometry?.averageLux,directUniformity:photometry?.uniformity}))};
}

export function makeEngineeringDesign(raw,{revision=0,standardEvidence=[],architecturalEvidence,photometricEvidence=[],lightingStandardEvidence}={}){
 const intake=inspectEngineeringInput(raw);if(!intake.ok)return {ok:false,stage:'requirements',issues:intake.issues};
 const p=intake.input;if(p.lightingStandards&&(!lightingStandardEvidence||lightingStandardEvidence.profileId!==p.lightingStandards.profileId||lightingStandardEvidence.profileSHA256!==p.lightingStandards.expectedProfileSHA256.toLowerCase()||lightingStandardEvidence.issues.some(i=>i.severity==='blocking')||lightingStandardEvidence.rooms.length!==p.rooms.length))throw Error('LIGHTING_STANDARD_EVIDENCE_REQUIRED');if(lightingStandardEvidence&&!p.lightingStandards)throw Error('LIGHTING_STANDARD_UNREQUESTED');
 const roomCalculations=p.rooms.map(r=>layoutRoom(p,r,photometricEvidence,lightingStandardEvidence)),fixtures=new Map(p.luminaires.map(f=>[f.id,f])),devices=[],circuits=[],controls=[],routes=[];
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
   controls.push({id:controlId,roomId:room.id,mode,position:entryControlPosition(room,door,controls.filter(c=>c.roomId===room.id)),deviceIds:selected.map(d=>d.id),circuitId:id,accessibleIdentification:true});routes.push({id:'R_'+id,circuitId:id,vertices:clean});
  }
  devices.push(...roomDevices);
 }
 devices.forEach((d,i)=>d.label='L'+String(i+1).padStart(2,'0'));controls.forEach((c,i)=>c.label='S'+String(i+1).padStart(2,'0'));
 const model={schemaVersion:1,engineVersion:'1.5.0',controlRouting:'schematic_bus',ok:true,projectId:p.projectId,title:p.title,revision,inputSHA256:engineeringDigest(p),designDate:p.designDate,input:p,standardEvidence,architecturalEvidence,photometricEvidence,lightingStandardEvidence,roomCalculations,devices,circuits,controls,routes,issues:intake.issues,decisions:roomCalculations.map(c=>({roomId:c.roomId,fixture:c.fixture,count:c.count,reason:p.photometricDesign?'Lowest installed watts in the bounded explicit grids satisfying maintained direct-point mean, uniformity and maximum mean; no reflected-light or UGR acceptance':'Lowest installed watts among feasible explicit grid candidates',requirementIds:c.requirementIds,formula:c.formula,alternatives:c.alternatives})),reviewStatus:'awaiting_human_review',professionalApproval:false};
 const drawing=makeEngineeringScene(model);return {...model,...drawing};
}

export function makeEngineeringScene(model){
 const p=model.input,entities=[],sheets=[],placements=[],geometryWarnings=[],layers=[['E-ARCH',8],['E-LIGHT',7],['E-WIRE',3],['E-CONTROL',6],['E-TEXT',7],['E-FRAME',7]].map(([name,color])=>({name,color}));
 const point=p=>[...p,0],line=(a,b,layer='E-FRAME')=>{if(distance(a,b)<1e-6){geometryWarnings.push({code:'DEGENERATE_SEGMENT_OMITTED',layer,position:a,reason:'Zero-length segment has no drawable extent'});return;}entities.push({kind:'line',layer,points:[point(a),point(b)]});};
 const text=(pos,t,h=250,layer='E-TEXT')=>entities.push({kind:'text',layer,position:point(pos),text:String(t).replace(/[\r\n]/g,' '),height:h,rotationRadians:0});
 const symbol=(name,geometry)=>({name,geometry,attributes:['DEVICE_ID','ROOM','CIRCUIT','CONTROL','MODEL','PHYSICAL_ID'].map((tag,i)=>({tag,position:[0,-300-i*200,0],height:160,visible:false,value:''}))});
 const symbols=[symbol('ENG_LED',[{kind:'polyline',layer:'0',points:[[-300,-120,0],[300,-120,0],[300,120,0],[-300,120,0]],closed:true},{kind:'line',layer:'0',points:[[-250,0,0],[250,0,0]]}]),symbol('ENG_LED_ROUND',[{kind:'circle',layer:'0',position:[0,0,0],radius:150}]),symbol('ENG_SWITCH',[{kind:'circle',layer:'0',position:[0,0,0],radius:100}]),symbol('ENG_PANEL',[{kind:'polyline',layer:'0',points:[[-250,-350,0],[250,-350,0],[250,350,0],[-250,350,0]],closed:true}])];
 const allPoints=[...p.rooms.flatMap(r=>r.polygon),...p.architecture.flatMap(a=>a.points),p.electrical.panelPosition,...model.controls.map(c=>c.position),...model.routes.flatMap(r=>r.vertices)],b=bounds(allPoints),plan=selectEngineeringPlanSheet(b.max[0]-b.min[0],b.max[1]-b.min[1]);let cursor=0;
 function sheet(id,title){const isPlan=['E02','E03'].includes(id),spec=isPlan?plan:{paper:'A3',denominator:100,width:39000,height:26000},d=spec.denominator,x=cursor,W=spec.width,H=spec.height,s={id,title,paper:spec.paper,paperDenominator:d,origin:[x,0],planOffset:isPlan?spec.planOffset:undefined,region:{min:[x,0,0],max:[x+W,H,0]},view:{name:id,center:[x+W/2,H/2,0],width:W,height:H}};cursor+=Math.max(45000,W+6000);sheets.push(s);for(const [a,b]of [[[5*d,5*d],[W-5*d,5*d]],[[W-5*d,5*d],[W-5*d,H-5*d]],[[W-5*d,H-5*d],[5*d,H-5*d]],[[5*d,H-5*d],[5*d,5*d]],[[5*d,H-25*d],[W-5*d,H-25*d]]])line([x+a[0],a[1]],[x+b[0],b[1]]);text([x+12*d,H-15*d],p.title+' - '+title,4.2*d);text([x+12*d,11*d],id+' | 修订 '+model.revision+' | '+p.designDate+' | 待人工审核，非签审施工文件',2.4*d);return s;}
 let notes=sheet('E01','设计说明及依据'),notePage=1,y=22200;const note=t=>{for(let i=0;i<t.length;){let end=Math.min(i+65,t.length);if(/[A-Za-z0-9_]/.test(t[end-1]??'')&&/[A-Za-z0-9_]/.test(t[end]??'')){const space=t.lastIndexOf(' ',end);if(space>i+20)end=space+1;else while(end<t.length&&/[A-Za-z0-9_]/.test(t[end]))end++;}if(y<3000){notes=sheet('E01-'+(++notePage),'设计说明及依据（续）');y=22200;}text([notes.origin[0]+1500,y],t.slice(i,end),280);y-=600;i=end;}};
 for(const t of ['设计范围：'+p.scope,p.photometricDesign?'设计方法：IES直射点源计算选择网格；维持照度Eavg、Emin/Eavg及上限约束。无反射光、日光或UGR验收。':'设计方法：房间功能与明确约束驱动的网格候选选择、利用系数法估算、回路和控制同源生成。',p.photometricDesign?'计算 E=sum(I*cos(gamma)/r^2*MF)；房间墙体按不透明竖直边界；点源远场适用性待复核。':'估算公式 E=N*Phi*UF*MF/A；LPD=N*W/A。无IES时不判定逐点照度、均匀度、UGR合格。',...(model.lightingStandardEvidence?.rooms??[]).map(r=>'标准类别 '+r.roomId+' = '+r.label+'；维持照度至少'+r.minimumLux+'lx，U0至少'+r.minimumUniformity+'；工作面'+r.workplaneM+'m；现行LPD基准上限'+r.maximumLpd+'W/m2；UGR待审'),...p.luminaires.map(f=>'灯具 '+f.id+' = '+f.label+'；'+f.watts+'W / '+f.lumens+'lm；MF='+f.maintenanceFactor+'；候选用途 '+(f.allowedRoomUses?.join('/')??'按项目条件')),'配电：L、N、PE分开；终端短路、过负荷及接地故障保护按设计模型。保护配合与敷设修正待专项复核。','照明连线表示回路归属；吊顶、梁、风口、现场敷设及开关线数量需深化协调。',...p.standards.map(s=>'依据：'+s.code+' '+s.edition+'；生效 '+s.effectiveFrom+'；本机证据条款 '+model.standardEvidence.filter(c=>c.standardId===s.id).map(c=>c.locator).join('/')),'输入：'+(p.sources.some(s=>s.derivedFromFinalDrawing)?'历史成图剥离建筑条件；回溯复现测试，不是独立新项目验收。':'项目提供建筑条件。'),'主要待审：'+[...new Set(model.issues.filter(i=>i.severity==='review').map(i=>i.code))].join('、')])note(t);
 const scale=1,map=(s,v)=>[s.origin[0]+s.planOffset[0]+v[0]-b.min[0],s.planOffset[1]+v[1]-b.min[1]];
 for(const [id,title,control]of [['E02','普通照明平面',false],['E03','开关控制及回路归属',true]]){
  const s=sheet(id,title);
  for(const a of p.architecture){const ps=a.points.map(v=>map(s,v));for(let i=1;i<ps.length;i++)line(ps[i-1],ps[i],'E-ARCH');if(a.closed)line(ps.at(-1),ps[0],'E-ARCH');}
  for(const room of p.rooms){text(map(s,[Math.min(...room.polygon.map(v=>v[0]))+150,Math.max(...room.polygon.map(p=>p[1]))-300]),room.name+' ['+room.id+']',2.8*s.paperDenominator);}
  for(const d of model.devices){const pos=map(s,d.position),representationId=d.id+(control?'_CTL':'');placements.push({symbol:p.luminaires.find(f=>f.id===d.fixture).schematicSymbol==='downlight'?'ENG_LED_ROUND':'ENG_LED',id:representationId,position:point(pos),layer:'E-LIGHT',attributes:{DEVICE_ID:representationId,ROOM:d.roomId,CIRCUIT:d.circuitId,CONTROL:d.controlId,MODEL:d.fixture,PHYSICAL_ID:d.id}});const h=2.2*s.paperDenominator; text([pos[0]+(control?2*s.paperDenominator:-d.label.length*h*.3),pos[1]+(control?3:-5)*s.paperDenominator],d.label,h);}
  if(control)for(const c of model.controls){const sw=map(s,c.position);placements.push({symbol:'ENG_SWITCH',id:c.id,position:point(sw),layer:'E-CONTROL',attributes:{DEVICE_ID:c.id,ROOM:c.roomId,CIRCUIT:c.circuitId,CONTROL:c.mode,MODEL:'SWITCH',PHYSICAL_ID:c.id}});if(model.controlRouting==='schematic_bus'){for(const [a,b] of controlDiagramSegments(model,c))line(map(s,a),map(s,b),'E-CONTROL');text([sw[0]-c.label.length*s.paperDenominator*.6,sw[1]-4*s.paperDenominator],c.label,2*s.paperDenominator);}else for(const d of model.devices.filter(d=>c.deviceIds.includes(d.id)))line(sw,map(s,d.position),'E-CONTROL');}
  else{for(const r of model.routes)for(let i=1;i<r.vertices.length;i++)line(map(s,r.vertices[i-1]),map(s,r.vertices[i]),'E-WIRE');placements.push({symbol:'ENG_PANEL',id:p.electrical.panelId,position:point(map(s,p.electrical.panelPosition)),layer:'E-WIRE',attributes:{DEVICE_ID:p.electrical.panelId,ROOM:'SUPPLY',CIRCUIT:'INCOMING',CONTROL:'MANUAL',MODEL:'PANEL',PHYSICAL_ID:p.electrical.panelId}});}
  text([s.origin[0]+18*s.paperDenominator,32*s.paperDenominator],'显示系数 '+scale.toFixed(5)+'；图框输出1:'+s.paperDenominator+'；回路为归属示意，敷设/吊顶待核对。',2.6*s.paperDenominator);
 }
 for(let offset=0;offset<model.circuits.length;offset+=27){const system=sheet(offset?'E04-'+(offset/27+1):'E04','照明配电系统及回路表');text([system.origin[0]+1800,22000],p.electrical.panelId+'  '+p.electrical.voltage+'V | 支路L+N+PE | 总负荷 '+model.circuits.reduce((s,c)=>s+c.watts,0)+'W',300);line([system.origin[0]+2200,21200],[system.origin[0]+2200,3000],'E-WIRE');
 model.circuits.slice(offset,offset+27).forEach((c,i)=>{const yy=20100-i*600;line([system.origin[0]+2200,yy],[system.origin[0]+5000,yy],'E-WIRE');text([system.origin[0]+5500,yy],`${c.id}  ${c.watts}W  Ib=${c.currentA.toFixed(2)}A  ${c.breakerA}A  Cu ${c.wireSectionMm2}mm2  L+N+PE`,230);});}
 for(let offset=0;offset<model.roomCalculations.length;offset+=24){const calc=sheet(offset?'E05-'+(offset/24+1):'E05','计算及灯具清单');text([calc.origin[0]+1500,22200],'房间 | 灯具数 | 维持平均lx/目标lx | W/m2 | 灯具型号',280);
 model.roomCalculations.slice(offset,offset+24).forEach((c,i)=>text([calc.origin[0]+1500,21200-i*700],`${p.rooms.find(r=>r.id===c.roomId).name} [${c.roomId}] | ${c.count} | ${(c.photometry?.averageLux??c.estimatedLux).toFixed(1)}/${c.targetLux} | ${c.lpd.toFixed(2)} | ${c.fixture}`,260));
 text([calc.origin[0]+1500,3500],p.photometricDesign?'本表为IES直射点源维持照度；详细Emin/Eavg见计算CSV；反射、眩光和实际条件待审。':'本表照度为利用系数法估算；光度、眩光和实际保护条件仍需专业复核。',270);}
 const {name:initialViewName,...initialView}=sheets.find(s=>s.id==='E02').view;
 const scene=sceneSchema.parse({layers,symbols,entities,views:sheets.map(s=>s.view),view:initialView});
 return {scene,placements,sheets,geometryWarnings,drawingOrigin:b.min,drawingScale:scale,representations:{luminairePlan:'E02',controlPlan:'E03'}};
}
