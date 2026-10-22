import {z} from 'zod';
export const planningMetricNames=['net_room_area_m2','circulation_area_m2','partition_and_threshold_area_m2','area_preference_deviation_m2','unassigned_area_m2','maximum_entry_route_mm','total_entry_route_mm'];
const metric=z.enum(planningMetricNames),id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,47}$/);
export const planningSelectionSchema=z.strictObject({method:z.literal('lexicographic'),criteria:z.array(z.strictObject({metric,direction:z.enum(['minimize','maximize'])})).max(7),limits:z.array(z.strictObject({id,metric,comparison:z.enum(['at_least','at_most']),value:z.number().finite().nonnegative().max(1e9)})).max(30),sourceIds:z.array(id).min(1).max(20),status:z.enum(['interpreted','assumed','unresolved']),evidenceQuote:z.string().min(5).max(4000)}).superRefine((p,c)=>{
 if(p.status!=='unresolved'&&!p.criteria.length)c.addIssue({code:'custom',message:'Resolved project selection requires an explicit ordered objective'});
 if(new Set(p.criteria.map(c=>c.metric)).size!==p.criteria.length)c.addIssue({code:'custom',message:'Duplicate objective metric; do not guess between contradictory directions'});
 if(new Set(p.limits.map(l=>l.id)).size!==p.limits.length)c.addIssue({code:'custom',message:'Duplicate project selection limit identity'});
});
export function planningSelectionIssues(p){
 const s=p.selection;if(!s)return[];const out=[];
 if(s.status==='unresolved')out.push({code:'PLANNING_SELECTION_UNRESOLVED',message:'Project objective order and bounds require source interpretation; no fallback to built-in scoring'});
 for(const metric of planningMetricNames){const lo=s.limits.filter(l=>l.metric===metric&&l.comparison==='at_least'),hi=s.limits.filter(l=>l.metric===metric&&l.comparison==='at_most');if(lo.length&&hi.length&&Math.max(...lo.map(l=>l.value))>Math.min(...hi.map(l=>l.value)))out.push({code:'PLANNING_SELECTION_BOUNDS_CONFLICT',metric,limits:[...lo,...hi]});}
 return out;
}
