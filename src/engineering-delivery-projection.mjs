import crypto from 'node:crypto';
import {engineeringDigest} from './engineering-design.mjs';
import {auditLightingQuality} from './lighting-quality.mjs';

// Presentation of an already audited result. The canonical design and optical
// report retain their identities; this scene is independently bound and read back.
export function buildEngineeringDeliveryProjection(model,{modelSHA256,qualityReportBytes,qualityReportSHA256,ugrMethod}={}){
 if(engineeringDigest(model)!==modelSHA256)throw Error('DELIVERY_PROJECTION_MODEL_CHANGED');
 if(!Buffer.isBuffer(qualityReportBytes)||crypto.createHash('sha256').update(qualityReportBytes).digest('hex')!==qualityReportSHA256)throw Error('DELIVERY_PROJECTION_QUALITY_CHANGED');
 const quality=JSON.parse(qualityReportBytes.toString('utf8'));
 if(!auditLightingQuality(model,quality,{ugrMethod}).ok)throw Error('DELIVERY_PROJECTION_QUALITY_FAILED');
 const scene=structuredClone(model.scene),changes=[];
 function replaceAt(sheet,x,y,expected,replacement,height){
  const matches=scene.entities.filter(e=>e.kind==='text'&&e.position[0]===sheet.origin[0]+x&&e.position[1]===y);
  if(matches.length!==1||matches[0].text!==expected)throw Error('DELIVERY_PROJECTION_ANNOTATION_MISMATCH');
  changes.push({position:[...matches[0].position],from:expected,to:replacement});matches[0].text=replacement;if(height)matches[0].height=height;
 }
 const rows=[];
 for(let offset=0;offset<model.roomCalculations.length;offset+=24){
  const id=offset?'E05-'+(offset/24+1):'E05',sheet=model.sheets.find(s=>s.id===id);if(!sheet)throw Error('DELIVERY_PROJECTION_SHEET_MISSING');
  replaceAt(sheet,1500,22200,'房间 | 灯具数 | 维持平均lx/目标lx | W/m2 | 灯具型号','空间 | 数量 | 维持总平均lx/范围 | U0/下限 | 参考UGR/上限 | W/m2/上限',240);
  model.roomCalculations.slice(offset,offset+24).forEach((calc,i)=>{
   const room=model.input.rooms.find(r=>r.id===calc.roomId),summary=quality.rooms.find(r=>r.roomId===calc.roomId).summary,observers=quality.ugr?.rooms.find(r=>r.roomId===calc.roomId)?.observers,ugr=observers?Math.max(...observers.map(o=>o.result.conservativeUgr)):undefined,limit=observers?Math.min(...observers.map(o=>o.result.maximumUgr)):undefined;
   const row={roomId:calc.roomId,count:calc.count,averageLux:summary.averageLux,minimumLux:summary.minimumLux,uniformity:summary.uniformity,targets:summary.targets,referenceUgr:ugr,maximumUgr:limit,lpd:calc.lpd,maximumLpd:calc.maxLpd};rows.push(row);
   const original=`${room.name} [${calc.roomId}] | ${calc.count} | ${(calc.photometry?.averageLux??calc.estimatedLux).toFixed(1)}/${calc.targetLux} | ${calc.lpd.toFixed(2)} | ${calc.fixture}`;
   const updated=`${room.name} [${calc.roomId}] | ${calc.count} | ${row.averageLux.toFixed(1)}/${row.targets.minimumLux}..${row.targets.maximumAverageLux} | ${row.uniformity.toFixed(3)}/${row.targets.minimumUniformity.toFixed(3)} | ${ugr===undefined?'未请求':ugr.toFixed(2)+'/'+limit} | ${row.lpd.toFixed(2)}/${row.maximumLpd.toFixed(2)}`;
   replaceAt(sheet,1500,21200-i*700,original,updated,230);
  });
  replaceAt(sheet,1500,3500,'本表为IES直射点源维持照度；详细Emin/Eavg见计算CSV；反射、眩光和实际条件待审。','本表为冻结条件下有限光源及漫反射总照度；UGR仅所请求的参考条件。直射诊断另附CSV，现场及专业审核待审。',220);
  for(const [y,label,sha]of [[2700,'模型',modelSHA256],[2200,'复核报告',qualityReportSHA256]])scene.entities.push({kind:'text',layer:'E-TEXT',position:[sheet.origin[0]+1500,y,0],height:170,rotationRadians:0,text:label+' SHA256 '+sha});
 }
 // Retire the wrapped E01 wording that described the original diagnostic table.
 const from=model.lightingDesignBasis==='finite_diffuse_required'?'设计方法：总照度与已请求的UGR复核选择候选布局；图中计算表保留直射口径，完整复核另附报告。':'设计方法：IES直射点源计算选择网格；维持照度Eavg、Emin/Eavg及上限约束。无反射光、日光或UGR验收。';
 if(model.input.photometricDesign){
  const chunks=[];for(let i=0;i<from.length;){let end=Math.min(i+65,from.length);if(/[A-Za-z0-9_.]/.test(from[end-1]??'')&&/[A-Za-z0-9_.]/.test(from[end]??'')){const space=from.lastIndexOf(' ',end);if(space>i+20)end=space+1;else while(end<from.length&&/[A-Za-z0-9_.]/.test(from[end]))end++;}chunks.push(from.slice(i,end));i=end;}
  for(const [i,text]of chunks.entries()){const matches=scene.entities.filter(e=>e.kind==='text'&&e.text===text);if(matches.length!==1)throw Error('DELIVERY_PROJECTION_METHOD_NOTE_MISMATCH');const replacement=i===0?'设计方法：总照度与已请求的UGR复核选择布局；E05展示冻结复核结果，直射诊断另附CSV。':'参考条件、实际安装及标准适用性仍待专业审核。';changes.push({position:[...matches[0].position],from:text,to:replacement});matches[0].text=replacement;}
 }
 return {scene,manifest:{schemaVersion:1,kind:'audited_quality_annotation_projection',sourceModelSHA256:modelSHA256,qualityReportSHA256,sceneSHA256:engineeringDigest(scene),rows,changes,scope:'Presentation only. Canonical model, placements, circuits, sheets, source data and physical settings are unchanged. Reference UGR and diffuse enclosure subset are not professional project approval.',professionalApproval:false}};
}
