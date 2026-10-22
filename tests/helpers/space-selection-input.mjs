// Known public synthetic sources only. Expected values stay outside client files.
import crypto from 'node:crypto';import {spaceNaturalInput} from './space-natural-input.mjs';
export function spaceSelectionInput(caseId='positive'){
 if(!['positive','conflict'].includes(caseId))throw Error('UNKNOWN_SELECTION_CASE');
 const f=spaceNaturalInput(),slot='本次项目的选案顺序和面积界限须从原文解释；尚未解释时保持阻断，不能沿用内置评分。';f.baseline.selection={method:'lexicographic',criteria:[],limits:[],sourceIds:['BRIEF'],status:'unresolved',evidenceQuote:slot};f.baseline.brief+='\n'+slot;f.baseline.sources.find(s=>s.role==='brief'&&!s.supersededBy).sha256=crypto.createHash('sha256').update(f.baseline.brief).digest('hex');
 const text=`这是合成开发项目的新增选案要求，只增加选案顺序和项目界限，不替换MAIN的房间程序、COORD的人数调整或ARCH的冻结条件；不构成任何标准或专业批准。
在满足全部原面积范围、席位、关系、窗接触和路径上限后，第一优先缩短最远房门到场地入口的走廊路径；第一项相同时，第二优先缩短十个房门到入口路径的总和；前两项相同时，第三优先接近各房间声明的倾向面积，以绝对偏差之和越小越好。这三项按所列先后比较，不用自选权重互相抵消。
项目同时要求：房间净面积合计至少0.03公顷，走廊净面积至多0.006公顷，隔墙和门槛合计占地至多20平方米。这里的面积指本次已声明矩形几何子集，不能解释为消防、无障碍、机电或施工认可。${caseId==='conflict'?'\n另有一条同时有效、未说明替代关系的项目界限：房间净面积合计不得超过250平方米。这条界限与上述最低净面积要求之间没有已授权的取代结论。':''}`;
 f.documents.push({id:'SELECT',title:'合成项目选案顺序与界限',versionLabel:caseId==='positive'?'P1':'C1',role:'coordination',text});
 f.oracle.selection={method:'lexicographic',criteria:[{metric:'maximum_entry_route_mm',direction:'minimize'},{metric:'total_entry_route_mm',direction:'minimize'},{metric:'area_preference_deviation_m2',direction:'minimize'}],limits:[{metric:'net_room_area_m2',comparison:'at_least',value:300},{metric:'circulation_area_m2',comparison:'at_most',value:60},{metric:'partition_and_threshold_area_m2',comparison:'at_most',value:20},...(caseId==='conflict'?[{metric:'net_room_area_m2',comparison:'at_most',value:250}]:[])]};return f;
}
