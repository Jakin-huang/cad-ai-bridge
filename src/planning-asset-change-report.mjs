// Human-readable physical amendment history, derived from verified task inputs.
// The report is traceability evidence, never source-authority or design approval.
import fs from 'node:fs/promises';import path from 'node:path';
import {dependencyDigest as digest} from './task-dependencies.mjs';
import {verifyAssetRevisionHistory} from './planning-asset-revisions.mjs';
import {spacePlanningInputSchema} from './space-planning-contracts.mjs';
import {jobDirectory,jobJson} from './jobs.mjs';import {hashFile} from './drawings.mjs';import {csvCell} from './files.mjs';
const equal=(a,b)=>a===undefined||b===undefined?a===b:digest(a)===digest(b);
export function assetFieldChanges(before,after){
 const rows=[];
 function compare(a,b,field){if(equal(a,b))return;
  if((a&&typeof a==='object'||b&&typeof b==='object')&&(!a||!b||Array.isArray(a)===Array.isArray(b))){
   for(const key of [...new Set([...Object.keys(a??{}),...Object.keys(b??{})])].sort())compare(a?.[key],b?.[key],Array.isArray(a??b)?field+'['+key+']':field?field+'.'+key:key);
  }else rows.push({field,before:a??null,after:b??null});
 }
 const physical=a=>a?Object.fromEntries(Object.entries(a).filter(([k])=>!['sourceIds','evidenceQuote'].includes(k))):null;
 compare(physical(before),physical(after),'');return rows;
}
export async function compileAssetChangeReport({runs,state}){
 if(!state.assetRevisions?.length)return undefined;
 await verifyAssetRevisionHistory({runs,state,parseInput:p=>spacePlanningInputSchema.parse(p)});
 const dir=await jobDirectory(runs,state.jobId),revisions=[];let count=0;
 for(const entry of state.assetRevisions){
  const record=await jobJson(dir,entry.file),before=await jobJson(dir,'input-'+record.fromRevision+'.json'),after=await jobJson(dir,'input-'+(record.fromRevision+1)+'.json');
  const items=record.parameters.changes.map(c=>{const a=before.assets?.find(a=>a.id===c.assetId)??null,b=after.assets?.find(a=>a.id===c.assetId)??null;return {assetId:c.assetId,kind:c.kind,retentionAction:c.retentionAction,reason:c.reason,before:a,after:b,fields:assetFieldChanges(a,b),evidence:c.evidence};});
  count+=items.length;if(count>200)throw Error('ASSET_CHANGE_REPORT_BUDGET');
  revisions.push({fromRevision:record.fromRevision,toRevision:record.fromRevision+1,fromInputSHA256:record.fromInputSHA256,inputSHA256:record.inputSHA256,documents:record.documents,priorDocuments:record.priorDocuments,revisionRecord:{...entry},items});
 }
 return {schemaVersion:1,jobId:state.jobId,revision:state.revision,inputSHA256:state.inputSHA256,revisions,sourceAuthorityVerified:false,professionalApproval:false,reviewStatus:'awaiting_human_review',scope:'Recorded asset amendments through this input revision; current physical design and all other changes require their own checks.'};
}
const value=v=>typeof v==='string'?v:JSON.stringify(v),kind={add:'新增',update:'更新',remove:'删除'},retention={unchanged:'保留处置未变',establish:'设为固定',relocate:'明确迁移',release:'解除固定',remove:'明确删除'};
const fieldName=field=>({'widthMm':'宽度(mm)','depthMm':'深度(mm)','roomId':'所属空间','name':'名称','status':'依据等级','fixed.position[0]':'固定X(mm)','fixed.position[1]':'固定Y(mm)','fixed.orientationDegrees':'固定朝向(度)','clearances.frontMm':'正面净空(mm)','clearances.backMm':'背面净空(mm)','clearances.leftMm':'左侧净空(mm)','clearances.rightMm':'右侧净空(mm)','minFrontAccessMm':'正面接触宽度(mm)'}[field]??field);
export function assetChangeReportLines(report){
 const lines=['本表仅追溯已记录物品变更；原文语义、签发权限、条件适用性与专业许可未自动核验。','当前输入 '+report.inputSHA256+'；完整旧/新值、引文、摘要及来源版本见绑定的变更JSON/CSV。'];
 for(const r of report.revisions){
  lines.push('修订 '+r.fromRevision+' → '+r.toRevision+'；原文集版本 '+r.priorDocuments.revision+' → '+r.documents.revision+'；旧/新输入 '+r.fromInputSHA256.slice(0,12)+' / '+r.inputSHA256.slice(0,12));
  for(const item of r.items){lines.push(item.assetId+' / '+(item.after??item.before).name+'：'+kind[item.kind]+'；'+retention[item.retentionAction]);
   for(const f of item.fields)lines.push((fieldName(f.field)||'物品')+'：'+value(f.before)+' → '+value(f.after));
   if(!item.fields.length)lines.push('物理值未变，仅更新声明证据；不表示获得专业确认。');
   lines.push('变更理由：'+item.reason);
   for(const e of item.evidence)lines.push('原文依据 '+e.documentId+' / '+e.textSHA256.slice(0,12)+'；连续原句完整保存在变更记录。');
  }
 }
 return lines;
}
export async function retainAssetChangeReport({dir,revision,report}){
 if(!report)return [];
 const rows=[['fromRevision','toRevision','assetId','kind','retentionAction','field','before','after','reason','sourceEvidence','inputSHA256']];
 for(const r of report.revisions)for(const item of r.items)for(const f of item.fields.length?item.fields:[{field:'evidenceQuote',before:item.before?.evidenceQuote??null,after:item.after?.evidenceQuote??null}])rows.push([r.fromRevision,r.toRevision,item.assetId,item.kind,item.retentionAction,f.field,JSON.stringify(f.before),JSON.stringify(f.after),item.reason,JSON.stringify(item.evidence),r.inputSHA256]);
 const files=[];for(const [kind,name,bytes]of [['json','asset-changes-'+revision+'.json',JSON.stringify(report,null,2)+'\n'],['csv','asset-changes-'+revision+'.csv','\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n']]){const file=path.join(dir,name);await fs.writeFile(file,bytes,{flag:'wx'});files.push({kind,file,sha256:await hashFile(file)});}return files;
}
