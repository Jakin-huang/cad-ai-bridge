import crypto from 'node:crypto';
const fold=v=>String(v??'').toUpperCase();
export function buildQueryIndex(rows){
 const index={schemaVersion:1,count:rows.length,columns:{handle:{},type:{},layer:{},blockName:{},id:{}}};
 for(let i=0;i<rows.length;i++)for(const [key,column]of Object.entries(index.columns)){const value=fold(rows[i][key]);(column[value]??=[]).push(i);}
 return index;
}
export function matchesRow(row,filter={}){
 if(filter.ids&&!filter.ids.includes(row.id))return false;
 for(const [key,values]of [['handle',filter.handles],['type',filter.types],['layer',filter.layers]])if(values&&!values.some(v=>fold(v)===fold(row[key])))return false;
 if(filter.blockName&&fold(filter.blockName)!==fold(row.blockName))return false;
 if(filter.textContains&&!fold(row.text).includes(fold(filter.textContains)))return false;
 if(filter.attributes)for(const [tag,value]of Object.entries(filter.attributes))if(Object.entries(row.attributes||{}).find(([k])=>fold(k)===fold(tag))?.[1]!==value)return false;
 if(filter.region){const b=row.bounds,r=filter.region;if(!b)return false;if(r.mode==='contains'){if(b.min[0]<r.min[0]||b.max[0]>r.max[0]||b.min[1]<r.min[1]||b.max[1]>r.max[1])return false;}else if(b.max[0]<r.min[0]||b.min[0]>r.max[0]||b.max[1]<r.min[1]||b.min[1]>r.max[1])return false;}
 return true;
}
export function indexedRows(rows,index,filter={}){
 const candidates=[];
 for(const [key,values]of [['handle',filter.handles],['id',filter.ids],['type',filter.types],['layer',filter.layers],['blockName',filter.blockName?[filter.blockName]:undefined]])if(values)candidates.push([...new Set(values.flatMap(v=>index.columns[key][fold(v)]||[]))].sort((a,b)=>a-b));
 const indices=candidates.sort((a,b)=>a.length-b.length)[0]??rows.map((_,i)=>i);
 return indices.map(i=>rows[i]).filter(row=>matchesRow(row,filter));
}
export const indexDigest=index=>crypto.createHash('sha256').update(JSON.stringify(index)).digest('hex');
