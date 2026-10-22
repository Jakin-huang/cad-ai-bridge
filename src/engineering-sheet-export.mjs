// Preserve the native contract's 50-item limit (PDF and PNG are separate items).
// Await each batch and stop on the first failure; callers retain native evidence.
export async function exportEngineeringSheets(call,drawing,sheets){
 const items=sheets.flatMap(s=>[{name:s.id,format:'pdf',region:s.region,plot:{paper:s.paper??'A3',orientation:'landscape',scale:'fixed',denominator:s.paperDenominator,style:'monochrome.ctb'}},{name:s.id,format:'png',region:s.region}]);
 // Large scenes take longer to plot late sheets. Use ten-sheet batches for
 // multi-batch deliveries within the existing 45-second host watchdog.
 const batches=[],size=items.length<=50?50:20;
 for(let i=0;i<items.length;i+=size){const chunk=items.slice(i,i+size),r=await call('export_many',{drawing,items:chunk});if(!r.ok)throw Error('ENGINEERING_EXPORT_BATCH_FAILED: '+i);if(r.exports?.length!==chunk.length||r.exports.some((e,k)=>e.ok===false||e.name!==chunk[k].name||e.format!==chunk[k].format))throw Error('ENGINEERING_EXPORT_BATCH_INCOMPLETE: '+i);batches.push(r);}
 if(batches.length===1)return batches[0];
 return {ok:true,exports:batches.flatMap(r=>r.exports??[]),batches};
}
