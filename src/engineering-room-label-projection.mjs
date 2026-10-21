// Drawing-only projection: physical model, calculation and input bytes unchanged.
import {engineeringDigest} from './engineering-design.mjs';
import {layoutEngineeringAnnotations} from './engineering-annotation-layout.mjs';
export function projectEngineeringRoomLabels(model,sourceScene=model.scene){
 const scene=structuredClone(sourceScene),labels=[],changes=[];
 for(const [i,room]of model.input.rooms.entries()){
  const code='R'+String(i+1).padStart(2,'0'),full=room.name+' ['+room.id+']',width=Math.max(...room.polygon.map(p=>p[0]))-Math.min(...room.polygon.map(p=>p[0]))-300;
  for(const sheet of model.sheets.filter(s=>['E02','E03'].includes(s.id))){const matches=scene.entities.filter(e=>e.kind==='text'&&e.text===full&&e.position[0]>=sheet.region.min[0]&&e.position[0]<=sheet.region.max[0]);if(matches.length!==1)throw Error('DELIVERY_ROOM_LABEL_ANCHOR_MISMATCH');const old=matches[0],h=old.height;if(width<h*2)throw Error('DELIVERY_ROOM_LABEL_CLEAR_WIDTH_REQUIRED');const parts=[code];changes.push({sheet:sheet.id,roomId:room.id,from:full,to:parts});scene.entities.splice(scene.entities.indexOf(old),1,...parts.map((text,k)=>({...old,text,position:[old.position[0],old.position[1]-k*h*1.6,old.position[2]]})));}
  const rows=scene.entities.filter(e=>e.kind==='text'&&e.text.startsWith(full+' | ')&&model.sheets.some(s=>(s.id==='E05'||s.id.startsWith('E05-'))&&e.position[0]>=s.region.min[0]&&e.position[0]<=s.region.max[0]));if(rows.length!==1)throw Error('DELIVERY_ROOM_SCHEDULE_ANCHOR_MISMATCH');rows[0].text=code+' '+rows[0].text;labels.push({code,roomId:room.id,name:room.name});
 }
 const sheet=model.sheets.find(s=>s.id==='E01');if(!sheet)throw Error('DELIVERY_ROOM_LEGEND_SHEET_REQUIRED');scene.entities.push({kind:'text',layer:'E-TEXT',position:[sheet.origin[0]+1500,2500,0],height:230,rotationRadians:0,text:'平面R编号对应E05同号条目；完整房间名/ID保留在清单及源JSON/CSV，未选空间不在本照明范围。'});
 const annotations=layoutEngineeringAnnotations(model,scene,labels);
 return {scene,manifest:{schemaVersion:2,sourceModelSHA256:engineeringDigest(model),sourceSceneSHA256:engineeringDigest(sourceScene),sceneSHA256:engineeringDigest(scene),labels,changes,annotations,scope:'Plan identifiers, annotation positions/leaders, schedule prefixes and legend only; physical design/calculation/source unchanged',professionalApproval:false}};
}
