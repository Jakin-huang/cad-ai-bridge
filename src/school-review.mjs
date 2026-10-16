const vendor='https://www.schneider-electric.cn/zh/product/';
const product=(model,reference,spec,url,extra={})=>({model,reference,spec,url,status:'测试用例参考选型；短路/配合及供货须实参复核',...extra});
export function panelHardware(panel){
 const mainA=panel.id==='AP0'?panel.selection.ratingA:10,mainReferences={10:'A9F18410',20:'A9F18420',32:'A9F18432'};
 const isolator=panel.id!=='AP0'&&panel.id!=='AFE0',dc=panel.id.startsWith('ALA');
 panel.incoming=isolator?product('Acti9 iSW',dc?'A9S65240':'A9S65440',`${dc?2:4}P 40A 415VAC / IEC60947-3 隔离开关`,dc?'https://www.se.com/uk/en/product/A9S65240/switch-disconnector-isw-2p-40-a-415-v/':'https://www.se.com/it/it/product/A9S65440/interruttore-sezionatore-isw-4p-40a/',{function:'isolation',ratingA:40,poles:dc?2:4,upstreamProtectionA:dc?6:panel.selection.ratingA}):product('Acti9 iC65N',mainReferences[mainA]||'订货号待厂家确认',`4P C${mainA}A / Icn≥6kA@400V / IEC60898-1`,vendor+(panel.id==='AP0'?'A9F18432/ic65n-小型断路器-c曲线-4p-32a/':'A9F18410/ic65n-小型断路器-c曲线-4p-10a/'),{function:'overcurrent',ratingA:mainA,poles:4,breakingCapacityKa:6});
 for(const row of panel.rows){if(row.dc){row.hardware={model:'集中电源原厂内置输出保护',spec:'DC36V 2A/72W；每回路独立过载/短路保护；不接外置AC开关',function:'factory-dc-protection',ratingA:2,rcdMa:null,evidence:'GB51309-2018 3.3.2、3.3.6、3.3.8；厂家认证系统需确认',status:'采购性能要求，尚非已验证产品型号'};}
  else if(row.rcd)row.hardware=product('Acti9 iC65N Vigi+','A9D65216','2P C16A 230VAC A型30mA',vendor+'A9D65216/acti9-漏电保护断路器-ic65n-vigi%2B-rcbo-c曲线16a230v2pele30maa型4模宽/',{function:'rcbo',ratingA:16,rcdMa:30});
  else{const current=row.hardwareRatingA||row.selection?.ratingA||6,poles=row.phase==='ABC'?4:row.id.startsWith('ALA')?2:1;row.hardware=product('Acti9 iC65N',current===20&&poles===4?'A9F18420':current===10&&poles===1?'A9F18110':current===6&&poles===2?'A9F18206':'订货号待厂家确认',`${poles}P C${current}A / Icn≥6kA`,vendor+(poles===4?'A9F18420/ic65n-小型断路器-c曲线-4p-20a/':poles===2?'A9F18206/ic65n-小型断路器-c曲线-2p-6a/':'A9F18110/ic65n-小型断路器-c曲线-1p-10a/'),{function:'overcurrent',ratingA:current,breakingCapacityKa:6});}
 }
 return panel;
}
export function finishSchoolReview(m){
 for(const d of m.devices)if(/^(?:ALA|AEL)/.test(d.attributes.MODEL))d.layer='E-FIRE';
 const text=(sheet,x,y,t,h=240,layer='S-TEXT')=>m.scene.entities.push({kind:'text',layer,position:[sheet.origin[0]+x,y,0],text:t,height:h,rotationRadians:0});
 const byId=new Map(m.devices.map(d=>[d.id,d]));m.controlWiring=[];
 for(const circuitId of new Set(m.controls.map(g=>g.circuitId))){
  const cs=m.controls.filter(g=>g.circuitId===circuitId),rs=m.routes.filter(w=>w.circuitId===circuitId),sw=byId.get(cs[0].switchId);
  const anchor=cs.flatMap(c=>c.deviceIds).map(id=>byId.get(id)).sort((a,b)=>Math.hypot(a.position[0]-sw.position[0],a.position[1]-sw.position[1])-Math.hypot(b.position[0]-sw.position[0],b.position[1]-sw.position[1]))[0];
  const adjacency=new Map();for(const w of rs){w.controlGroups=[];for(const [a,b]of [[w.from,w.to],[w.to,w.from]]){if(!adjacency.has(a))adjacency.set(a,[]);adjacency.get(a).push([b,w]);}}
  for(const group of cs)for(const target of group.deviceIds){const queue=[[anchor.id,[]]],seen=new Set();while(queue.length){const [id,path]=queue.shift();if(seen.has(id))continue;seen.add(id);if(id===target){for(const w of path)if(!w.controlGroups.includes(group.group))w.controlGroups.push(group.group);break;}for(const [id2,w]of adjacency.get(id)||[])queue.push([id2,[...path,w]]);}}
  for(const id of new Set(cs.map(g=>g.switchId))){const device=byId.get(id),vertices=[anchor.position.slice(),[device.position[0],anchor.position[1],0],device.position.slice()],sheet=m.sheets.find(s=>s.id===device.sheetId),lengthM=vertices.slice(1).reduce((n,v,i)=>n+Math.hypot(v[0]-vertices[i][0],v[1]-vertices[i][1])/1000,0)+1.7+0.6;
   m.scene.entities.push({kind:'polyline',layer:'E-CTRL',points:vertices,closed:false});
   m.controlWiring.push({circuitId,switchId:id,junctionAt:anchor.id,groups:cs.filter(g=>g.switchId===id).map(g=>g.group),conductors:'L+两根受控L+PE，共4x2.5',conduit:m.standard?.selections.control?.conduit||'SC20',estimatedLengthM:lengthM,scope:'机械双联开关；电子开关需要N时重新审核。接线盒设置在图示J灯具接线处，标高3.0m→开关1.3m。'});
  }
  m.scene.entities.push({kind:'circle',layer:'E-CTRL',position:anchor.position.slice(),radius:70});text(m.sheets.find(s=>s.id===anchor.sheetId),anchor.position[0]-m.sheets.find(s=>s.id===anchor.sheetId).origin[0]-500,anchor.position[1]+450,'J',190,'E-CTRL');
  for(const w of rs)if(w.controlGroups.length)w.controlPipe={conductors:w.controlGroups.length+'根受控L+PE',sectionMm2:2.5,conduit:m.standard?.selections.control?.conduit||'SC20',type:'WDZN-BYJ',geometryLengthM:w.lengthMm/1000,scope:'与L/N/PE基础管分开敷设；同一交流支路的控制返回，非新增负荷回路'};
 }
 const power=m.circuits.filter(c=>c.system==='power'),schedules=m.sheets.filter(s=>s.title.startsWith('配电箱出线回路表'));
 for(const [i,c]of power.entries()){
  const leg=Math.max(0,...m.controlWiring.filter(w=>w.circuitId===c.id).map(w=>w.estimatedLengthM));c.controlExtraEquivalentM=leg;c.voltageDropEquivalentLengthM=c.estimatedLengthM+leg;
  c.voltageDropPercent=100*2*m.requirements.electrical.copperRhoOhmMm2M*c.voltageDropEquivalentLengthM*c.currentA/c.sectionMm2/m.requirements.electrical.phaseVoltage;c.totalDropPercent=m.calculations.mainDropPercent+c.feederDropPercent+c.voltageDropPercent;
  const sheet=schedules[Math.floor(i/20)],x=sheet?.origin[0]+46650,y=34000-600-(i%20+1)*850;
  const cell=m.scene.entities.find(p=>p.kind==='text'&&Math.abs(p.position[0]-x)<1e-4&&Math.abs(p.position[1]-y)<1e-4);if(cell)cell.text=String(Number(c.voltageDropPercent.toFixed(2)));
 }
 const before=m.routingComparisons.reduce((n,c)=>n+c.before.lengthM,0),after=m.routingComparisons.reduce((n,c)=>n+c.after.lengthM,0);
 const requiredInputs=[
  {id:'IN-01',sheets:'E-01～E-19',owner:'建设方/建筑及消防专业',materials:'项目所在地、审定建筑DWG、门窗/吊顶/梁/风口、层间及防火分区、楼梯类别、强弱电间净尺寸与设备检修空间',limit:'当前为自建测试底图；不得据此确定防火分区、探测覆盖或封闭楼梯完整竖向专用供电'},
  {id:'IN-02',sheets:'E-10、E-11、E-15～E-18',owner:'校园供配电专业/供电单位',materials:'供电点短路电流、源阻抗、接地型式、上级开关整定/曲线、允许容量、电源路由与长度、消防电源等级及切非边界',limit:'6kA为V02参考最低指标；不得视为实际分断、选择性、0.4s切断及消防电源可靠性已通过'},
  {id:'IN-03',sheets:'E-02～E-07、E-10～E-19',owner:'线缆/箱柜厂家及机电专业',materials:'导线外径、各线路敷设方式、环境温度、成束根数、谐波、耐火与燃烧等级及填充率；V02普通WDZ/WDZN差异审定',limit:'保持V02统一WDZN导线参考；Iz按模板独立管暗敷假设，控制线采用不小于模板五芯管径；非施工采购量'},
  {id:'IN-04',sheets:'E-02、E-03、E-06、E-07、E-18',owner:'普通/应急灯具及集中电源厂家',materials:'灯具IES/LDT及安装参数、UGR/均匀度/频闪检验；200W DC36V七输出产品认证、输出最低电压、2A保护、输入VA/冷启动、电池90min及回充性能',limit:'补充设备间应急灯，130W/200W；输入≤400VA/台为采购包络，C6馈线须启动校核；2A输出为系统性能要求，未认定存在某一具体成套产品'},
  {id:'IN-05',sheets:'E-08、E-09、E-12',owner:'校园消防/网络/广播厂家',materials:'原火警主机协议、剩余地址、隔离分段与返回线、声光供电与联动矩阵；校园光纤和机柜位置、PoE预算、广播功放及消防优先接口',limit:'FD仅逻辑接口分区，火警、数据、广播分别敷设；未把串接归属路径视为已验证总线闭环'},
  {id:'IN-06',sheets:'E-13、E-14、E-15',owner:'建筑/结构/防雷专业及建设方',materials:'项目地点雷电密度、建筑风险和屋面设备、滚球校核、土壤电阻率、结构钢筋连续性、接地系统最严阻值、SPD等级及后备保护配合',limit:'防雷接地为协调预留，SPD及其后备保护未伪造规格'},
  {id:'IN-07',sheets:'E-01～E-03',owner:'设计负责人',materials:'地方节能条文及计划交付日期；2026-11-01实施的GB7793-2025全文及适用性核对',limit:'当前日期按2010版及修改单登记；跨实施日必须重新审核'}
 ];
 const topics=m.sheets.map(s=>({sheetId:s.id,title:s.title,status:'模型核对完成；保留资料依赖',checks:s.id==='E-01'?['目录19张与命名视图一致','需求、版本与V02差异记录']:s.title.includes('照明及开关')?['V02灯具及两只双联开关/教室','a/b/c/d控制分组对应末端台账','矩形树接线、回路/相别/截面和压降联动']:s.title.includes('插座及')?['V02安全插座、A型30mA RCBO','教室沿墙布线与公共走廊干线','排风与插座独立']:s.title.includes('疏散指示平面')?['左右楼梯专用输出','走廊/教室/强弱电间独立功能分路','130W/200W与七路2A输出80%负载','末端方向与回路属性一致']:s.title.includes('火灾报警、信息')?['施工图补充图例6项来源','双口两缆、AP一缆和分离敷设通道','报警归属路径不伪造厂家闭环']:s.id==='E-10'?['主箱/馈线保护与接收隔离开关区分','总负荷及分相最大电流更新']:s.id==='E-11'?['18个交流末端与图面/CSV一致','V02截面、保护与累计压降更新']:s.id==='E-12'?['七路集中电源与逻辑弱电接口一致','消防/普通电源分开']:s.id==='E-13'?['防雷8处引下线及预留网格','分类和滚球列为IN-06']:s.id==='E-14'?['八处引下线接环线、N/PE分设与MEB双向连接','接地阻值不无依据承诺']:s.id==='E-19'?['图例及新增隔离图形溯源','V02型号差异保留审定记录']:['进线器件型号/订货参考/功能','馈线按上级过流保护选型，不以隔离Ie定截面','N/PE/相别与出线回路一致'],requiredInputs:requiredInputs.filter(i=>{const n=Number(s.id.slice(2));return i.id==='IN-01'||i.id==='IN-02'&&[10,11,15,16,17,18].includes(n)||i.id==='IN-03'&&n>=2||i.id==='IN-04'&&[2,3,6,7,18].includes(n)||i.id==='IN-05'&&[8,9,12].includes(n)||i.id==='IN-06'&&[13,14,15].includes(n)||i.id==='IN-07'&&n<=3;}).map(i=>i.id)}));
 m.review={version:'R3',scope:'逐张模型及来源核对；不替代建筑底图、产品试验和注册专业审查',routing:{method:'走廊干线+分区矩形最小生成树；插座同教室沿墙周边路径。几何相交不自动等同电气连接，连接以设备端口和回路图为准。',baseline:'相同修订需求按旧设备生成顺序串接；新增安全分区已同时纳入优化前后两组',beforeLengthM:Number(before.toFixed(3)),afterLengthM:Number(after.toFixed(3)),savedM:Number((before-after).toFixed(3)),savedPercent:Number(((before-after)/before*100).toFixed(2)),beforeBends:m.routingComparisons.reduce((n,c)=>n+c.before.bends,0),afterBends:m.routingComparisons.reduce((n,c)=>n+c.after.bends,0),notIncluded:'立面、端接、控制线及采购损耗；两缆信息点按条数另乘，跨回路交叉按绝缘分路敷设，不作接点'},closed:['补齐八处引下线到基础接地环线连接并统一应急箱消防图层','两只双联开关/教室独立编号及四组控制台账','18交流末端/14应急/12数据/4信号归属分开','楼梯及强弱电间应急分路，补4盏设备间应急灯，电源提升200W','双口信息插座两缆计量','全部8箱进线器件规格与功能；普通楼层采用上级C20保护+本箱40A隔离，省去同级串联MCB','V02管径及载流量来源可追溯，未越界套用消防产品数据'],requiredInputs,sheets:topics};
 for(const s of m.sheets){for(const p of m.scene.entities.filter(p=>p.kind==='text'&&p.position[0]>=s.origin[0]&&p.position[0]<s.origin[0]+59400)){
  p.text=p.text.replace(/版本 R2（V02标准）/g,'版本 R3（逐张校核）').replace('连线为回路示意路径；SC20暗敷，控制支线需按分组增加开关线。','接线采用走廊干线/室内分支；控制线及管径详见控制台账。').replace('实线回路路径；紫色控制关系；图块属性保存设备号、型号、房间和回路。','实线标回路归属；紫色a/b/c/d标控制组；交叉不连接，分支于灯具接线盒。').replace('各教室三列分控、黑板独控','各教室窗侧/中间/内侧三带分控、黑板独控').replace('RCBO 1P+N','RCBO 2P').replace('进线保护：4P-C20A','进线隔离：4P-40A').replace('网络为星形Cat6','网络为星形Cat6（双口两缆）');
 }
 if(s.title.includes('消防应急照明与疏散指示平面')){const cs=m.circuits.filter(c=>c.floor===Number(s.title[0])&&c.system==='emergency');text(s,6000,16400,cs.slice(0,4).map(c=>`${c.id} ${c.area} ${c.watts}W`).join('；'),215);text(s,6000,15500,cs.slice(4).map(c=>`${c.id} ${c.area} ${c.watts}W`).join('；'),215);}
 if(s.title.includes('照明及开关')){text(s,6000,8500,'每教室2只双联机械开关；a窗侧/b中间/c内侧/d黑板，三相回路不共N。',250);text(s,6000,7700,'J为灯具接线盒；基础管L/N/PE，受控返回最多4L+PE另穿SC20，开关腿4芯。',240);}
 if(s.id==='E-10'){for(const p of m.scene.entities.filter(p=>p.kind==='text'&&p.position[0]>s.origin[0]&&p.position[0]<s.origin[0]+59400&&/^4P 20A$/.test(p.text)))p.text='4P 40A隔离';text(s,4500,9800,'楼层接收箱iSW-40A隔离；5x4馈线由AP0内C20保护，40A不作电缆保护整定。',250);}
 if([8,9].includes(Number(s.id.slice(2))))text(s,6000,8500,'FD为分区逻辑接口，火警端子/数据机柜/广播端子分置；双口每点A、B两缆。',250);
 }
 const phase=Object.values(m.calculations.phaseDemandWatts);m.calculations.phaseImbalancePercent=Number(((Math.max(...phase)-Math.min(...phase))/(phase.reduce((a,b)=>a+b)/3)*100).toFixed(2));
 return m;
}
