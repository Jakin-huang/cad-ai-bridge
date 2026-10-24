import crypto from 'node:crypto';
import {spaceTestInput,planningBrief} from './space-input.mjs';
// Declared development geometry/inventories, never actual site information.
// Project type changes the input data only; it never selects a solver branch.
export function planningAssetsInput(type='office'){
 const p=spaceTestInput(),labels={hospital:['医院后勤协作测试','后勤工作间','一般物资间','讨论间','资料间'],school:['学校支持空间测试','教师工作间','教学用品间','研讨间','资料间'],office:['办公设施测试','团队工作间','设备辅助间','会议间','档案间']}[type];if(!labels)throw Error('Unknown development case');
 p.projectId='ASSET_'+type.toUpperCase();p.title=labels[0];p.designDate='2026-10-24';p.shell.rect.max=[18000,14000];p.shell.entry.offsetMm=7000;p.shell.windows=[];p.shell.keepouts=[];p.parameters.maxUnassignedAreaM2=30;
 p.program=['WORK','SUPPORT','MEETING','ARCHIVE'].map((id,i)=>({id,name:labels[i+1],activity:i===0?'workstations':i===2?'meeting':'unfurnished',occupants:i===0?4:i===2?6:0,minAreaM2:40,maxAreaM2:65,preferredAreaM2:52,minWindowMm:0,maxEntryRouteMm:100000,minFrontageMm:3000,minDepthMm:4000,sourceIds:['BRIEF'],status:'interpreted',evidenceQuote:'placeholder'}));p.relations=[];
 const asset=(id,roomId,name,widthMm,depthMm,extra={})=>({id,roomId,name,widthMm,depthMm,orientations:[0,90,180,270],clearances:{frontMm:600,backMm:0,leftMm:0,rightMm:0},minFrontAccessMm:500,sourceIds:['BRIEF'],status:'assumed',evidenceQuote:'placeholder',...extra});
 p.assets=[asset('RETAIN','ARCHIVE','保留资料柜',1200,600,{fixed:{position:[1000,3900],orientationDegrees:180},sourceIds:['BRIEF','SHELL']}),asset('PRINTER','WORK','共享打印设备',type==='school'?800:600,600),asset('CABINET','SUPPORT','储物柜',type==='hospital'?1500:1200,500),asset('BENCH','SUPPORT','普通工作台',1800,type==='school'?800:700),asset('DISPLAY','MEETING','会议辅助柜',1000,400),asset('FILES','ARCHIVE','新增资料柜',1000,500)];
 p.sources.find(s=>s.id==='SHELL').sha256=crypto.createHash('sha256').update(JSON.stringify(p.shell)).digest('hex');
 return planningBrief(p);
}

export function planningAssetsNaturalInput(type){
 const baseline=planningAssetsInput(type),logical=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!['sourceIds','status','evidenceQuote'].includes(k))),oracle={program:baseline.program.map(logical),relations:[]},title=baseline.title;
 const lines=baseline.program.map(r=>r.id+'（'+r.name+'）采用'+(r.activity==='workstations'?'工作位':r.activity==='meeting'?'会议座位':'不布置自动桌椅')+'，'+r.occupants+'席；净面积40至65平方米，倾向52平方米；沿走廊面宽至少3米，进深至少4米；不要求窗接触，入口几何路径上限100米。');
 baseline.title='尚未审阅的开发基线';baseline.intakeMode='conditions_only';baseline.program=[];baseline.relations=[];planningBrief(baseline);
 const inventory=baseline.assets.map(a=>a.evidenceQuote).join('\n'),parameters=baseline.parameters.evidenceQuote;
 const documents=[{id:'MAIN',title:'声明的开发任务书',versionLabel:'R1',role:'requirements',text:title+'。\n本次设计声明的四个支持空间及物品平面布置，使用给定矩形壳与原物理参数，不代表真实医院、学校或客户工程。\n'+lines.join('\n')+'\n本次没有新增房间关系；原物品数量、所属空间、尺寸、净空、朝向许可及固定坐标逐项保留，不能以说明代替放置。\n所有设备性能、现场条件、消防无障碍、机电、标准适用性与专业审核保持待审，不得自动签审。'},
 {id:'ARCH',title:'声明的物理条件及物品清单',versionLabel:'A1',role:'architecture_notes',text:'全部为开发者声明条件，并非实测或权威标准。净边界18000乘14000毫米，西入口沿边偏移7000毫米且净宽1000毫米，无窗或保留结构柱；原参数及物品的assumed等级保留。参数及清单按下列原值冻结，不生成或引用最终分隔布局。\n'+parameters+'\n'+inventory},
 {id:'STD_NOTE',title:'开发验证与审核边界',versionLabel:'S1',role:'standard_excerpt',text:'本次没有核验适用的真实规范条文；standards空表和全部missingInputs保留。设备只核对本体平面、声明净空和正面通道接触宽度；不证明性能、负荷、给排水、电气接口、完整维护路径或临床教学适用性。'}];
 return {baseline,documents,oracle};
}
