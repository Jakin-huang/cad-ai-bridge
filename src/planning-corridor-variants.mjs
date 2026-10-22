// Extra corridor families are opt-in; old budgets retain their exact variants.
export function corridorVariants(input,budget,frame){
 const g=input.parameters,entry=input.shell.entry;
 const widths=[...new Set([g.corridorMinMm,Math.round((g.corridorMinMm+g.corridorMaxMm)/2/g.gridMm)*g.gridMm,g.corridorMaxMm])].filter(w=>w>=g.corridorMinMm&&w<=g.corridorMaxMm&&w>=entry.clearWidthMm),variants=[];
 for(const width of widths){
  const margin=(width-entry.clearWidthMm)/2;
  const centers=[...new Set([entry.offsetMm,entry.offsetMm-margin,entry.offsetMm+margin,...(budget.corridorMode==='allow_single_sided'?[width/2,frame.breadth-width/2]:[])])];
  for(const center of centers){
   const lo=center-width/2,hi=center+width/2;
   const twoSided=lo>g.wallThicknessMm&&hi<frame.breadth-g.wallThicknessMm;
   const singleSided=budget.corridorMode==='allow_single_sided'&&(lo===0&&hi<frame.breadth-g.wallThicknessMm||hi===frame.breadth&&lo>g.wallThicknessMm);
   if(!twoSided&&!singleSided)continue;
   if(entry.offsetMm-entry.clearWidthMm/2<lo||entry.offsetMm+entry.clearWidthMm/2>hi)continue;
   variants.push({width,center});
  }
 }
 return variants;
}
