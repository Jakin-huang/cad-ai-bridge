// Bound cheap point diagnostics without allowing many single-removal variants
// of low-count grids to hide the rest of the source geometry family.
export function sampleLightingGeometry(candidates,limit=16){
 const groups=new Map();for(const c of candidates){if(!groups.has(c.count))groups.set(c.count,[]);groups.get(c.count).push(c);}const counts=[...groups.keys()].sort((a,b)=>a-b),picked=[],add=c=>{if(c&&!picked.includes(c)&&picked.length<limit)picked.push(c);},representative=count=>groups.get(count)?.[0];
 if(counts.length<=limit)for(const count of counts)add(representative(count));
 else{
  for(const count of counts.slice(0,3))add(representative(count));
  // Flux estimates only help choose a bounded diagnostic sample. They never
  // determine total light, source normalization, or candidate acceptance.
  const near=[...counts].sort((a,b)=>Math.abs(representative(a).estimatedLux-representative(a).targetLux)-Math.abs(representative(b).estimatedLux-representative(b).targetLux)||a-b);for(const count of near.slice(0,7))add(representative(count));
  add(representative(counts.at(-1)));for(let denominator=2;denominator<=2*limit&&picked.length<limit;denominator*=2)for(let numerator=1;numerator<denominator&&picked.length<limit;numerator+=2)add(representative(counts[Math.round(numerator*(counts.length-1)/denominator)]));
 }
 // Spend spare diagnostics across the count range, preferring a different
 // geometry family at that count. Appending candidates in power order alone
 // gives all spare slots to low-count removal variants.
 const family=c=>(c.layoutSearch??'unspecified')+':'+(c.infill?.axis??''),visited=new Set();
 for(let denominator=2;denominator<=2*limit&&picked.length<limit;denominator*=2)for(let numerator=1;numerator<denominator&&picked.length<limit;numerator+=2){
  const count=counts[Math.round(numerator*(counts.length-1)/denominator)];if(visited.has(count)||count===undefined)continue;visited.add(count);
  const group=groups.get(count),families=new Set(picked.filter(c=>c.count===count).map(family));add(group.find(c=>!picked.includes(c)&&!families.has(family(c)))??group.find(c=>!picked.includes(c)));
 }
 for(const c of candidates)add(c);
 return {choices:picked,coverage:{availableCandidates:candidates.length,availableCounts:counts,sampledCounts:[...new Set(picked.map(c=>c.count))].sort((a,b)=>a-b),sampledVariants:picked.map(c=>({count:c.count,family:family(c)})),pointPoolLimit:limit,method:'count_strata_then_spread_geometry_families',scope:'Bounded count and geometry-family diagnostics, including one representative per count when the count family fits; flux proximity and geometry diversity order trials only, not exhaustive or a feasibility proof'}};
}
