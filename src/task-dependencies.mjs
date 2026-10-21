// Domain-neutral dependency and scalar-constraint accounting. This does not
// infer missing edges, certify source meaning, or perform professional review.
import crypto from 'node:crypto';
import {z} from 'zod';
const id=z.string().min(1).max(220),scalar=z.union([z.number().finite(),z.string().min(1).max(200)]);
export const dependencyNodeSchema=z.strictObject({id,kind:z.enum(['source','requirement','condition','standard','design','check','artifact','review','result','comparison']),label:z.string().min(1).max(200),value:z.json(),dependsOn:z.array(id).max(5000),available:z.boolean().optional(),sourceRole:z.enum(['input','reference']).optional(),authority:z.enum(['declared','interpreted','assumed','source_bound','unverified','retired']),constraint:z.strictObject({subject:id,property:id,unit:z.string().min(1).max(80),operator:z.enum(['eq','ge','le']),value:scalar}).optional()});
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const dependencyDigest=v=>crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export function constraintConflicts(nodes){
 const groups=new Map(),issues=[];for(const node of nodes)if(node.constraint){const c=node.constraint,key=JSON.stringify([c.subject,c.property]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push({id:node.id,...c});}
 for(const group of groups.values()){
  const detail={subject:group[0].subject,property:group[0].property,nodeIds:group.map(n=>n.id)};
  if(new Set(group.map(c=>c.unit)).size!==1){issues.push({code:'CONSTRAINT_UNITS_UNRECONCILED',...detail});continue;}
  if(group.some(c=>typeof c.value!==typeof group[0].value)||group.some(c=>typeof c.value==='string'&&c.operator!=='eq')){issues.push({code:'CONSTRAINT_TYPES_UNSUPPORTED',...detail});continue;}
  if(typeof group[0].value==='string'){if(new Set(group.map(c=>c.value)).size>1)issues.push({code:'CONSTRAINT_EQUALITY_CONFLICT',...detail});continue;}
  const lower=Math.max(-Infinity,...group.filter(c=>['ge','eq'].includes(c.operator)).map(c=>c.value)),upper=Math.min(Infinity,...group.filter(c=>['le','eq'].includes(c.operator)).map(c=>c.value));if(lower>upper)issues.push({code:'CONSTRAINT_INTERVAL_CONFLICT',...detail,lower,upper});
 }
 return issues;
}
export function buildTaskDependencies({projectId,taskSHA256,nodes}){
 if(!z.uuid().safeParse(projectId).success||!/^[a-f0-9]{64}$/.test(taskSHA256))throw Error('DEPENDENCY_SCOPE_INVALID');
 if(!Array.isArray(nodes)||nodes.length>5000)throw Error('DEPENDENCY_NODE_BUDGET');const parsed=nodes.map(n=>dependencyNodeSchema.parse(n)),map=new Map(parsed.map(n=>[n.id,n]));if(map.size!==parsed.length)throw Error('DEPENDENCY_DUPLICATE_NODE');
 let edges=0;for(const node of parsed){if(['design','check','artifact','review','result','comparison'].includes(node.kind)&&typeof node.available!=='boolean')throw Error('DEPENDENCY_OUTPUT_AVAILABILITY_REQUIRED');if(node.kind==='source'?!node.sourceRole:!!node.sourceRole)throw Error('DEPENDENCY_SOURCE_ROLE_REQUIRED');if(new Set(node.dependsOn).size!==node.dependsOn.length)throw Error('DEPENDENCY_DUPLICATE_EDGE');node.dependsOn.sort();edges+=node.dependsOn.length;for(const ref of node.dependsOn)if(!map.has(ref))throw Error('DEPENDENCY_UNKNOWN_NODE: '+ref);}if(edges>20000)throw Error('DEPENDENCY_EDGE_BUDGET');
 const indegree=new Map(parsed.map(n=>[n.id,n.dependsOn.length])),reverse=new Map(parsed.map(n=>[n.id,[]]));for(const n of parsed)for(const ref of n.dependsOn)reverse.get(ref).push(n.id);const queue=parsed.filter(n=>!n.dependsOn.length).map(n=>n.id);let visited=0;for(let i=0;i<queue.length;i++){visited++;for(const next of reverse.get(queue[i])){indegree.set(next,indegree.get(next)-1);if(!indegree.get(next))queue.push(next);}}if(visited!==parsed.length)throw Error('DEPENDENCY_CYCLE');
 const references=parsed.filter(n=>n.sourceRole==='reference').map(n=>n.id),derived=new Set(references);for(let i=0;i<references.length;i++)for(const next of reverse.get(references[i])){const n=map.get(next);if(n.kind!=='comparison'&&n.sourceRole!=='reference')throw Error('DEPENDENCY_REFERENCE_LEAK: '+next);if(!derived.has(next)){derived.add(next);references.push(next);}}

 const graph={schemaVersion:1,projectId,taskSHA256,nodes:parsed.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)};const conflicts=constraintConflicts(graph.nodes);return {...graph,sha256:dependencyDigest(graph),summary:{nodes:parsed.length,edges,kinds:Object.fromEntries([...new Set(parsed.map(n=>n.kind))].sort().map(k=>[k,parsed.filter(n=>n.kind===k).length])),conflicts:conflicts.length,professionalApproval:false},conflicts};
}
export function compareTaskDependencies(before,after){
 for(const graph of [before,after])if(buildTaskDependencies(graph).sha256!==graph.sha256)throw Error('DEPENDENCY_GRAPH_CHANGED');
 if(before.projectId!==after.projectId||before.taskSHA256!==after.taskSHA256)throw Error('DEPENDENCY_SCOPE_MISMATCH');
 const a=new Map(before.nodes.map(n=>[n.id,n])),b=new Map(after.nodes.map(n=>[n.id,n])),changed=[...new Set([...a.keys(),...b.keys()])].sort().filter(id=>!a.has(id)||!b.has(id)||dependencyDigest(a.get(id))!==dependencyDigest(b.get(id))),reverse=new Map();
 for(const graph of [before,after])for(const n of graph.nodes)for(const ref of n.dependsOn){if(!reverse.has(ref))reverse.set(ref,new Set());reverse.get(ref).add(n.id);}
 const affected=new Set(changed),queue=[...changed];for(let i=0;i<queue.length;i++)for(const next of reverse.get(queue[i])||[])if(!affected.has(next)){affected.add(next);queue.push(next);}
 const invalidKinds=new Set(['design','check','artifact','review','result','comparison']),invalidated=[...affected].filter(id=>a.has(id)&&a.get(id).available!==false&&invalidKinds.has(a.get(id).kind)).sort();
 const items=[...affected].sort().map(id=>({id,kind:(b.get(id)||a.get(id)).kind,change:!a.has(id)?'added':!b.has(id)?'removed':changed.includes(id)?'modified':'dependent',invalidated:invalidated.includes(id),...(changed.includes(id)?{before:a.get(id),after:b.get(id)}:{}),upstream:[...new Set([...(a.get(id)?.dependsOn||[]),...(b.get(id)?.dependsOn||[])])].filter(ref=>affected.has(ref))}));
 return {schemaVersion:1,beforeSHA256:before.sha256,afterSHA256:after.sha256,changed,affected:[...affected].sort(),invalidated,items,summary:{changed:changed.length,affected:affected.size,invalidated:invalidated.length,invalidatedKinds:Object.fromEntries([...invalidKinds].map(k=>[k,invalidated.filter(id=>a.get(id).kind===k).length])),scope:'Conservative declared dependencies; historical files are retained. No inferred missing dependency or selective native update certification.',professionalApproval:false}};
}

export function dependencyPage(items,{offset=0,limit=25,byteBudget=256*1024}={}){const page=[];let bytes=0;for(const item of items.slice(offset,offset+limit)){const size=Buffer.byteLength(JSON.stringify(item));if(size>byteBudget&&!page.length)return {ok:false,error:{code:'DEPENDENCY_ITEM_TOO_LARGE',message:'One dependency record exceeds the page byte budget; inspect its retained local snapshot instead of retrying or assuming complete coverage.'},itemId:item.id,items:[],total:items.length,nextOffset:offset,hasMore:true};if(bytes+size>byteBudget)break;page.push(item);bytes+=size;}return {ok:true,items:page,total:items.length,nextOffset:offset+page.length,hasMore:offset+page.length<items.length};}
