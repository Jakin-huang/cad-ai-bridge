// A complete, explicit condition ledger. Digests bind values, not semantics.
import {z} from 'zod';
import {dependencyDigest} from './task-dependencies.mjs';
const sha=z.string().regex(/^[a-f0-9]{64}$/i),id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const key=z.string().regex(/^(project_context|electrical|lightingEnvironment|glareAssessment|photometricDesign|lightingStandards|functionalIntake|room:[A-Za-z][A-Za-z0-9_-]{0,63}|requirement:[A-Za-z][A-Za-z0-9_-]{0,63}|luminaire:[A-Za-z][A-Za-z0-9_-]{0,63}|standard:[A-Za-z][A-Za-z0-9_-]{0,63}|missing_input:[A-Za-z][A-Za-z0-9_-]{0,63}|source:[A-Za-z][A-Za-z0-9_-]{0,63})$/);
export const spaceScopeDecisionSchema=z.strictObject({key,disposition:z.enum(['added','removed','revised','retained']),previousSHA256:sha.nullable(),nextSHA256:sha.nullable(),reason:z.string().min(20).max(1000),evidence:z.strictObject({sourceId:id,quote:z.string().min(5).max(4000)})});
export const spaceScopeDecisionsSchema=z.array(spaceScopeDecisionSchema).min(1).max(2500);
export const spaceScopeAuthoritySchema=z.strictObject({sourceId:id,supersededSourceId:id,previousBriefSHA256:sha,nextBriefSHA256:sha,replacementSHA256:sha,reason:z.string().min(20).max(1000),decisions:spaceScopeDecisionsSchema});
const history=['spaceProgramChanges','architecturalChanges','briefRevision','sourceCarryForwards'];
export function spaceScopeReplacement(p){return Object.fromEntries(Object.entries(p).filter(([k])=>!history.includes(k)));}
export function spaceScopeConditions(p){
 const rows=[{key:'project_context',value:Object.fromEntries(['projectId','title','designDate','discipline','scope'].map(k=>[k,p[k]]))}];
 for(const r of p.rooms){const {name,polygon,doors,geometryStatus,...conditions}=r;rows.push({key:'room:'+r.id,value:conditions});}
 for(const [prefix,items]of [['requirement',p.requirements],['luminaire',p.luminaires],['standard',p.standards],['missing_input',p.missingInputs],['source',p.sources]])for(const item of items)rows.push({key:prefix+':'+item.id,value:item});
 for(const k of ['electrical','lightingEnvironment','glareAssessment','photometricDesign','lightingStandards','functionalIntake'])if(p[k]!==undefined)rows.push({key:k,value:p[k]});
 return rows.map(r=>({...r,sha256:dependencyDigest(r.value)})).sort((a,b)=>a.key.localeCompare(b.key));
}
export function spaceScopeDelta(before,after){
 const a=new Map(spaceScopeConditions(before).map(r=>[r.key,r.sha256])),b=new Map(spaceScopeConditions(after).map(r=>[r.key,r.sha256]));
 return [...new Set([...a.keys(),...b.keys()])].sort().map(key=>({key,disposition:!a.has(key)?'added':!b.has(key)?'removed':a.get(key)===b.get(key)?'retained':'revised',previousSHA256:a.get(key)??null,nextSHA256:b.get(key)??null}));
}
export function verifySpaceScopeDecisions(before,after,decisions,sourceId){
 const rows=spaceScopeDecisionsSchema.parse(decisions),expected=spaceScopeDelta(before,after);
 if(rows.length!==expected.length||new Set(rows.map(r=>r.key)).size!==rows.length)throw Error('SPACE_REVISION_DECISION_COVERAGE');
 for(const d of expected){const r=rows.find(r=>r.key===d.key);if(!r||r.disposition!==d.disposition||(r.previousSHA256?.toLowerCase()??null)!==d.previousSHA256||(r.nextSHA256?.toLowerCase()??null)!==d.nextSHA256)throw Error('SPACE_REVISION_DECISION_VALUE_MISMATCH: '+d.key);if(r.evidence.sourceId!==sourceId||!after.brief.includes(r.evidence.quote))throw Error('SPACE_REVISION_DECISION_QUOTE_REQUIRED: '+d.key);}
 return expected;
}
