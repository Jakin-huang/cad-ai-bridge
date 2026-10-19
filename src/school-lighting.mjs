// Read-only, room-by-room photometric audit of an already verified school model.
// Unknown lumens and utilisation factors deliberately remain unavailable.
const ordinary=new Set(['SCH_LIGHT','SCH_BOARD','SCH_CEILING']);
const signs=new Set(['SCH_EXIT','SCH_LEFT','SCH_RIGHT']);
const sum=(xs,key)=>xs.reduce((n,x)=>n+(x[key]||0),0);
export function reviewSchoolLighting(model){
 const r=model.requirements,t=r.wallThicknessMm,W=model.geometry.widthMm,D=r.classroomDepthMm,H=model.geometry.depthMm,cw=r.classroomWidthMm,S=4500+r.classroomsPerFloor*cw;
 const rooms=[],inventory=[],findings=[];
 function room(f,id,name,kind,bounds,L,B,target,plane=0){rooms.push({id,floor:f,name,kind,bounds,lengthM:L/1000,widthM:B/1000,areaM2:L*B/1e6,targetLux:target,workplaneM:plane,mountingM:3,lumens:kind==='classroom'?r.lighting.luminaireLumens:null,uf:kind==='classroom'?r.lighting.utilizationFactor:null,mf:r.lighting.maintenanceFactor,reverseUf:kind==='classroom'?r.lighting.utilizationFactor:0.5,dimensionStatus:kind==='classroom'?'沿用R3面积口径，待建筑净尺寸确认':'按R3协调轴线及200mm墙厚口径估算，非实测',targetSource:kind==='classroom'?'GB7793-2010及修改单；R3目标':kind==='corridor'||kind==='stair'||kind==='vestibule'?'GB50099-2011表9.3.1；通道按走道取值':kind==='toilet'?'GB/T50034-2024表5.5.1普通厕所':kind==='electrical'?'GB/T50034-2024表5.5.1配电装置室参考':'项目维护照明目标；网络中心/固定操作席需按用途重审'});}
 for(let f=1;f<=r.floors;f++){
  for(let c=0;c<r.classroomsPerFloor;c++)room(f,`${f}${String(c+1).padStart(2,'0')}`,'普通教室','classroom',[4500+c*cw,0,4500+(c+1)*cw,D],cw-t,D-t,r.lighting.targetLux,.75);
  room(f,`${f}F-COR`,'走廊','corridor',[0,D,W,H],W-2*t,H-D-t,100);
  room(f,`${f}F-ST-W`,'西楼梯','stair',[0,0,4500,D],4500-t,D-t,100);
  room(f,`${f}F-ST-E`,'东楼梯','stair',[W-4500,0,W,D],4500-t,D-t,100);
  room(f,`${f}F-WC-A`,'卫生间A','toilet',[S,0,S+2250,5000],2250-t,5000-t,75);
  room(f,`${f}F-WC-B`,'卫生间B','toilet',[S+3750,0,S+6000,5000],2250-t,5000-t,75);
  room(f,`${f}F-ELEC`,'强电间','electrical',[S,5000,S+2250,D],2250-t,D-5000-t,200,.75);
  room(f,`${f}F-ICT`,'弱电间','ict',[S+3750,5000,S+6000,D],2250-t,D-5000-t,200,.75);
  room(f,`${f}F-VEST`,'设备区中间通道','vestibule',[S+2250,0,S+3750,D],1500-t,D-t,100);
 }
 for(const d of model.devices.filter(d=>ordinary.has(d.blockName)||d.blockName==='SCH_EM'||signs.has(d.blockName))){
  const sheet=model.sheets.find(s=>s.id===d.sheetId);if(!sheet)throw Error('Missing lighting sheet '+d.sheetId);
  const x=d.position[0]-sheet.origin[0]-6000,y=d.position[1]-19000;
  const matches=rooms.filter(room=>room.floor===d.floor&&x>=room.bounds[0]&&x<room.bounds[2]&&y>=room.bounds[1]&&y<room.bounds[3]);
  if(matches.length!==1)throw Error(`Lighting device ${d.id} has ${matches.length} spatial rooms`);
  const space=matches[0],kind=d.blockName==='SCH_BOARD'?'黑板':ordinary.has(d.blockName)?'一般':signs.has(d.blockName)?'标志':'应急';
  if(d.attributes.ROOM&&d.attributes.ROOM!==space.id)throw Error('ROOM attribute disagrees with insert position: '+d.id);
  inventory.push({id:d.id,number:d.attributes.DEVICE_ID,roomId:space.id,floor:d.floor,sheetId:d.sheetId,block:d.blockName,kind,watts:d.watts,lumens:d.blockName==='SCH_LIGHT'?r.lighting.luminaireLumens:d.blockName==='SCH_BOARD'?r.lighting.boardLumens:null,circuitId:d.attributes.CIRCUIT,x,y,sourceRoom:d.attributes.ROOM,assignment:d.attributes.ROOM?'ROOM与空间一致':'ROOM为空，按插入点归属'});
 }
 for(const room of rooms){
  const all=inventory.filter(d=>d.roomId===room.id),normal=all.filter(d=>d.kind==='一般'),board=all.filter(d=>d.kind==='黑板'),em=all.filter(d=>d.kind==='应急'),sg=all.filter(d=>d.kind==='标志');
  Object.assign(room,{generalIds:normal.map(d=>d.id),boardIds:board.map(d=>d.id),emergencyIds:em.map(d=>d.id),signIds:sg.map(d=>d.id),generalCount:normal.length,boardCount:board.length,normalWatts:sum(normal,'watts')+sum(board,'watts'),emergencyWatts:sum(em,'watts'),signWatts:sum(sg,'watts'),emergencyCircuits:[...new Set([...em,...sg].map(d=>d.circuitId))].sort()});
  room.mountingAbovePlaneM=room.mountingM-room.workplaneM;
  room.roomIndex=room.areaM2/(room.mountingAbovePlaneM*(room.lengthM+room.widthM));
  room.averageLux=normal.length>0&&room.lumens!==null&&room.uf!==null?normal.length*room.lumens*room.uf*room.mf/room.areaM2:null;
  room.requiredTotalLumens=room.targetLux*room.areaM2/(room.reverseUf*room.mf);
  room.requiredLumensPerLamp=normal.length?room.requiredTotalLumens/normal.length:null;
  room.powerDensityWm2=room.normalWatts/room.areaM2;
  room.status=!normal.length?'无专用普通灯，借光未验证':room.averageLux===null?'缺光通量/UF，尚不可算':room.averageLux>=room.targetLux?'R3假设下平均值达到目标':'R3假设下平均值不足';
  room.emergencyMetric=room.kind==='stair'?'Emin':room.kind==='corridor'||room.kind==='classroom'?'Emin':room.kind==='electrical'||room.kind==='ict'?'备用Emin（条件）':'消防范围待确认';
  room.emergencyTargetLux=room.kind==='stair'?r.emergency.stairMinLux:room.kind==='corridor'?r.emergency.corridorMinLux:room.kind==='classroom'?3:room.kind==='electrical'||room.kind==='ict'?room.targetLux:null;
  room.emergencyBasis=room.kind==='classroom'?'本次项目疏散照明建议目标，非已核实的该房间强制要求':room.kind==='electrical'||room.kind==='ict'?'若属GB55037-2022 10.1.11配电室或火灾仍需工作设备房，工作面最低照度不低于正常照明，本表暂按200lx条件目标；不采用10%替代强制要求。建筑消防确认用途及备用电源方案。':'GB55037-2022及R3消防目标；范围按建筑消防确认';
  room.minimumLux=null;
  if(!normal.length)findings.push({roomId:room.id,severity:'补图/借光计算',text:'设备区中间通道没有专用普通灯。不能把相邻房间的灯直接计入本通道，需补灯或完成门洞借光计算。'});
  else if(room.averageLux===null)findings.push({roomId:room.id,severity:'缺产品输入',text:`${normal.length}盏12W灯缺Φ、UF。按反算UF=${room.reverseUf}、MF=${room.mf}，需每灯至少${Math.ceil(room.requiredLumensPerLamp)}lm；该值是选型需求，不是现有灯具输出。`});
  if(room.kind==='electrical'||room.kind==='ict')findings.push({roomId:room.id,severity:'备用照明用途/方案待核',text:'现有一只5W疏散应急灯不能证明备用照明达标。若适用GB55037-2022 10.1.11，须补备用电源方案和工作面最低照度核验，条件目标200lx。'});
 }
 const boards=rooms.filter(room=>room.kind==='classroom').map(room=>({roomId:room.id,floor:room.floor,widthM:4.5,heightM:1.2,areaM2:5.4,count:room.boardCount,watts:sum(inventory.filter(d=>d.roomId===room.id&&d.kind==='黑板'),'watts'),lumens:r.lighting.boardLumens,uf:r.lighting.boardUtilizationFactor,mf:r.lighting.maintenanceFactor,targetLux:r.lighting.boardTargetLux,averageLux:room.boardCount*r.lighting.boardLumens*r.lighting.boardUtilizationFactor*r.lighting.maintenanceFactor/5.4,status:'板面尺寸及UF为R3计算假设；配光、投射角和均匀度待验证'}));
 const expected=model.devices.filter(d=>ordinary.has(d.blockName)||d.blockName==='SCH_EM'||signs.has(d.blockName)).length;
 if(inventory.length!==expected||new Set(inventory.map(d=>d.id)).size!==expected)throw Error('Lighting inventory coverage failed');
 const totals={rooms:rooms.length,normalLights:inventory.filter(d=>d.kind==='一般').length,boardLights:inventory.filter(d=>d.kind==='黑板').length,emergencyLights:inventory.filter(d=>d.kind==='应急').length,signs:inventory.filter(d=>d.kind==='标志').length,normalWatts:sum(rooms,'normalWatts'),emergencyWatts:sum(rooms,'emergencyWatts'),signWatts:sum(rooms,'signWatts'),calculatedNormalRooms:rooms.filter(d=>d.averageLux!==null).length,missingNormalRooms:rooms.filter(d=>d.averageLux===null).length};
 return {schemaVersion:1,projectId:r.projectId,designDate:r.designDate,modelVersion:'R3',method:'Eavg=N×Φ×UF×MF/A；反算Φ需求=E目标×A/(N×UF反算×MF)。不计算无配光数据的Emin、U0或UGR；不计自然采光和未验证的跨房间借光。',areaBasis:'采用R3既有教室8.8×7.8m口径。其余房间净尺寸按协调轴线减墙厚估算；实际建筑净空、楼梯斜面、门洞和吊顶须确认。',reverseUfAssumption:.5,rooms,boards,inventory,totals,findings};
}
