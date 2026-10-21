// Bounded source geometry family. No photometric prediction or acceptance here.
// Preserve the base grid, then fill gaps on its two opposite perimeter rows or
// columns. This can add useful source positions without moving edge coverage.
export function perimeterInfillLayouts({positions,nx,ny,bounds,maxCount,validPoint}){
 if(nx<2||ny<2||positions.length!==nx*ny||positions.length>=maxCount)return [];
 const span=bounds.max.map((v,k)=>v-bounds.min[k]),round=n=>Math.round(n*1e6)/1e6,point=(x,y)=>[round(x),round(y)],xs=[bounds.min[0]+span[0]/(2*nx),bounds.max[0]-span[0]/(2*nx)],ys=[bounds.min[1]+span[1]/(2*ny),bounds.max[1]-span[1]/(2*ny)],rows=[],columns=[];
 for(let y=1;y<ny;y++)for(const x of xs)rows.push(point(x,bounds.min[1]+span[1]*y/ny));
 for(let x=1;x<nx;x++)for(const y of ys)columns.push(point(bounds.min[0]+span[0]*x/nx,y));
 const variants=[['between_rows',rows],['between_columns',columns],['both',rows.concat(columns)]],seen=new Set(),layouts=[];
 for(const [axis,added]of variants){
  if(positions.length+added.length>maxCount||!added.every(validPoint))continue;
  const all=positions.concat(added),keys=all.map(p=>p.join(','));if(new Set(keys).size!==all.length)continue;
  const key=keys.join(';');if(seen.has(key))continue;seen.add(key);
  layouts.push({positions:all,layoutSearch:'perimeter_infill_grid',infill:{axis,baseGrid:[nx,ny],addedCount:added.length}});
 }
 return layouts;
}
