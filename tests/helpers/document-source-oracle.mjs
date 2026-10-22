import {dependencyDigest as digest} from '../../src/task-dependencies.mjs';
// IDs are local aliases. Compare their resolved provenance without discarding
// physical values, source roles or the final-drawing exclusion grade.
export function sourceResolvedValue(value,sources){
 const index=new Map(sources.map(s=>[s.id,s]));if(index.size!==sources.length)throw Error('Duplicate source identity');
 const resolve=id=>{const s=index.get(id);if(!s)throw Error('Unresolved source identity: '+id);return {sha256:s.sha256,role:s.role,derivedFromFinalDrawing:s.derivedFromFinalDrawing};};
 const walk=v=>Array.isArray(v)?v.map(walk):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,k==='sourceId'?resolve(x):k==='sourceIds'?x.map(resolve):walk(x)])):v;
 return walk(value);
}
export function sameSourceBoundValues(before,after,beforeSources,afterSources){try{return digest(sourceResolvedValue(before,beforeSources))===digest(sourceResolvedValue(after,afterSources));}catch{return false;}}
export function hasCurrentRequirementSource(row,sources,expectedTextSHAs){
 if(!row.sourceIds?.length||row.sourceIds.includes('BASELINE')||row.status==='assumed')return false;
 const selected=row.sourceIds.map(id=>sources.find(s=>s.id===id));
 return selected.every(Boolean)&&selected.some(s=>expectedTextSHAs.includes(s.sha256)&&s.derivedFromFinalDrawing===false);
}
