import {engineeringTestInput} from './engineering-input.mjs';
// Procedural analytic source; never a bundled manufacturer asset.
export const analyticIes=({watts=24,multiplier=1,horizontal=[0],vertical=[0,45,90],rows=horizontal.map(()=>[1000,1000,0]),lumens=-1}={})=>['IESNA:LM-63-2002','[MANUFAC] Synthetic analytic test','[LUMINAIRE] Procedural test source','TILT=NONE',`1 ${lumens} ${multiplier} ${vertical.length} ${horizontal.length} 1 2 0 0 0`,`1 1 ${watts}`,vertical.join(' '),horizontal.join(' '),...rows.map(r=>r.join(' '))].join('\r\n');
export function photometricTestInput(file,sha256){
 const p=engineeringTestInput();p.sources.push({id:'PHOTOMETRY',role:'catalog',sha256,description:'Procedural synthetic analytic IES source',derivedFromFinalDrawing:false});p.luminaires[0]={...p.luminaires[0],sourceId:'PHOTOMETRY',iesFile:{file,sha256},photometry:'catalog_only'};
 p.photometricDesign={method:'ies_direct_point',gridSpacingM:.5,edgeOffsetM:.5,boundaryModel:'opaque_vertical_room_walls'};
 p.requirements.push(...[['min_uniformity',.4],['max_avg_lux',650]].map(([rule,value])=>({id:'PHOTO_'+rule,rule,value,roomIds:['OFFICE'],sourceIds:['BRIEF'],rationale:'Explicit synthetic direct-point acceptance target',status:'documented'})));
 return p;
}
