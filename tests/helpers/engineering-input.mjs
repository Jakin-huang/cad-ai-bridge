// Synthetic in-code test conditions, not a distributed drawing or project asset.
export function engineeringTestInput(){
 const source={id:'BRIEF',role:'brief',sha256:'a'.repeat(64),description:'Synthetic explicit project brief',derivedFromFinalDrawing:false};
 return {schemaVersion:1,projectId:'QA',title:'照明设计测试',designDate:'2024-09-01',discipline:'ordinary-lighting',scope:'One synthetic office and circulation zone for deterministic design verification.',brief:'根据房间条件新建设计，办公室照度估算300lx，功率密度不超过8W/m2，独立控制并交付待审图纸。',sources:[source],
 requirements:[['target_lux',300],['max_lpd',8],['max_spacing',3],['max_devices',12],['max_circuit_watts',1000],['max_drop',3],['control_mode','local'],['mounting_height',3]].map(([rule,value],i)=>({id:'REQ_'+i,rule,value,roomIds:['OFFICE'],sourceIds:['BRIEF'],rationale:'Explicit synthetic test requirement',status:'documented'})),
 standards:[{id:'GENERAL',code:'Test bounded rule',edition:'test',effectiveFrom:'2024-01-01',sourceId:'BRIEF',clauses:[{id:'PROTECT',locator:'test.1',verified:true,summary:'Terminal protection',check:'terminal_protection',roomIds:['OFFICE']}]}],
 rooms:[{id:'OFFICE',name:'测试办公室',use:'office',polygon:[[0,0],[8000,0],[8000,6000],[0,6000]],doors:[[1000,0]],obstacles:[],sourceIds:['BRIEF'],geometryStatus:'issued',heightM:3.3,workplaneM:.75}],architecture:[{kind:'polyline',points:[[0,0],[8000,0],[8000,6000],[0,6000]],closed:true}],
 luminaires:[{id:'LED',label:'Assumed test LED',watts:24,lumens:3600,utilizationFactor:.6,maintenanceFactor:.8,sourceId:'BRIEF',photometry:'assumed',ra:90,cctK:4000}],
 electrical:{panelId:'AL',panelPosition:[500,-500],voltage:230,powerFactor:.95,wireSectionMm2:2.5,copperOhmMm2PerM:.0225,assumedIzA:20,breakerA:10,extraLengthM:5,shortCircuitProtection:true,overloadProtection:true,earthFaultProtection:true,rcd:true,sourceIds:['BRIEF']},missingInputs:[]};
}
