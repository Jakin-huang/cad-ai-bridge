// Different declared engineering problems. Synthetic regression only, no customer/standards acceptance.
import crypto from 'node:crypto';
import {engineeringTestInput} from './engineering-input.mjs';
import {frontageInput} from './planning-frontage.mjs';
export function agentScenario(type){
 if(type==='office')return {type,kind:'office-space-planning',parameters:{input:frontageInput()},designBudget:{maxNodes:30000,maxMilliseconds:5000,maxPlans:1,corridorMode:'allow_single_sided'}};
 const p=engineeringTestInput(),hospital=type==='hospital';if(!hospital&&type!=='school')throw Error('Unknown development scenario');
 p.title=hospital?'医院普通附属空间-声明条件验证':'学校教学与教研空间-声明条件验证';p.projectId='SHARED_IDS';
 p.brief=hospital?'开发声明条件：仅医院员工工作间及相邻交通空间的普通照明。员工工作间300lx、交通空间100lx，交通空间分区手动控制。医疗、应急、消防和专业标准适用性未提供，不在已验证范围。':'开发声明条件：教学空间及教研工作间的普通照明。教学空间500lx并采用区域手动控制，工作间300lx并采用就地控制。黑板垂直照明、眩光、光度及教学专业标准未提供，不在已验证范围。';p.scope=p.brief;
 const rows=hospital?[['ROOM','员工工作间','office',0,0,6000,4000,300,'local'],['CIRC','交通空间','corridor',0,5000,12000,2000,100,'regional_manual']]:[['ROOM','教学空间','teaching',0,0,12000,7000,500,'regional_manual'],['WORK','教研工作间','office',13000,0,6000,4000,300,'local']];
 const base=p.rooms[0],template=p.requirements;p.rooms=rows.map(([id,name,use,x,y,w,h])=>({...base,id,name,use,polygon:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]],doors:[[x+1000,y]]}));
 p.requirements=rows.flatMap(([id,,,,,,,target,control])=>template.map((r,i)=>({...r,id:id+'_'+i,roomIds:[id],value:r.rule==='target_lux'?target:r.rule==='control_mode'?control:r.value,rationale:'Explicit synthetic development condition; no professional authority claim',status:'assumed'})));
 p.architecture=p.rooms.map(r=>({kind:'polyline',points:r.polygon,closed:true}));p.standards=[];
 p.sources[0]={...p.sources[0],sha256:crypto.createHash('sha256').update(p.brief).digest('hex'),description:'Synthetic independent scenario declaration, not a real customer brief'};
 p.missingInputs=[{id:'PROFESSIONAL_REVIEW',description:hospital?'Clinical, emergency, fire and actual source/standards applicability remain unverified':'Blackboard-plane quality, glare, real photometry and school standard applicability remain unverified',severity:'review',sourceIds:['BRIEF']}];
 return {type,kind:'ordinary-lighting',parameters:{action:'prepare',project:p}};
}
