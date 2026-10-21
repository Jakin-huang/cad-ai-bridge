// Developer-only amendment authoring. It does not infer a client's use/values.
import crypto from 'node:crypto';
import {lightingBinding} from './shared-spaces.mjs';
import {spaceScopeConditions,spaceScopeDelta} from '../../src/space-scope-decisions.mjs';
import {engineeringInputSchema} from '../../src/engineering-contracts.mjs';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const literal=v=>JSON.stringify(canonical(v));
const sha=s=>crypto.createHash('sha256').update(s,'utf8').digest('hex');
export function scopeRevisionInput(before,pack,ref,{uses,targets={},briefId='BRIEF_SCOPE_R1',spaceId='SPACE_SCOPE_R1'}={}){
 const p=structuredClone(before),oldBrief=p.sources.find(s=>s.role==='brief'&&!s.supersededBy),oldSpace=p.spaceProgram.sourceId,selected=Object.keys(uses),binding=lightingBinding(pack,ref,selected,spaceId);
 for(const r of binding.rooms){r.use=uses[r.roomId];r.reason='Known developer explicitly proposes '+r.roomId+' as '+r.use+' for the selected lighting scope in the new brief; source programme and professional applicability still require review, with no automatic classification by room name';}
 for(const key of ['spaceProgramChanges','architecturalChanges','briefRevision','sourceCarryForwards','functionalIntake'])delete p[key];
 p.sources=p.sources.map(s=>s.id===oldBrief.id?{...s,supersededBy:briefId}:s.id===oldSpace?{...s,supersededBy:spaceId}:s);
 p.sources.push({id:briefId,role:'brief',sha256:'a'.repeat(64),description:'Complete explicit developer amendment; no client or normative authority',derivedFromFinalDrawing:oldBrief.derivedFromFinalDrawing,supersedes:oldBrief.id},{id:spaceId,role:'architecture',sha256:ref.sha256,description:'Current generated upstream proposal; selected scope/use explicitly amended',derivedFromFinalDrawing:pack.derivedFromFinalDrawing,supersedes:oldSpace});
 const rebind=value=>{if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(rebind);return;}if(value.sourceId===oldBrief.id)value.sourceId=briefId;if(value.sourceIds)value.sourceIds=value.sourceIds.map(s=>s===oldBrief.id?briefId:s===oldSpace?spaceId:s);for(const [k,v]of Object.entries(value))if(!['sources','sourceId','sourceIds'].includes(k))rebind(v);};
 p.spaceProgram=binding;p.architecture=pack.context;
 p.rooms=selected.map(id=>{const s=pack.spaces.find(s=>s.id===id),old=before.rooms.find(r=>r.id===id);return {...(old?structuredClone(old):{obstacles:[],heightM:3.3,workplaneM:.75}),id,name:s.name,use:uses[id],polygon:s.polygon,doors:s.entries,sourceIds:[spaceId,briefId],geometryStatus:'inferred'};});
 p.requirements=selected.flatMap((roomId,i)=>[['target_lux',targets[roomId]??(uses[roomId]==='corridor'?100:300)],['max_lpd',8],['max_spacing',3],['max_devices',40],['max_circuit_watts',1000],['max_drop',3],['control_mode',uses[roomId]==='corridor'?'regional_manual':'local'],['mounting_height',3]].map(([rule,value])=>({id:before.requirements.find(r=>r.rule===rule&&r.roomIds.length===1&&r.roomIds[0]===roomId)?.id??'S'+i+'_'+rule,rule,value,roomIds:[roomId],sourceIds:[briefId],rationale:'Explicit developer amendment values, not a verified standard or customer requirement',status:'assumed'})));
 rebind(p);
 // Each non-source condition has its literal complete proposed/deleted value
 // in the test brief. Source-registry decisions quote a separate statement to
 // avoid a brief containing its own SHA.
 const header='本次为预先编写的开发修订任务书；来源登记和退役采用已列摘要与新版本，不代表客户或专业认证。新增空间、删除空间、用途解释和所有保留/修改/删除条件均按下列逐项清单处理。未取得的标准适用性、物理照明质量和现场条件继续待审。';
 const a=new Map(spaceScopeConditions(before).map(r=>[r.key,r.value])),b=new Map(spaceScopeConditions(p).map(r=>[r.key,r.value]));
 p.brief=header+'\n'+spaceScopeDelta(before,p).filter(d=>!d.key.startsWith('source:')).map(d=>d.disposition+' '+d.key+' '+literal(b.get(d.key)??a.get(d.key))).join('\n');
 p.sources.find(s=>s.id===briefId).sha256=sha(p.brief);
 return {project:engineeringInputSchema.parse(p),sourceQuote:header,reason:'Complete frozen developer amendment changes selected room schedule/use and requirements with explicit quoted dispositions; independent engineering applicability remains pending'};
}
export function decisionsFromPreview(preview,proposal){return preview.decisions.map(({key,disposition,previousSHA256,nextSHA256,previousValue,proposedValue})=>({key,disposition,previousSHA256,nextSHA256,reason:'Explicit developer disposition of this exact condition and source binding for the new task brief; no inferred professional approval',evidence:{sourceId:preview.sourceId,quote:key.startsWith('source:')?proposal.sourceQuote:literal(proposedValue??previousValue)}}));}
