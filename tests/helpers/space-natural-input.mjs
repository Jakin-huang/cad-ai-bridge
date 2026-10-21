// Synthetic source-assisted development task. No customer data or final plan.
// Oracle is for the independent controller only, never a client-readable file.
import {spaceTestInput,planningBrief} from './space-input.mjs';
export function spaceNaturalInput(){
 const baseline=spaceTestInput(),logical=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!['sourceIds','status','evidenceQuote'].includes(k))),oracle={program:baseline.program.map(logical),relations:baseline.relations.map(logical)};oracle.program.find(r=>r.id==='OFFICE_A').occupants=6;
 baseline.projectId='OFFICE_NATURAL';baseline.title='合成设计机构办公方案';baseline.designDate='2026-10-22';baseline.program=baseline.program.map(r=>({...r,occupants:r.activity==='unfurnished'?0:1,minAreaM2:12,maxAreaM2:28,preferredAreaM2:16,minWindowMm:0,maxEntryRouteMm:100000}));baseline.relations=[];baseline.missingInputs=[{id:'SITE_REVIEW',description:'Independent customer brief and authoritative architectural/site conditions are unavailable; all shell coordinates are synthetic declared development conditions',severity:'review',sourceIds:['BRIEF','SHELL']},{id:'CODE_REVIEW',description:'Professional fire safety, accessibility, daylight, acoustic and other applicable code review remains unverified; no numerical standards inferred',severity:'review',sourceIds:['BRIEF']},{id:'CONSTRUCTION_REVIEW',description:'Structure, ceiling, mechanical/electrical services, actual doors/windows and construction/installation details require independent professional coordination',severity:'review',sourceIds:['BRIEF','SHELL']}];planningBrief(baseline);
 const documents=[{id:'MAIN',title:'合成空间任务书',versionLabel:'R1',role:'requirements',text:`合成设计机构办公方案任务书 R1。以下全部为开发者构造的普通办公需求，既不是客户资料，也不是已经通过审查的规范。场地内部净边界、入口、窗锚段、保留构件及设计参数按随附 baseline 的冻结条件沿用；保持原有假设等级、空标准表和全部待审项目，不把这些声明变成权威现场条件。
本次房间程序完整替代种子中的旧面积和人数逻辑；种子不是本次需求的答案。保留各空间固定 ID，名称及活动类型如下，家具表示平面意图。
RECEPTION（接待工作间）采用工作位布置，2个席位；净面积下限0.002公顷、上限0.003公顷，倾向25平方米；从场地入口到该房门的走廊路径不得超过6米。
MEETING（会议室）安排8个会议席位；净面积48至64平方米，倾向54平方米。
TEAM（团队办公室）安排6个工作位；净面积48至60平方米，倾向52平方米。
OFFICE_A（办公室甲）先按4个工作位；净面积32至42平方米，倾向36平方米。
OFFICE_B（办公室乙）安排4个工作位；净面积32至42平方米，倾向36平方米。
MANAGER（管理办公室）安排2个工作位；净面积20至28平方米，倾向24平方米。
FOCUS（专注工作间）安排2个工作位；净面积18至26平方米，倾向22平方米。
SUPPORT（辅助空间）不设计家具或席位，席位数为零；净面积12至18平方米，倾向15平方米。
ARCHIVE（资料空间）不设计家具或席位，席位数为零；净面积16至24平方米，倾向20平方米。
TRAINING（小组讨论室）安排6个会议席位；净面积36至50平方米，倾向43平方米。
所有空间的最小沿走廊面宽为1.8米，最小进深为2.4米。除不配置家具的SUPPORT和ARCHIVE不要求窗接触宽度外，其余八个空间均要求至少0.8米窗接触宽度。RECEPTION使用上述6米入口路径上限，其他九个空间上限均为100米。这些都是声明的项目几何要求，不代表采光或疏散合格。
关系AB：OFFICE_A与OFFICE_B至少共墙3米；关系MT：MEETING与TEAM至少共墙3米；关系RM：RECEPTION与MANAGER两房门之间的走廊路径至多10米。三项关系均须保留，不能只保留一个。
协调文件若逐项明确替换某一人数，只改变该项；本任务书其余人数、面积、活动类型、窗、路径和关系继续有效。`},
 {id:'COORD',title:'合成局部人数协调',versionLabel:'C1',role:'coordination',text:'本通知是合成开发场景中明确有效的局部协调。仅替换MAIN R1中OFFICE_A（办公室甲）的4个工作位，改为6个工作位。办公室甲的面积范围、倾向面积、活动类型、窗接触宽度、面宽、进深、路径及关系AB全部按MAIN原文保持；MAIN其余空间和所有关系仍有效，不退役整份任务书。'},
 {id:'ARCH',title:'合成场地与冻结参数说明',versionLabel:'A1',role:'architecture_notes',text:'场地仅为开发者声明的24000毫米乘18000毫米内部净矩形，入口位于西侧沿边偏移9000毫米，净宽1000毫米；北、南立面各有六个已给窗锚段，另有一个已给保留构件。具体坐标和各窗段按baseline所列原值逐项保留。隔墙、走廊、门、家具及净空参数保持baseline已给数值；这些参数仍为assumed开发假设，不是已认证规范或施工尺寸。来源身份及原有待补保留，不能从任何成图提取分隔方案。'},
 {id:'STD_NOTE',title:'合成标准与审核边界',versionLabel:'S1',role:'standard_excerpt',text:'本开发任务没有已核验的适用标准条文或真实工程批准记录。保持standards空表，消防、无障碍、采光、声学、结构、机电和施工协调继续待专业审核；不得自动编造标准编号、法定尺寸、签审结论或实际项目权威性。几何自检通过也只是当前已实现的子集。'}];
 return {baseline,documents,oracle};
}
