import {rectContains,rectOverlap} from './planning-geometry.mjs';
export function auditAssetProjection(model){
 if(!model.input.assets?.length)return [];
 const checks=[],add=(id,ok)=>checks.push({id,ok:!!ok}),p=model.input;
 for(const s of model.sheets.filter(s=>['SP02','SP03'].includes(s.id))){const offset=[s.origin[0]+s.planOffset[0]+1000-p.shell.rect.min[0],s.planOffset[1]+1000-p.shell.rect.min[1]],polygon=r=>[[r.min[0],r.min[1]],[r.max[0],r.min[1]],[r.max[0],r.max[1]],[r.min[0],r.max[1]]].map(q=>q.map((v,i)=>v+offset[i]));
  for(const room of model.plan.rooms)for(const a of room.assets??[]){
   for(const [layer,rect]of [['A-ASSET',a.rect],...(s.id==='SP03'?[['A-ASSET-CLEAR',a.clearRect]]:[])]){const expected=polygon(rect);add('asset_projection_'+s.id+'_'+layer+'_'+a.id,model.scene.entities.filter(e=>e.kind==='polyline'&&e.layer===layer&&e.closed&&e.points.length===4&&e.points.every((q,i)=>expected[i].every((v,j)=>Math.abs(v-q[j])<1e-6))).length===1);}
   const tags=model.placements.filter(t=>t.id===s.id+'_ASSET_'+a.id),tag=tags[0];add('asset_tag_'+s.id+'_'+a.id,tags.length===1&&tag.symbol==='SP_ASSET_TAG'&&tag.position.slice(0,2).every((v,i)=>Math.abs(v-a.rect.min[i]-offset[i])<1e-6)&&tag.attributes.ASSET_ID===a.id&&tag.attributes.SPACE_ID===room.id&&tag.attributes.ORIENTATION===String(a.orientationDegrees)&&tag.attributes.FIXED===String(a.fixed)&&tag.attributes.SOURCE_SHA===model.inputSHA256);
  }
 }
 if((model.sceneVersion??1)>=7){const labels=model.assetLabelBounds??[];add('asset_room_label_coverage',labels.length===p.program.length&&p.program.every(r=>labels.filter(b=>b.roomId===r.id&&b.sheet==='SP02').length===1));
 for(const b of labels){const room=model.plan.rooms.find(r=>r.id===b.roomId),sheet=model.sheets.find(s=>s.id===b.sheet),offset=sheet?[sheet.origin[0]+sheet.planOffset[0]+1000-p.shell.rect.min[0],sheet.planOffset[1]+1000-p.shell.rect.min[1]]:[];add('asset_room_label_clear_'+b.roomId,room&&rectContains(room.rect,b.rect)&&!(room.assets??[]).some(a=>rectOverlap(a.clearRect,b.rect))&&!rectOverlap(room.furniture.doorClear,b.rect)&&b.positions.every(t=>model.scene.entities.filter(e=>e.kind==='text'&&e.text===t.text&&e.height===t.size&&t.position.every((v,i)=>Math.abs(v+offset[i]-e.position[i])<1e-6)).length===1));}
 }
 const table=model.sheets.filter(s=>/^SP06(?:-|$)/.test(s.id)).map(s=>model.scene.entities.filter(e=>e.kind==='text'&&e.position[0]>=s.region.min[0]&&e.position[0]<=s.region.max[0]).map(e=>e.text).join('')).join('');
 for(const a of p.assets)add('asset_schedule_'+a.id,table.includes('['+a.id+'] / '+a.roomId)&&table.includes(a.widthMm+' x '+a.depthMm));
 return checks;
}
