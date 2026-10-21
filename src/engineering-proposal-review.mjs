// Read-only projection of a compiled lighting revision draft. This exposes
// client decisions and effective values; it does not infer omitted brief intent.
import {dependencyDigest} from './task-dependencies.mjs';

export function revisionRequirementReview(draft){
 const {request,project,decisions}=draft,rows=[];
 for(const room of project.rooms){
  const planned=request.rooms.find(r=>r.roomId===room.id);
  if(!planned)throw Error('REVISION_REVIEW_ROOM_UNREPRESENTED');
  const effective=project.requirements.filter(r=>r.roomIds.includes(room.id)),overrides=new Map(planned.requirements.map(r=>[r.rule,r])),unresolved=new Map(planned.unresolvedRules.map(r=>[r.rule,r]));
  const rules=[...new Set([...effective.map(r=>r.rule),...overrides.keys(),...unresolved.keys()])].sort();
  for(const rule of rules){
   const requirements=effective.filter(r=>r.rule===rule),override=overrides.get(rule),unknown=unresolved.get(rule);
   if(unknown&&(override||requirements.length))throw Error('REVISION_REVIEW_UNRESOLVED_HAS_VALUE');
   if(override&&dependencyDigest(override.values)!==dependencyDigest(requirements.map(r=>r.value)))throw Error('REVISION_REVIEW_OVERRIDE_VALUES_CHANGED');
   const evidence=requirements.map(r=>{
    const decision=decisions.find(d=>d.key==='requirement:'+r.id);
    if(!decision?.evidence?.quote||!project.brief.includes(decision.evidence.quote))throw Error('REVISION_REVIEW_EVIDENCE_UNAVAILABLE');
    const source=project.sources.find(s=>s.id===decision.evidence.sourceId);
    if(!source||source.role!=='brief'||source.supersededBy||source.sha256.toLowerCase()!==draft.brief.textSHA256.toLowerCase())throw Error('REVISION_REVIEW_EVIDENCE_SOURCE_CHANGED');
    return {requirementId:r.id,sourceId:source.id,sourceSHA256:source.sha256,quote:decision.evidence.quote,reason:decision.reason};
   });
   if(unknown&&!project.brief.includes(unknown.quote))throw Error('REVISION_REVIEW_EVIDENCE_UNAVAILABLE');
   rows.push({roomId:room.id,roomName:room.name,use:room.use,fromRoomId:planned.fromRoomId,rule,
    decision:unknown?'unresolved':override?'explicit_override':'carried_forward',
    values:requirements.map(r=>r.value),multipleDeclaredValues:new Set(requirements.map(r=>dependencyDigest(r.value))).size>1,
    requirements:requirements.map(({id,value,status,sourceIds,rationale})=>({id,value,status,sourceIds:[...sourceIds],rationale})),
    evidence,...(unknown?{unresolvedEvidence:{quote:unknown.quote,reason:unknown.reason}}:{}),
    ...(!unknown&&!override?{carryForwardAuthorization:{quote:request.carryForward.quote,reason:request.carryForward.reason}}:{})});
  }
 }
 return {rows,summary:{rows:rows.length,explicitOverrideRows:rows.filter(r=>r.decision==='explicit_override').length,
  carriedForwardRows:rows.filter(r=>r.decision==='carried_forward').length,unresolvedRows:rows.filter(r=>r.decision==='unresolved').length,
  multipleValueRows:rows.filter(r=>r.multipleDeclaredValues).length,briefSHA256:draft.brief.textSHA256,
  semanticCoverageAccepted:false,professionalApproval:false,
  scope:'Declared rule disposition and assembled-value review only. Inherited values remain visible even when a quoted brief says something different. No inference or certification that every natural-language demand was extracted.'}};
}

export function revisionRequirementReviewPage(draft,{offset=0,limit=25,maxBytes=240*1024}={}){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>256*1024)throw Error('REVISION_REVIEW_PAGE_BOUNDS');
 const {rows,summary}=revisionRequirementReview(draft),items=[];
 const page=values=>({section:'requirements',offset,total:rows.length,items:values,hasMore:offset+values.length<rows.length,nextOffset:offset+values.length,summary});
 if(Buffer.byteLength(JSON.stringify(page(items)),'utf8')>maxBytes)throw Error('REVISION_REVIEW_ENVELOPE_TOO_LARGE');
 for(const row of rows.slice(offset,offset+limit)){
  if(Buffer.byteLength(JSON.stringify(page([...items,row])),'utf8')>maxBytes){if(!items.length)throw Error('REVISION_REVIEW_ROW_TOO_LARGE');break;}
  items.push(row);
 }
 return page(items);
}

export function revisionDraftBase(draft,current){
 const expected=draft.request,valid=v=>typeof v==='string'&&/^[a-f0-9]{64}$/i.test(v);
 if(!Number.isSafeInteger(expected.expectedRevision)||expected.expectedRevision<0||!Number.isSafeInteger(current.revision)||current.revision<0||!valid(expected.expectedInputSHA256)||!valid(current.inputSHA256))throw Error('REVISION_REVIEW_BASE_IDENTITY_REQUIRED');
 return {baseRevision:expected.expectedRevision,baseInputSHA256:expected.expectedInputSHA256.toLowerCase(),currentRevision:current.revision,currentInputSHA256:current.inputSHA256.toLowerCase(),staleBase:expected.expectedRevision!==current.revision||expected.expectedInputSHA256.toLowerCase()!==current.inputSHA256.toLowerCase()};
}
