// Declared engineering inputs only. This is conservative schematic-route sizing,
// not installation routing, protective-device coordination or standard approval.
const round=n=>Math.round(n*1e6)/1e6;
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
export function lightingCircuitMetrics(selected,door,electrical,router){
 const sorted=[...selected].sort((a,b)=>distance(a.position,door)-distance(b.position,door));
 const vertices=[electrical.panelPosition,[door[0],electrical.panelPosition[1]],door];let last=door;
 for(const d of sorted){vertices.push([d.position[0],last[1]],d.position);last=d.position;}
 const clean=router?router.route(selected,door,electrical):vertices.filter((v,i)=>!i||distance(v,vertices[i-1])>1e-6).map(v=>v.map(round));
 // The caller enforces one product per group. Preserve the legacy multiplication
 // order, including decimal product ratings, instead of accumulating float error.
 const routeM=clean.slice(1).reduce((n,v,i)=>n+distance(v,clean[i]),0)/1000,estimatedLengthM=routeM+electrical.extraLengthM,watts=selected.length*selected[0].watts,currentA=watts/(electrical.voltage*electrical.powerFactor),dropPercent=2*electrical.copperOhmMm2PerM*estimatedLengthM*currentA/electrical.wireSectionMm2/electrical.voltage*100;
 return {clean,routeM,estimatedLengthM,watts,currentA,dropPercent};
}
export function partitionLightingCircuits({devices,door,electrical,maxDevices,maxWatts,maxDropPercent,roomId,maxCandidates=20000,router,additionalMetrics}){
 const watts=devices[0]?.watts,chunk=Math.min(maxDevices,Math.floor(maxWatts/watts));
 if(!devices.length||devices.some(d=>d.watts!==watts)||!Number.isInteger(maxCandidates)||maxCandidates<1)throw Error('CIRCUIT_PARTITION_INPUT_INVALID');
 if(chunk<1)throw Error('CIRCUIT_CAPACITY_INFEASIBLE: '+roomId);
 const metricsFor=selected=>{const m=lightingCircuitMetrics(selected,door,electrical,router);if(additionalMetrics)m.installation=additionalMetrics(selected);return m;};
 const feasible=(selected,m)=>(!m.installation||m.installation.maximumDropPercent<=maxDropPercent&&m.installation.currentA<=m.installation.switchRatingA)&&selected.length<=maxDevices&&m.watts<=maxWatts&&m.currentA<=electrical.breakerA&&round(m.currentA)<=electrical.breakerA&&electrical.breakerA<=electrical.assumedIzA&&m.dropPercent<=maxDropPercent&&round(m.dropPercent)<=maxDropPercent;
 const legacy=[];for(let start=0;start<devices.length;start+=chunk){const selected=devices.slice(start,start+chunk);legacy.push({selected,...metricsFor(selected)});}
 if(legacy.every(c=>feasible(c.selected,c)))return {groups:legacy};
 // Fixed feeder/ampacity declarations cannot be repaired by partitioning.
 if(electrical.breakerA>electrical.assumedIzA)throw Error('CIRCUIT_PARTITION_FIXED_SUPPLY_CONFLICT: '+roomId+'; declared breaker exceeds declared ampacity; values were not changed');
 const n=devices.length,dp=Array(n+1).fill(null);dp[n]={count:0,length:0,next:n};let examined=0;
 const limit=Math.min(chunk,Math.floor(electrical.breakerA*electrical.voltage*electrical.powerFactor/watts));
 for(let start=n-1;start>=0;start--)for(let count=Math.min(limit,n-start);count>=1;count--){
  const next=start+count;if(!dp[next])continue;
  if(++examined>maxCandidates)throw Error('CIRCUIT_PARTITION_SEARCH_BUDGET: '+roomId+'; no infeasibility claim');
  const selected=devices.slice(start,next),metrics=metricsFor(selected);if(!feasible(selected,metrics))continue;
  const candidate={count:1+dp[next].count,length:metrics.estimatedLengthM+dp[next].length,next,group:{selected,...metrics}};
  if(!dp[start]||candidate.count<dp[start].count||candidate.count===dp[start].count&&candidate.length<dp[start].length-1e-9)dp[start]=candidate;
 }
 if(!dp[0])throw Error('CIRCUIT_PARTITION_NO_FEASIBLE_SEQUENCE: '+roomId+'; no partition in the fixed device order and schematic route family satisfies declared current/drop limits; not general installation infeasibility');
 const groups=[];for(let start=0;start<n;start=dp[start].next)groups.push(dp[start].group);
 return {groups,decision:{roomId,...(additionalMetrics?{installationMaximumDropPercent:Math.max(...groups.map(c=>c.installation.maximumDropPercent)),installationOriginalMaximumDropPercent:Math.max(...legacy.map(c=>c.installation.maximumDropPercent))}:{}),method:'minimum_circuits_contiguous_fixed_device_order',originalCircuits:legacy.length,selectedCircuits:groups.length,examinedCandidates:examined,maximumCandidates:maxCandidates,originalMaximumDropPercent:Math.max(...legacy.map(c=>c.dropPercent)),maximumDropPercent:Math.max(...groups.map(c=>c.dropPercent)),maxDropPercent,originalMaximumCurrentA:Math.max(...legacy.map(c=>c.currentA)),maximumCurrentA:Math.max(...groups.map(c=>c.currentA)),breakerA:electrical.breakerA,scope:'Original physical lights and fixed supply declarations preserved; minimum circuit count then total conservative route length within contiguous device order only. Installation/protective coordination pending.'}};
}
