import {csvCell} from './files.mjs';
const text=value=>value===undefined?'':typeof value==='string'?value:JSON.stringify(value);
const value=node=>node?.value&&Object.hasOwn(node.value,'value')?node.value.value:node?.value;
const evidence=node=>node?{authority:node.authority,dependsOn:node.dependsOn,sourceRole:node.sourceRole}:undefined;
export function dependencyImpactCsv(impact){
 const rows=[['对象类别','对象ID','变更方式','旧成果失效','原值','新值','约束和单位','原依据','现依据','受影响前序','内容截断']];
 for(const item of impact.items){let truncated=false;const cells=[item.kind,item.id,item.change,item.invalidated,value(item.before),value(item.after),item.after?.constraint??item.before?.constraint,evidence(item.before),evidence(item.after),item.upstream];const safe=cells.map(v=>{let s=text(v);if(s.length>16000){s=s.slice(0,15920)+'…[已截断；完整内容见同操作JSON证据]';truncated=true;}return /^[\s]*[=+@-]/.test(s)?"'"+s:s;});rows.push([...safe,truncated]);}
 return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
