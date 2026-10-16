import {z} from 'zod';
import {sceneSchema} from './contracts.mjs';
const positive=z.number().finite().positive().max(1e6);
const ratio=z.number().min(0.01).max(1);
export const schoolRequirementsSchema=z.strictObject({
 schemaVersion:z.literal(1),projectId:z.string().regex(/^[A-Z0-9-]{1,40}$/),name:z.string().min(1).max(60),designDate:z.iso.date(),designStage:z.string().max(60),
 floors:z.number().int().min(1).max(3),classroomsPerFloor:z.number().int().min(1).max(4),studentsPerClassroom:z.number().int().min(1).max(40),
 floorHeightMm:z.number().min(3600).max(4500),classroomWidthMm:z.number().min(8500).max(9500),classroomDepthMm:z.number().min(7500).max(8500),corridorWidthMm:z.number().min(3600).max(4200),wallThicknessMm:z.number().min(150).max(250),
 lighting:z.strictObject({targetLux:positive,boardTargetLux:positive,luminaireWatts:positive,luminaireLumens:positive,utilizationFactor:ratio,maintenanceFactor:ratio,boardWatts:positive,boardLumens:positive,boardUtilizationFactor:ratio,powerBudgetWm2:positive}),
 electrical:z.strictObject({lineVoltage:z.literal(380),phaseVoltage:z.literal(220),powerFactor:ratio,copperRhoOhmMm2M:positive,socketDemandFactor:ratio,socketRcdMa:z.number().positive().max(30),mainBreakerA:positive,mainCableMm2:positive,mainAssumedIzA:positive,mainLengthM:positive,floorBreakerA:positive,floorCableMm2:positive,floorAssumedIzA:positive,lightingBreakerA:positive,lightingCableMm2:positive,socketBreakerA:positive,socketCableMm2:positive,branchAssumedIzA:positive,maxVoltageDropPercent:z.number().positive().max(5)}),
 emergency:z.strictObject({voltageDc:z.literal(36),durationMinutes:z.number().min(90).max(180),supplyRatedWattsPerFloor:positive,batteryUsableFactor:ratio,lightWatts:positive,signWatts:positive,corridorMinLux:z.number().min(3),stairMinLux:z.number().min(10)}),
 assumptions:z.array(z.string().min(1).max(1000)).min(1).max(30)
});
const round=(n,d=3)=>Number(n.toFixed(d));
export function makeSchoolDesign(input){
 const r=schoolRequirementsSchema.parse(input),e=r.electrical,l=r.lighting,em=r.emergency;
 const W=15000+r.classroomsPerFloor*r.classroomWidthMm,D=r.classroomDepthMm,H=D+r.corridorWidthMm,A=(r.classroomWidthMm-r.wallThicknessMm)*(D-r.wallThicknessMm)/1e6;
 const entities=[],devices=[],routes=[],circuits=[],sheets=[],groups=new Map();
 const layers=[['A-WALL',8],['A-DOOR',8],['A-FURN',9],['A-TEXT',8],['E-LIGHT',2],['E-WIRE',3],['E-CTRL',6],['E-FIRE',1],['E-DATA',4],['E-EARTH',3],['S-TEXT',7],['S-FRAME',7]].map(([name,color])=>({name,color}));
 const p=(x,y)=>[round(x,6),round(y,6),0];
 const poly=(points,layer='S-FRAME',closed=false)=>({kind:'polyline',layer,points:points.map(a=>p(...a)),closed});
 const line=(x,y,X,Y,layer)=>poly([[x,y],[X,Y]],layer);
 const rect=(x,y,w,h,layer)=>poly([[x,y],[x+w,y],[x+w,y+h],[x,y+h]],layer,true);
 const text=(x,y,t,height=260,layer='S-TEXT')=>({kind:'text',layer,position:p(x,y),height,text:String(t),rotationRadians:0});
 const circle=(x,y,radius,layer)=>({kind:'circle',layer,position:p(x,y),radius});
 const symbol=(name,geometry)=>({name,geometry,attributes:[['DEVICE_ID',true,[350,250,0],250],['MODEL',false,[0,0,0],100],['CIRCUIT',false,[0,0,0],100],['ROOM',false,[0,0,0],100],['ROLE',false,[0,0,0],100]].map(([tag,visible,position,height])=>({tag,visible,position,height,value:''}))});
 const symbols=[
  symbol('SCH_LIGHT',[rect(-600,-90,1200,180,'0'),line(-500,0,500,0,'0')]),
  symbol('SCH_BOARD',[rect(-70,-500,140,1000,'0'),line(-150,-400,-150,400,'0')]),
  symbol('SCH_CEILING',[circle(0,0,160,'0'),line(-110,-110,110,110,'0'),line(-110,110,110,-110,'0')]),
  symbol('SCH_SOCKET',[circle(0,0,130,'0'),line(-70,-50,-70,90,'0'),line(70,-50,70,90,'0'),line(-100,-50,100,-50,'0')]),
  symbol('SCH_SWITCH',[circle(0,0,100,'0'),line(70,70,220,220,'0'),text(230,80,'4',160,'0')]),
  symbol('SCH_PANEL',[rect(-250,-150,500,300,'0'),line(-250,-150,250,150,'0')]),
  symbol('SCH_EM',[rect(-180,-120,360,240,'0'),text(-100,-60,'E',160,'0')]),
  symbol('SCH_EXIT',[rect(-230,-100,460,200,'0'),text(-190,-65,'EXIT',140,'0')]),
  symbol('SCH_LEFT',[line(220,0,-220,0,'0'),poly([[-80,100],[-220,0],[-80,-100]],'0')]),
  symbol('SCH_RIGHT',[line(-220,0,220,0,'0'),poly([[80,100],[220,0],[80,-100]],'0')]),
  symbol('SCH_SMOKE',[circle(0,0,160,'0'),text(-60,-60,'S',160,'0')]),
  symbol('SCH_MCP',[rect(-140,-140,280,280,'0'),text(-100,-60,'M',160,'0')]),
  symbol('SCH_SOUNDER',[circle(0,0,150,'0'),poly([[-200,150],[0,330],[200,150]],'0')]),
  symbol('SCH_DATA',[rect(-120,-120,240,240,'0'),text(-70,-60,'D',160,'0')]),
  symbol('SCH_AP',[circle(0,0,160,'0'),text(-110,-60,'AP',140,'0')]),
  symbol('SCH_SPEAKER',[circle(0,0,140,'0'),line(-100,-100,100,100,'0')]),
  symbol('SCH_FAN',[circle(0,0,180,'0'),line(-150,0,150,0,'0'),line(0,-150,0,150,'0')])
 ];
 function sheet(title,scale='1:100'){
  const index=sheets.length,x=index*70000,id='E-'+String(index+1).padStart(2,'0');
  const s={id,title,scale,origin:p(x,0),widthMm:594,heightMm:420,modelPerPaper:100};sheets.push(s);
  entities.push(rect(x+2000,1000,55400,40000),text(x+4000,38000,title,650),text(x+4000,36500,`${r.projectId}  |  ${id}  |  ${r.designStage}`,280));
  entities.push(line(x+2000,4800,x+57400,4800),line(x+37500,1000,x+37500,4800),text(x+3000,3400,r.name,360),text(x+3000,2300,'原创示范 / 待专业审定 / 不用于施工',280),text(x+38500,3400,`${id}  比例 ${scale}  A2`,330),text(x+38500,2200,`${r.designDate}  版本 R1`,280));
  return {s,x,ox:x+6000,oy:19000};
 }
 function notes(x,y,lines,height=300,gap=650){for(const t of lines){entities.push(text(x,y,t,height));y-=gap;}}
 function architecture(ox,oy,f){
  const add=o=>entities.push(o),at=(x,y,t,h=240)=>add(text(ox+x,oy+y,t,h,'A-TEXT'));
  add(rect(ox,oy,W,H,'A-WALL'));add(rect(ox+200,oy+200,W-400,H-400,'A-WALL'));
  // Corridor wall has two 1.1m outward-opening classroom doors per room.
  for(let c=0;c<r.classroomsPerFloor;c++){
   const x=4500+c*r.classroomWidthMm,cw=r.classroomWidthMm;
   add(line(ox+x,oy,ox+x,oy+D,'A-WALL'));add(line(ox+x+200,oy+200,ox+x+200,oy+D,'A-WALL'));
   for(const [a,b]of [[0,500],[1600,cw-1600],[cw-500,cw]])add(line(ox+x+a,oy+D,ox+x+b,oy+D,'A-WALL'));
   for(const a of [500,cw-1600]){add(line(ox+x+a,oy+D,ox+x+a,oy+D+1000,'A-DOOR'));add(line(ox+x+a,oy+D+1000,ox+x+a+1000,oy+D,'A-DOOR'));}
   add(line(ox+x+100,oy+200,ox+x+100,oy+4800,'A-FURN'));
   at(x+3500,D-600,`${f}${String(c+1).padStart(2,'0')} 普通教室 / ${r.studentsPerClassroom}人`);
   at(x+2000,400,`净面积 ${round(A,2)}m2`,200);
   // South glazing and teaching board: independently authored coordination background.
   add(rect(ox+x+1500,oy-60,cw-3000,120,'A-DOOR'));add(rect(ox+x+200,oy+1500,100,4500,'A-FURN'));
   for(let row=0;row<5;row++)for(let col=0;col<3;col++)add(rect(ox+x+2500+row*1050,oy+1300+col*1750,650,900,'A-FURN'));
  }
  const service=4500+r.classroomsPerFloor*r.classroomWidthMm;
  for(const x of [service,service+6000])add(line(ox+x,oy,ox+x,oy+D,'A-WALL'));
  // A 1.5m central vestibule reaches toilets without passing through electrical rooms.
  for(const [a,b]of [[0,2250],[3750,6000]]){add(line(ox+service+a,oy+D,ox+service+b,oy+D,'A-WALL'));add(line(ox+service+a,oy+5000,ox+service+b,oy+5000,'A-WALL'));}
  for(const xx of [2250,3750])for(const [a,b]of [[0,3300],[4400,5500],[6600,D]])add(line(ox+service+xx,oy+a,ox+service+xx,oy+b,'A-WALL'));
  for(const [xx,direction]of [[2250,-1],[3750,1]])for(const yy of [3300,5500])add(line(ox+service+xx,oy+yy,ox+service+xx+direction*1000,oy+yy,'A-DOOR'));
  at(service+200,4300,'卫生间A');at(service+3900,4300,'卫生间B');at(service+250,6500,'强电间');at(service+3950,6500,'弱电间');
  at(service+2450,1000,'通道',180);
  for(const x of [service+300,service+4000])for(let i=0;i<2;i++)add(rect(ox+x,oy+500+i*1200,1500,1000,'A-FURN'));
  for(const x of [0,W-4500]){at(x+300,6000,'疏散楼梯');for(let i=0;i<12;i++){add(line(ox+x+400,oy+500+i*300,ox+x+2000,oy+500+i*300,'A-FURN'));add(line(ox+x+2400,oy+500+i*300,ox+x+4000,oy+500+i*300,'A-FURN'));}at(x+600,4700,f===1?'室外出口':'下至首层');}
  at(500,D+2000,`走廊门扇开启后净宽协调值 ${round((r.corridorWidthMm-r.wallThicknessMm-1000)/1000)}m`);
  add(line(ox,oy-1500,ox+W,oy-1500,'A-TEXT'));for(const x of [0,4500,...Array.from({length:r.classroomsPerFloor},(_,i)=>4500+(i+1)*r.classroomWidthMm),W-4500,W])add(line(ox+x,oy-1200,ox+x,oy-1800,'A-TEXT'));
  at(W/2-1300,-1400,`${W} 总长 / 单位mm`);at(-1000,H+1000,'N ↑',330);at(W-10500,H+1000,`标高 +${round((f-1)*r.floorHeightMm/1000,2)}m`);
 }
 function addDevice(kind,group,xy,{floor,room='',circuit='',watts=0,model='',role='equipment',sheetId}={}){
  const g=`F${floor}-${group}`;if(!groups.has(g))groups.set(g,[]);const list=groups.get(g),n=list.length+1,id=`${g}-${String(n).padStart(3,'0')}`;
  const layer=['SCH_SMOKE','SCH_MCP','SCH_SOUNDER','SCH_EM','SCH_EXIT','SCH_LEFT','SCH_RIGHT'].includes(kind)?'E-FIRE':['SCH_DATA','SCH_AP','SCH_SPEAKER'].includes(kind)?'E-DATA':'E-LIGHT';
  const item={id,blockName:kind,position:p(...xy),layer,rotationRadians:0,attributes:{DEVICE_ID:`${floor}${group}-${String(n).padStart(3,'0')}`,MODEL:model,CIRCUIT:circuit,ROOM:room,ROLE:role},floor,watts,role,sheetId};list.push(item);devices.push(item);return item;
 }
 function wire(a,b,circuitId,via=[]){
  const vertices=[a.position.slice(),...via.map(v=>p(...v)),b.position.slice()].filter((v,i,all)=>i===0||Math.hypot(v[0]-all[i-1][0],v[1]-all[i-1][1])>1e-6);
  routes.push({id:`R-${routes.length+1}`,circuitId,from:a.id,to:b.id,vertices,lengthMm:vertices.slice(1).reduce((s,v,i)=>s+Math.hypot(v[0]-vertices[i][0],v[1]-vertices[i][1]),0)});
 }
 function circuit(id,panel,items,system,phase,{breaker=e.lightingBreakerA,section=e.lightingCableMm2,kd=1,extraM=6}={}){
  for(const item of items)item.attributes.CIRCUIT=id;
  const start=routes.length;let prev=panel;
  for(let i=0;i<items.length;i++){const d=items[i];wire(prev,d,id,i===0?[[d.position[0],panel.position[1]]]:[[d.position[0],prev.position[1]]]);prev=d;}
  for(const w of routes.slice(start))w.layer=system==='emergency'||system==='signal'&&id.startsWith('FA')?'E-FIRE':system==='data'||system==='signal'?'E-DATA':'E-WIRE';
  const geometryLengthM=routes.slice(start).reduce((s,w)=>s+w.lengthMm/1000,0),watts=items.reduce((s,d)=>s+d.watts,0),estimatedLengthM=geometryLengthM+extraM+items.length*0.5;
  const currentA=system==='emergency'?watts/em.voltageDc:system==='power'?watts/(e.phaseVoltage*e.powerFactor):null;
  circuits.push({id,panel:panel.id,floor:panel.floor,system,phase,deviceIds:items.map(d=>d.id),watts,demandWatts:watts*kd,kd,breakerA:system==='power'?breaker:null,sectionMm2:section,assumedIzA:system==='power'?e.branchAssumedIzA:null,currentA,geometryLengthM,estimatedLengthM,voltageDropPercent:system==='power'?100*2*e.copperRhoOhmMm2M*estimatedLengthM*currentA/section/e.phaseVoltage:null});
 }
 const title=sheet('设计总说明、图纸目录与图例','示意');
  notes(title.x+4500,34000,[`一、项目需求：${r.floors}层，${r.floors*r.classroomsPerFloor}间普通教室，${r.floors*r.classroomsPerFloor*r.studentsPerClassroom}名学生。`,`建筑轮廓 ${W/1000}m x ${H/1000}m；层高 ${r.floorHeightMm/1000}m；总建筑面积 ${round(W*H*r.floors/1e6,2)}m2。`,'二、供电：校园380/220V TN-S；普通电源与消防专用电源分开。',`总箱设隔离、短路及过载保护；N、PE全程分开；插座设A型${e.socketRcdMa}mA RCBO。`,'三、照明：普通教室12盏LED灯+3盏黑板灯，分窗侧/中间/内侧及黑板控制。',`教室桌面≥${l.targetLux}lx，黑板≥${l.boardTargetLux}lx；Ra≥90，4000K，UGR≤19为采购目标。`,`四、应急：集中控制A型36V DC，主电源接校园消防电源，设计备用${em.durationMinutes}min。`,`疏散走道地面最低${em.corridorMinLux}lx，楼梯最低${em.stairMinLux}lx；图示布点须以厂家IES逐点复核。`,`五、布线：照明WDZ-BYJ 3x${e.lightingCableMm2}/SC20，插座WDZ-BYJ 3x${e.socketCableMm2}/SC20。`,'照明控制段按受控组增补开关线，禁止将PE兼作工作线。','六、消防：校园报警总线延伸，新增设备数量、地址及兼容性由原系统厂家确认。','七、接地：共用接地、总等电位，阻值按最终各系统最严要求确定并实测。','八、防雷：屋面仅预留接闪及引下线协调方案；分类及网格须经雷击风险校核。','九、设计依据见 standards-register.json；通用规范优先，旧图集仅参考构造。'],310,850);
 const legends=[['SCH_LIGHT','教室灯 24W / ≥3600lm'],['SCH_BOARD','黑板灯 16W / 非对称配光'],['SCH_CEILING','公共区LED灯 12W'],['SCH_SOCKET','安全型插座 10A / h=1.8m'],['SCH_SWITCH','两组双联开关 / h=1.3m'],['SCH_PANEL','配电箱 / 底边h=1.5m'],['SCH_EM','应急照明 A型 5W'],['SCH_EXIT','出口标志 A型 1W'],['SCH_LEFT','疏散方向标志 1W'],['SCH_SMOKE','点型感烟探测器'],['SCH_MCP','手动报警按钮 h=1.3m'],['SCH_DATA','信息点 Cat6'],['SCH_AP','吸顶AP / PoE'],['SCH_SPEAKER','校园广播扬声器 3W']];
 for(let i=0;i<legends.length;i++){const y=33000-i*1650,[name,label]=legends[i];for(const g of symbols.find(s=>s.name===name).geometry){const o=structuredClone(g);if(o.points)o.points=o.points.map(v=>p(v[0]+title.x+38200,v[1]+y));if(o.position)o.position=p(o.position[0]+title.x+38200,o.position[1]+y);entities.push(o);}entities.push(text(title.x+39500,y-100,label,250));}
 for(let f=1;f<=r.floors;f++){
  const {s,x,ox,oy}=sheet(`${f}层照明及开关控制平面图`);architecture(ox,oy,f);
  const panel=addDevice('SCH_PANEL','AL',[ox+W-9500,oy+D-700],{floor:f,model:'AL-'+f,role:'panel',sheetId:s.id});
  for(let c=0;c<r.classroomsPerFloor;c++){
   const rx=4500+c*r.classroomWidthMm,id=`AL${f}-L${c+1}`,room=`${f}${String(c+1).padStart(2,'0')}`,items=[];
   // 4 rows in teaching depth, 3 rows parallel to the board.
   for(let row=0;row<4;row++)for(let col=0;col<3;col++)items.push(addDevice('SCH_LIGHT','L',[ox+rx+2000+row*(r.classroomWidthMm-3500)/3,oy+1500+col*(D-3000)/2],{floor:f,room,circuit:id,watts:l.luminaireWatts,model:`LED-${l.luminaireWatts}W-${l.luminaireLumens}lm`,sheetId:s.id}));
   for(let col=0;col<3;col++)items.push(addDevice('SCH_BOARD','B',[ox+rx+900,oy+1800+col*1800],{floor:f,room,circuit:id,watts:l.boardWatts,model:`BOARD-${l.boardWatts}W`,sheetId:s.id}));
   circuit(id,panel,items,'power',['A','B','C'][c%3],{extraM:8});
   const sw=addDevice('SCH_SWITCH','K',[ox+rx+1900,oy+D-350],{floor:f,room,circuit:id,model:'2x2-gang',role:'control',sheetId:s.id});
   entities.push(poly([[sw.position[0],sw.position[1]],[sw.position[0],oy+D-800],[ox+rx+7500,oy+D-800]],'E-CTRL'));
  }
  const commonId=`AL${f}-L${r.classroomsPerFloor+1}`;
  const common=[];for(let i=0;i<7;i++)common.push(addDevice('SCH_CEILING','C',[ox+2500+i*(W-5000)/6,oy+D+2800],{floor:f,circuit:commonId,watts:12,model:'LED-12W',sheetId:s.id}));
  for(const dx of [2000,W-2200])for(const dy of [1800,5200])common.push(addDevice('SCH_CEILING','C',[ox+dx,oy+dy],{floor:f,circuit:`AL${f}-L4`,watts:12,model:'LED-12W',sheetId:s.id}));
  for(const dx of [W-10000,W-5500])for(const dy of [2200,6500])common.push(addDevice('SCH_CEILING','C',[ox+dx,oy+dy],{floor:f,circuit:commonId,watts:12,model:dy<5000?'LED-IP44-12W':'LED-12W',sheetId:s.id}));
  circuit(commonId,panel,common,'power','A',{extraM:10});
  notes(x+6000,16500,[Array.from({length:r.classroomsPerFloor},(_,i)=>`AL${f}-L${i+1} → ${f}${String(i+1).padStart(2,'0')}教室`).join('；'),`各教室三列分控、黑板独控；支路L,N,PE共3x${e.lightingCableMm2}，开关线另计。`],260,650);
  notes(x+6000,14500,[`本层AL${f}：教室照明各1回路；L${r.classroomsPerFloor+1}公共区，走廊分区集中手动控制。`,'灯具安装h=3.0m；黑板灯按配光安装h约2.7m，距黑板约0.9m。','连线为回路示意路径；SC20暗敷，控制支线需按分组增加开关线。','实线回路路径；紫色控制关系；图块属性保存设备号、型号、房间和回路。','普通照明接PE；卫生间灯具IP44；墙体、门窗和桌椅为电气协调底图。'],300,800);
 }
 for(let f=1;f<=r.floors;f++){
  const {s,x,ox,oy}=sheet(`${f}层插座及小动力平面图`);architecture(ox,oy,f);
  const panel=addDevice('SCH_PANEL','AP',[ox+W-9200,oy+D-400],{floor:f,model:'AP-'+f,role:'panel',sheetId:s.id});
  for(let c=0;c<r.classroomsPerFloor;c++){
   const rx=4500+c*r.classroomWidthMm,id=`AP${f}-S${c+1}`,items=[];
   for(const [dx,dy,w,model]of [[800,1200,400,'AV-SOCKET'],[r.classroomWidthMm-500,1200,200,'SAFE-SOCKET'],[r.classroomWidthMm-500,D-1500,200,'SAFE-SOCKET'],[4500,D-500,200,'SAFE-SOCKET'],[800,D-1500,200,'SAFE-SOCKET']])items.push(addDevice('SCH_SOCKET','S',[ox+rx+dx,oy+dy],{floor:f,room:`${f}${String(c+1).padStart(2,'0')}`,circuit:id,watts:w,model,sheetId:s.id}));
   circuit(id,panel,items,'power',['B','C','A'][c%3],{breaker:e.socketBreakerA,section:e.socketCableMm2,kd:e.socketDemandFactor,extraM:10});
   entities.push(text(ox+rx+2000,oy+D-1900,`${id} B${e.socketBreakerA}A / A型${e.socketRcdMa}mA`,250));
  }
  const net=[0,1].map(i=>addDevice('SCH_SOCKET','S',[ox+W-6500+i*800,oy+6000],{floor:f,circuit:`AP${f}-S4`,watts:150,model:'ICT-SOCKET',sheetId:s.id}));
  circuit(`AP${f}-S${r.classroomsPerFloor+1}`,panel,net,'power','B',{breaker:e.socketBreakerA,section:e.socketCableMm2,extraM:8});
  const fans=[0,1].map(i=>addDevice('SCH_FAN','V',[ox+W-10000+i*4500,oy+400],{floor:f,circuit:`AP${f}-V1`,watts:30,model:'EXHAUST-30W',sheetId:s.id}));
  circuit(`AP${f}-V1`,panel,fans,'power','C',{extraM:8});
  notes(x+6000,14500,['插座采用安全门保护型；教室一般插座h=1.8m，讲台AV插座由家具协调。',`插座与照明分回路，插座A型${e.socketRcdMa}mA RCBO；卫生间无普通电源插座。`,'卫生间排风机单独回路，设就地控制与隔离；设备安装IP等级由环境校核。','弱电间信息设备电源300W为负荷假设；空调、电热水器等未纳入本项目。',`插座WDZ-BYJ 3x${e.socketCableMm2}，排风3x${e.lightingCableMm2} / SC20，保护导体不得省略。`],300,800);
 }
 for(let f=1;f<=r.floors;f++){
  const {s,x,ox,oy}=sheet(`${f}层消防应急照明与疏散指示平面图`);architecture(ox,oy,f);
  const panel=addDevice('SCH_PANEL','EL',[ox+W-10000,oy+6000],{floor:f,model:`AEL${f}-36V-150W`,role:'panel',sheetId:s.id});
  const a=[],b=[];
  for(let i=0;i<8;i++)(i%2?a:b).push(addDevice('SCH_EM','E',[ox+1800+i*(W-3600)/7,oy+D+600],{floor:f,circuit:`AEL${f}-E${i%2?1:2}`,watts:em.lightWatts,model:'A-36V-5W',sheetId:s.id}));
  for(const dx of [1800,W-1800])for(const dy of [1200,3200,5400,7200])a.push(addDevice('SCH_EM','E',[ox+dx,oy+dy],{floor:f,circuit:`AEL${f}-E1`,watts:em.lightWatts,model:'A-36V-5W-STAIR',sheetId:s.id}));
  for(const dx of [1600,W-1600])b.push(addDevice('SCH_EXIT','X',[ox+dx,oy+D-100],{floor:f,circuit:`AEL${f}-E2`,watts:em.signWatts,model:f===1?'A-36V-EXIT':'A-36V-STAIR-EXIT',sheetId:s.id}));
  for(const dx of [1600,W-1600])b.push(addDevice('SCH_EXIT','X',[ox+dx,oy+200],{floor:f,circuit:`AEL${f}-E2`,watts:em.signWatts,model:f===1?'A-36V-FINAL-EXIT':'A-36V-DOWN',sheetId:s.id}));
  for(let i=0;i<6;i++){const dx=4000+i*(W-8000)/5,left=dx<W/2;b.push(addDevice(left?'SCH_LEFT':'SCH_RIGHT','X',[ox+dx,oy+D+1400],{floor:f,circuit:`AEL${f}-E2`,watts:em.signWatts,model:left?'A-36V-LEFT':'A-36V-RIGHT',sheetId:s.id}));}
  // Add classroom escape lighting as an owner requirement, on the protected system only.
  for(let c=0;c<r.classroomsPerFloor;c++)for(const dx of [2300,r.classroomWidthMm-2300])b.push(addDevice('SCH_EM','E',[ox+4500+c*r.classroomWidthMm+dx,oy+D-1800],{floor:f,circuit:`AEL${f}-E2`,watts:em.lightWatts,model:'A-36V-5W-CLASS',sheetId:s.id}));
  const emergencyGroups=[[],[],[],[]];for(const d of [...a,...b]){const localX=d.position[0]-ox;emergencyGroups[Math.min(3,Math.floor(localX/W*4))].push(d);}
  emergencyGroups.forEach((items,i)=>{items.sort((a,b)=>a.position[1]-b.position[1]||a.position[0]-b.position[0]);circuit(`AEL${f}-E${i+1}`,panel,items,'emergency','DC',{section:4,extraM:12});});
  notes(x+6000,14500,['独立消防电源→AEL集中电源→四路36V DC；禁止接普通开关和插座。',`集中控制型；设计备用${em.durationMinutes}min；楼梯最低${em.stairMinLux}lx、走道最低${em.corridorMinLux}lx。`,'标志方向对应左右楼梯，首层楼梯直通室外；实际防火门/出口由建筑专业确认。','疏散标志沿走道低位安装，出口标志门上方；应急照明h=2.6m。','线路初选WDZN-BYJ 2x4 / SC25，直流压降与保护由选定厂家复核。','未取得IES/LDT，最低照度、连续可视性及90min电池性能均为待验证项。'],300,800);
 }
 for(let f=1;f<=r.floors;f++){
  const {s,x,ox,oy}=sheet(`${f}层火灾报警、信息与广播布点平面图`);architecture(ox,oy,f);
  const hub=addDevice('SCH_PANEL','FD',[ox+W-6000,oy+6200],{floor:f,model:`FD${f}-ICT+ISO`,role:'interface',sheetId:s.id}),fire=[],data=[],broadcast=[];
  for(let c=0;c<r.classroomsPerFloor;c++){
   const rx=4500+c*r.classroomWidthMm;
   for(const dx of [3000,6500])fire.push(addDevice('SCH_SMOKE','D',[ox+rx+dx,oy+4200],{floor:f,circuit:'FA-LOOP1',model:'SMOKE-ADDRESSABLE',sheetId:s.id}));
   data.push(addDevice('SCH_DATA','T',[ox+rx+1000,oy+1600],{floor:f,circuit:`NET${f}`,model:'2xCAT6',sheetId:s.id}),addDevice('SCH_AP','T',[ox+rx+4500,oy+5700],{floor:f,circuit:`NET${f}`,model:'AP-POE',sheetId:s.id}));
   broadcast.push(addDevice('SCH_SPEAKER','P',[ox+rx+7200,oy+2500],{floor:f,circuit:`PA${f}`,watts:3,model:'PA-3W',sheetId:s.id}));
  }
  for(let i=0;i<5;i++)fire.push(addDevice('SCH_SMOKE','D',[ox+4000+i*(W-8000)/4,oy+D+2500],{floor:f,circuit:'FA-LOOP1',model:'SMOKE-ADDRESSABLE',sheetId:s.id}));
  for(const dx of [W-10000,W-5500])fire.push(addDevice('SCH_SMOKE','D',[ox+dx,oy+7000],{floor:f,circuit:'FA-LOOP1',model:'SMOKE-ADDRESSABLE',sheetId:s.id}));
  for(const dx of [3200,W-3200]){fire.push(addDevice('SCH_MCP','M',[ox+dx,oy+D+600],{floor:f,circuit:'FA-LOOP1',model:'MCP-ADDRESSABLE',sheetId:s.id}),addDevice('SCH_SOUNDER','A',[ox+dx,oy+D+1700],{floor:f,circuit:'FA-LOOP1',model:'SOUNDER-STROBE',sheetId:s.id}));broadcast.push(addDevice('SCH_SPEAKER','P',[ox+dx,oy+D+3000],{floor:f,circuit:`PA${f}`,watts:3,model:'PA-3W',sheetId:s.id}));}
  circuit(`FA${f}-LOOP1`,hub,fire,'signal','-',{});for(const d of data)circuit(`NET${f}-${d.id.split('-').at(-1)}`,hub,[d],'data','-',{});circuit(`PA${f}`,hub,broadcast,'signal','-',{});
  notes(x+6000,14500,['火警总线采用耐火双绞线，网络为星形Cat6；图示回路是接线示意，非原厂总线拓扑。','报警地址、隔离器分组、回路容量、返回路径及与原主机兼容性须由原厂家深化。','信息点双口Cat6，AP采用PoE；铜缆永久链路≤90m，机柜、UPS及光纤由校园协调。','广播接校园系统，紧急广播优先；声压、可懂度及扬声器抽头由专业复核。','线色仅用于区分：消防/数据/广播实物线路分别敷设，不与强电共管。','探测器布点待梁、吊顶、风口及产品保护范围复核；弱电系统不计入普通照明负荷。'],280,800);
 }
 const power=sheet('低压配电单线系统与负荷总览','示意');
 const demands=circuits.filter(c=>c.system==='power');
 const phaseW={A:0,B:0,C:0};for(const c of demands)phaseW[c.phase]+=c.demandWatts;
 const maxPhaseA=Math.max(...Object.values(phaseW))/(e.phaseVoltage*e.powerFactor),totalWatts=demands.reduce((s,c)=>s+c.watts,0),demandWatts=demands.reduce((s,c)=>s+c.demandWatts,0);
 notes(power.x+4500,34000,[`校园普通电源 380/220V TN-S → 总箱 AP0：4P ${e.mainBreakerA}A，隔离+短路+过载。`,`进线初选 WDZ-YJY 5x${e.mainCableMm2}mm2，估算${e.mainLengthM}m，假定修正后Iz=${e.mainAssumedIzA}A。`,`普通装机 ${round(totalWatts/1000)}kW；需用 ${round(demandWatts/1000)}kW；cosφ=${e.powerFactor}。`,`按分相累计选主开关：A/B/C=${Object.values(phaseW).map(w=>round(w/(220*e.powerFactor),2)).join('/')}A。`],320,850);
 entities.push(line(power.x+8000,29000,power.x+8000,20000,'E-WIRE'),line(power.x+8000,27000,power.x+56000,27000,'E-WIRE'));
 for(let f=1;f<=r.floors;f++)for(let j=0;j<2;j++){const xx=power.x+14000+(f-1)*16000+j*7000;entities.push(line(xx,27000,xx,23500,'E-WIRE'),rect(xx-1800,20500,5500,3000,'E-LIGHT'));notes(xx-1500,22600,[`${j?'AP':'AL'}${f}`,`4P ${e.floorBreakerA}A`,`5x${e.floorCableMm2}mm2`],260,650);}
 notes(power.x+4500,18000,[`各层箱馈线长度：首层12m、逐层增加${r.floorHeightMm/1000}m；载流量假设Iz=${e.floorAssumedIzA}A。`,`照明/排风MCB B${e.lightingBreakerA}A；插座RCBO 1P+N B${e.socketBreakerA}A / A型${e.socketRcdMa}mA。`,'消防电源由校园消防母线独立引来→AFE0→各层AEL，保护和火灾持续供电另行协调。',`AFE0不取自AP0普通切非母线；AEL为36V DC集中电源，自带设计${em.durationMinutes}min蓄电池。`,'进线设置SPD，类型、后备保护及级间配合按引入方式和防雷分类确定。','短路容量、Icn/Icu、选择性、0.4s自动切断及SPD参数待供电资料，未自动判定通过。','N与PE分别设母排；严禁下游再合并；PE不设开关或熔断器。'],310,850);
 for(let offset=0;offset<demands.length;offset+=20){
  const schedule=sheet('配电箱出线回路表与设备统计'+(demands.length>20?`（${Math.floor(offset/20)+1}）`:''),'示意');
  const rows=[['回路/层','相','装机W','Kd','Ib/A','保护A','导线mm2','估长m','支路ΔU%']];
  for(const c of demands.slice(offset,offset+20))rows.push([c.id,c.phase,round(c.watts,0),c.kd,round(c.currentA,2),c.breakerA,`3x${c.sectionMm2}`,round(c.estimatedLengthM,1),round(c.voltageDropPercent,2)]);
  const widths=[10500,3000,4500,3500,4500,4500,6000,6000,6000];let yy=34000;
  for(const row of rows){let xx=schedule.x+4000;for(let i=0;i<row.length;i++){entities.push(rect(xx,yy-850,widths[i],850),text(xx+150,yy-600,row[i],240));xx+=widths[i];}yy-=850;}
  notes(schedule.x+4500,yy-1200,['Ib按支路装机计算，馈线按需用负荷分相累计；估长含立面/端接假设，非采购量。','所有导线均为铜芯；支路3芯含L、N、PE，控制支线另计；压降为简化电阻法。','消防、数据、广播回路另见系统图及circuits.csv；不混入普通电源需用负荷。'],280,700);
 }
 const sys=sheet('消防应急、报警、信息与广播系统图','示意');
  notes(sys.x+5000,34000,['校园消防电源专用回路 → AFE0 → AEL1…AELn（各层独立集中电源）','校园应急照明控制器 → 通信干线 → 各AEL：火警联动、故障监视、手动控制。',`AEL额定${em.supplyRatedWattsPerFloor}W / DC${em.voltageDc}V / ${em.durationMinutes}min；末端电压范围由产品要求复核。`,'每层E1～E4仅接A型应急灯/标志灯；照明与指示支路保护按产品配置。','校园报警主机 → 短路隔离器 → 本楼各层感烟/手报/声光 → 返回校园报警主机。','平面连线表示设备归属，最终闭环回线和隔离器分段见厂家深化，不把串接线当闭环。','校园核心网络 → 单模光纤 → 各层FD网络柜 → Cat6星形链路 → 信息点/AP。','校园广播主机 → 分区干线 → 每层扬声器；紧急优先，抽头功率按容量核验。'],320,1100);
 for(let f=1;f<=r.floors;f++){const xx=sys.x+8000+(f-1)*15000;entities.push(rect(xx,16500,10000,5000,'E-FIRE'));notes(xx+700,20300,[`AEL${f}  /  FD${f}`,`报警设备 ${devices.filter(d=>d.floor===f&&['SCH_SMOKE','SCH_MCP','SCH_SOUNDER'].includes(d.blockName)).length}点`,`广播 ${devices.filter(d=>d.floor===f&&d.blockName==='SCH_SPEAKER').length}x3W`,`网络 ${devices.filter(d=>d.floor===f&&['SCH_DATA','SCH_AP'].includes(d.blockName)).length}组`],320,1000);}
 notes(sys.x+5000,14000,['待接口确认：现有主机品牌/协议、剩余地址容量、光纤路由、消防电源与控制器位置。','火灾报警联动矩阵、非消防切电、消防广播及校园整体消防设计由专业整合。','此图提供明确接入边界，不虚构尚未确定的供电点或消防联动接口。'],300,850);
 const roof=sheet('屋面防雷预留与引下线协调平面图');
 entities.push(rect(roof.ox,roof.oy,W,H,'A-WALL'),rect(roof.ox+200,roof.oy+200,W-400,H-400,'A-WALL'),text(roof.ox+W/2-2500,roof.oy+H/2,`屋面标高 +${r.floorHeightMm*r.floors/1000}m`,300,'A-TEXT'),text(roof.ox-1000,roof.oy+H+1000,'N ↑',330,'A-TEXT'));
 entities.push(rect(roof.ox,roof.oy,W,H,'E-EARTH'));
 const down=[];for(const dx of [0,W/3,2*W/3,W])for(const dy of [0,H]){down.push([dx,dy]);entities.push(circle(roof.ox+dx,roof.oy+dy,240,'E-EARTH'),text(roof.ox+dx+300,roof.oy+dy+350,`DL${down.length}`,230));}
 for(const dx of [W/3,2*W/3])entities.push(line(roof.ox+dx,roof.oy,roof.ox+dx,roof.oy+H,'E-EARTH'));
 notes(roof.x+6000,14500,['图示为接闪带/引下线预留，暂按更密网格协调，不构成已确定防雷类别的结论。',`几何网格最大 ${round(W/3/1000,2)}m x ${H/1000}m；引下线共${down.length}处，利用结构钢筋优先。`,'需输入雷电密度、环境、建筑重要性、金属屋面及屋顶设备后完成分类与滚球校核。','接闪带材料截面、支架、引下线、测试点及断接卡由防雷专项落实。','屋顶新增设备应置于保护范围并做等电位；电源/信号进线协调SPD。'],300,850);
 const ground=sheet('基础接地与总等电位联结示意');
 entities.push(rect(ground.ox,ground.oy,W,H,'A-WALL'),rect(ground.ox+400,ground.oy+400,W-800,H-800,'E-EARTH'));
 for(let i=0;i<down.length;i++){const [dx,dy]=down[i];entities.push(circle(ground.ox+dx,ground.oy+dy,240,'E-EARTH'),text(ground.ox+dx+250,ground.oy+dy+350,`DL${i+1}`,230));}
 entities.push(rect(ground.ox+W-10500,ground.oy+5000,3000,1400,'E-EARTH'),text(ground.ox+W-10300,ground.oy+5500,'MEB 总等电位',250),line(ground.ox+W-10500,ground.oy+5500,ground.ox+400,ground.oy+5500,'E-EARTH'),line(ground.ox+W-7500,ground.oy+5500,ground.ox+W-400,ground.oy+5500,'E-EARTH'));
 notes(ground.x+6000,14500,['基础钢筋闭合接地网，MEB以两根接地导体接不同点；连接与结构专业协调。','总等电位连接：PE母排、进出金属管线、结构钢筋及可利用金属构件。','保护联结铜导体初选6mm2，主接地导体规格按故障电流与专项计算确定。','N与PE分别设置，接地电阻按各系统最严要求确定；未取得土壤数据不承诺1Ω。','竣工需测试接地连续性、阻值、绝缘与RCD动作；所有测试记录纳入项目交付。'],300,850);
 const catalogRows=Math.ceil(sheets.length/2);entities.push(text(title.x+4500,19000,'图纸目录',400));for(let i=0;i<sheets.length;i++)entities.push(text(title.x+4500+Math.floor(i/catalogRows)*16000,17700-(i%catalogRows)*700,`${sheets[i].id}  ${sheets[i].title}`,230));
 const classroomLux=12*l.luminaireLumens*l.utilizationFactor*l.maintenanceFactor/A,boardLux=3*l.boardLumens*l.boardUtilizationFactor*l.maintenanceFactor/(4.5*1.2),lpd=(12*l.luminaireWatts+3*l.boardWatts)/A;
 const mainDrop=100*2*e.copperRhoOhmMm2M*e.mainLengthM*maxPhaseA/e.mainCableMm2/e.phaseVoltage;
 const calculations={floorAreaM2:round(W*H/1e6),grossAreaM2:round(W*H*r.floors/1e6),classroomNetAreaM2:round(A),corridorClearAfterDoorMm:r.corridorWidthMm-r.wallThicknessMm-1000,classroomLux:round(classroomLux),boardLux:round(boardLux),classroomPowerDensityWm2:round(lpd),installedWatts:totalWatts,demandWatts,phaseDemandWatts:phaseW,maxPhaseCurrentA:round(maxPhaseA),mainDropPercent:round(mainDrop),emergency:[]};
 for(let f=1;f<=r.floors;f++){const cs=circuits.filter(c=>c.floor===f&&c.system==='emergency'),w=cs.reduce((s,c)=>s+c.watts,0);calculations.emergency.push({floor:f,loadWatts:w,capacityWatts:em.supplyRatedWattsPerFloor,requiredUsableWh:round(w*em.durationMinutes/60),requiredNameplateWh:round(w*em.durationMinutes/60/em.batteryUsableFactor),status:'选型容量校核，续航和末端电压待厂家验证'});}
 for(const c of demands){const siblings=demands.filter(v=>v.panel===c.panel&&v.phase===c.phase),amps=siblings.reduce((s,v)=>s+v.demandWatts,0)/(e.phaseVoltage*e.powerFactor),floorLength=12+(c.floor-1)*r.floorHeightMm/1000;c.feederCurrentA=amps;c.feederLengthM=floorLength;c.feederDropPercent=100*2*e.copperRhoOhmMm2M*floorLength*amps/e.floorCableMm2/e.phaseVoltage;c.totalDropPercent=mainDrop+c.feederDropPercent+c.voltageDropPercent;}
 for(const c of circuits.filter(c=>c.system==='emergency'))c.dcDropPercent=100*2*e.copperRhoOhmMm2M*c.estimatedLengthM*c.currentA/c.sectionMm2/em.voltageDc;
 const validation=validateSchool({requirements:r,devices,routes,circuits,calculations});
 return {schemaVersion:1,requirements:r,geometry:{widthMm:W,depthMm:H},scene:sceneSchema.parse({view:{center:[29700,21000,0],width:62000,height:44000},views:sheets.map(s=>({name:s.id,center:[s.origin[0]+29700,21000,0],width:62000,height:44000})),layers,symbols,entities}),devices,routes,circuits,sheets,calculations,validation,numbering:[...groups].map(([group,ds])=>({type:'number_devices',ids:ds.map(d=>d.id),prefix:`${ds[0].floor}${group.split('-')[1]}-`,start:1,width:3}))};
}
export function validateSchool(model){
 const {requirements:r,devices,routes,circuits,calculations:c}=model,e=r.electrical,errors=[],checks=[];
 const check=(name,ok,detail)=>{checks.push({name,ok,detail});if(!ok)errors.push(name);};
 check('全项目设备ID及可见编号唯一',new Set(devices.map(d=>d.id)).size===devices.length&&new Set(devices.map(d=>d.attributes.DEVICE_ID)).size===devices.length);
 check('全项目回路标识唯一',new Set(circuits.map(c=>c.id)).size===circuits.length);
 const index=new Map(devices.map(d=>[d.id,d]));
 check('全部显式线路端点与设备端口重合',routes.every(w=>index.has(w.from)&&index.has(w.to)&&JSON.stringify(w.vertices[0])===JSON.stringify(index.get(w.from).position)&&JSON.stringify(w.vertices.at(-1))===JSON.stringify(index.get(w.to).position)));
 const membership=new Map();for(const circuit of circuits)for(const id of circuit.deviceIds)membership.set(id,(membership.get(id)||0)+1);
 check('每个耗能或信号末端恰属于一个回路',devices.filter(d=>d.role==='equipment').every(d=>membership.get(d.id)===1));
 check('末端回路属性与回路表一致',circuits.every(c=>c.deviceIds.every(id=>index.get(id)?.attributes.CIRCUIT===c.id)));
 check('普通教室灯具数量与需求一致',devices.filter(d=>d.blockName==='SCH_LIGHT').length===12*r.floors*r.classroomsPerFloor);
 check('走廊扣除外墙及开启门扇后的协调净宽≥2400mm',c.corridorClearAfterDoorMm>=2400,c.corridorClearAfterDoorMm);
 check('教室利用系数法照度估算达到项目目标',c.classroomLux>=r.lighting.targetLux,{estimateLux:c.classroomLux,targetLux:r.lighting.targetLux});
 check('黑板利用系数法估算达到项目目标',c.boardLux>=r.lighting.boardTargetLux,{estimateLux:c.boardLux,targetLux:r.lighting.boardTargetLux});
 check('教室照明功率不超过项目预算',c.classroomPowerDensityWm2<=r.lighting.powerBudgetWm2,c.classroomPowerDensityWm2);
 const power=circuits.filter(v=>v.system==='power');
 check('支路Ib≤In≤假定修正后Iz',power.every(v=>v.currentA<=v.breakerA&&v.breakerA<=v.assumedIzA));
 check('各层馈线Ib≤In≤假定修正后Iz',power.every(v=>v.feederCurrentA<=e.floorBreakerA&&e.floorBreakerA<=e.floorAssumedIzA));
 check('总进线分相最大Ib≤In≤假定修正后Iz',c.maxPhaseCurrentA<=e.mainBreakerA&&e.mainBreakerA<=e.mainAssumedIzA,c.maxPhaseCurrentA);
 check('普通电源累计简化压降不超过项目限值',power.every(v=>v.totalDropPercent<=e.maxVoltageDropPercent),Math.max(...power.map(v=>v.totalDropPercent)));
 check('插座附加RCD≤30mA',e.socketRcdMa<=30);
 check('应急电源容量留有裕量',c.emergency.every(v=>v.loadWatts<=v.capacityWatts*0.8),c.emergency);
 check('应急36V支路保守电阻压降初估≤10%',circuits.filter(v=>v.system==='emergency').every(v=>v.dcDropPercent<=10));
 check('信息铜缆估算敷设长度≤90m',circuits.filter(v=>v.system==='data').every(v=>v.estimatedLengthM<=90));
 check('应急与普通电源末端不混接',circuits.every(v=>v.deviceIds.every(id=>v.system==='emergency'?['SCH_EM','SCH_EXIT','SCH_LEFT','SCH_RIGHT'].includes(index.get(id).blockName):!['SCH_EM','SCH_EXIT','SCH_LEFT','SCH_RIGHT'].includes(index.get(id).blockName))));
 const adj=new Map();for(const w of routes){if(!adj.has(w.circuitId))adj.set(w.circuitId,new Map());const a=adj.get(w.circuitId);if(!a.has(w.from))a.set(w.from,[]);a.get(w.from).push(w.to);}
 check('全部回路末端可从指定配电箱或接口到达',circuits.every(v=>{const seen=new Set([v.panel]),todo=[v.panel],a=adj.get(v.id);while(todo.length)for(const next of a?.get(todo.pop())||[])if(!seen.has(next)){seen.add(next);todo.push(next);}return v.deviceIds.every(id=>seen.has(id));}));
 return {ok:errors.length===0,checks,errors,reviewStatus:'待专业审定',pending:['建筑与消防专业底图确认、供电及校园系统接口资料','短路电流、保护选择性、自动切断时间、SPD协调及敷设条件载流量','真实IES/LDT逐点照度、均匀度、UGR及产品检验','消防设备布点、隔离分段、报警闭环及联动矩阵厂家深化','应急末端电压、支路保护、电池续航及失电联动','防雷分类/滚球/接地电阻/土壤及结构条件','地方节能条文及GB7793-2025生效后重新核对']};
}
