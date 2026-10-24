// Known synthetic physical conditions plus an existing source-bound public
// product. No final design or hospital drawing is used to construct this seed.
import {engineeringTestInput} from './engineering-input.mjs';
import crypto from 'node:crypto';
export const standardConditionCarry='保留所给建筑净边界、门口、工作面、光源文件、灯具和供电参数及假设等级；标准版本与数值子集按冻结记录延续，所有未证实条件仍待审。';
export function standardConditionCase({profile,profileSHA256,product,iesFile,iesSHA256}){
 const p=engineeringTestInput();p.intakeMode='conditions_only';p.title='尚未解释的条件标准基线';p.designDate='2025-09-01';p.brief=standardConditionCarry;p.scope='Only the declared synthetic ordinary circulation zone is available; project original requirements are interpreted separately.';
 p.rooms=[{...p.rooms[0],id:'ZONE',name:'附属交通空间',use:'unknown',polygon:[[0,0],[16000,0],[16000,2000],[0,2000]],doors:[[1000,0]],workplaneM:0}];p.architecture=[{kind:'polyline',points:p.rooms[0].polygon,closed:true}];delete p.requirements;
 p.sources=[{...p.sources[0],sha256:crypto.createHash('sha256').update(p.brief).digest('hex')},{id:'CATALOG',role:'catalog',sha256:iesSHA256,description:'Previously source-bound public manufacturer IES; project product acceptance and full quality remain pending',derivedFromFinalDrawing:false},...profile.sources.map((s,i)=>({id:'STD_'+i,role:'standard',sha256:s.sha256,description:'Imported inspected edition '+s.code+' '+s.edition+'; actual project applicability remains pending',location:s.url,derivedFromFinalDrawing:false}))];
 p.luminaires=[{...product,id:'PRODUCT',sourceId:'CATALOG',iesFile:{file:iesFile,sha256:iesSHA256}}];p.standards=profile.sources.map((s,i)=>({id:'BOOK_'+i,code:s.code,edition:s.edition,effectiveFrom:s.effectiveFrom,...(s.effectiveUntil?{effectiveUntil:s.effectiveUntil}:{}),sourceId:'STD_'+i,clauses:[]}));p.lightingStandards={profileId:profile.id,expectedProfileSHA256:profileSHA256};p.photometricDesign={method:'ies_direct_point',gridSpacingM:.5,edgeOffsetM:.5,boundaryModel:'opaque_vertical_room_walls'};
 p.missingInputs=[{id:'SITE_AUTHORITY',description:'Independent actual architecture and factual project/site authority are not supplied; this is a synthetic software-use trial',severity:'review',sourceIds:['BRIEF']},{id:'FULL_QUALITY',description:'Direct-point subset only; reflected light, daylight, room UGR, actual product suitability and professional standard/installation approval remain pending',severity:'review',sourceIds:['BRIEF','CATALOG']}];return p;
}
export function standardConditionBrief(confirmed=false){return [
 '标准条件与普通交通空间验证',
 '本次只委托一个声明交通空间的普通照明待审方案；不含诊疗、应急、消防或其他专业施工设计。',standardConditionCarry,
 '所给ZONE空间仅供普通通行，不是工作间、会议室或诊疗间；设计日期为2025年9月1日。',
 '委托要求对照本机导入的医疗建筑走廊候选类别；是否适用须依据原文事实，不根据项目名、文件名或表名推定。',
 confirmed?'本轮补充现已确认：项目属于医疗建筑；原来未确定的建筑功能至此得到明确原文说明，所给ZONE仍仅为附属交通空间。':'目前尚不能确认项目建筑功能；没有依据断定它是否属于医疗建筑，必须将建筑功能事实保持未知。',
 '项目要求：平均维持照度至少80lx且最多200lx，均匀度Emin/Eavg至少0.40，功率密度最多8W/m2；适用标准更严时保留这些原值并取有效交集，不降低标准或改写项目要求。',
 '灯具间距最多3m，单回路最多12盏、最多1000W，估算压降最多3个百分点；安装高度3m，区域集中并手动控制。',
 '光度源为所给公开厂家IES，不能把它当作现场光学、眩光或产品专业批准；各项冻结假设和缺项均延续。',
 '只读条件判断、几何自检、点照度计算及可打开图纸都不证明全部规范合规，所有成果等待人工专业审核。'
 ].join('\n');}
