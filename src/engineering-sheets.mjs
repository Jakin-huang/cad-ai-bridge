export const landscapePaperMm={A3:[420,297],A2:[594,420],A1:[841,594],A0:[1189,841]};
export function selectEngineeringPlanSheet(width,height){
 for(const [paper,denominator]of [['A3',50],['A3',100],['A2',100],['A1',100],['A0',100],['A0',200]]){const [w,h]=landscapePaperMm[paper],regionWidth=(w-30)*denominator,regionHeight=(h-37)*denominator;if(width<=regionWidth-60*denominator&&height<=regionHeight-100*denominator)return {paper,denominator,width:regionWidth,height:regionHeight,planOffset:[30*denominator+(regionWidth-60*denominator-width)/2,56*denominator+(regionHeight-100*denominator-height)/2]};}
 throw Error('PLAN_PAGINATION_REQUIRED: source extent exceeds supported A0 1:200 full-size plan; explicit scope partitioning is required');
}
