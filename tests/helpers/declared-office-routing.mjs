// Reusable developer geometry fixture. These are explicit assumed route
// permissions, never inferred engineering authority or independent customer data.
export function declaredOfficeRouting(input,sourceId){
 const basis={sourceIds:[sourceId],status:'assumed',description:'Explicit developer planar permission based on current synthetic room bounds and declared entrances; installation authority pending.'},allowedRegions=[];
 for(const room of input.rooms){
  const min=[0,1].map(a=>Math.min(...room.polygon.map(p=>p[a]))),max=[0,1].map(a=>Math.max(...room.polygon.map(p=>p[a])));
  allowedRegions.push({id:'AREA_'+room.id,min:min.map(n=>n+100),max:max.map(n=>n-100),...basis});
  if(room.id==='CIRCULATION')continue;
  const [x,y]=room.doors[0];allowedRegions.push({id:'PORTAL_'+room.id,min:[x-350,y>9000?9400:y-100],max:[x+350,y>9000?y+100:7600],...basis});
 }
 allowedRegions.push({id:'DECLARED_PANEL_FEED',min:[-500,-750],max:[750,-250],...basis},{id:'DECLARED_WEST_FEED',min:[-500,-750],max:[-100,9350],...basis},{id:'DECLARED_ENTRY_FEED',min:[-500,8650],max:[250,9350],...basis});
 return {mode:'declared_rectilinear_regions',clearanceMm:100,...basis,allowedRegions,exclusions:[{id:'DECLARED_SERVICE_ZONE',min:[8000,7800],max:[9000,8200],...basis,description:'Explicit synthetic ceiling service exclusion; dimensions and clearance require real-project coordination.'}]};
}
