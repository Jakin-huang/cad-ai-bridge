// This ledger makes omissions visible. It does not certify the meaning of text.
import {z} from 'zod';
import {dependencyDigest as digest} from './task-dependencies.mjs';
export const sourceCoverageSchema=z.array(z.strictObject({
 blockId:z.string().min(1).max(180),blockSHA256:z.string().regex(/^[a-f0-9]{64}$/),
 disposition:z.enum(['mapped','context','unresolved','conflict']),
 targetIds:z.array(z.string().min(1).max(250)).max(500),
 reason:z.string().min(10).max(2000)
})).max(5000);

export function documentSourceBlocks(document,text){
 if(document.role==='evaluation_only')throw Error('DOCUMENT_EVALUATION_CONTENT_FORBIDDEN');
 const blocks=[];
 // Stable UTF-16 positions into the original text, including repeated lines.
 // Long lines are bounded for paged tool responses, without losing characters.
 const lines=text.matchAll(/[^\r\n]+/g);
 for(const match of lines){const ends=[];for(let n=0;n<match[0].length;n++){const c=match[0][n];if(/[。；！？]/.test(c)||/[.!?;]/.test(c)&&(n+1===match[0].length||/\s/.test(match[0][n+1])))ends.push(n+1);}if(ends.at(-1)!==match[0].length)ends.push(match[0].length);let offset=0;
 for(const sentenceEnd of ends)while(offset<sentenceEnd){
  const start=match.index+offset;let end=Math.min(start+2000,match.index+sentenceEnd);
  if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;
  const value=text.slice(start,end);offset=end-match.index;if(!value.trim())continue;
  const block={documentId:document.id,textSHA256:document.textSHA256,start,end,text:value};
  blocks.push({...block,blockId:document.id+':'+start+':'+end,blockSHA256:digest(block)});
  if(blocks.length>5000)throw Error('DOCUMENT_SOURCE_BLOCK_BUDGET');
 }}
 return blocks;
}

export function checkSourceCoverage(blocks,targets,decisions,raw,{required=true}={}){
 const entries=sourceCoverageSchema.parse(raw??[]),byId=new Map(blocks.map(b=>[b.blockId,b])),targetIds=new Set(targets.map(t=>t.id)),seen=new Set(),blockers=[];
 if(blocks.length>5000)throw Error('DOCUMENT_SOURCE_BLOCK_BUDGET');
 for(const entry of entries){const b=byId.get(entry.blockId);
  if(!b||seen.has(entry.blockId))throw Error('DOCUMENT_SOURCE_BLOCK_UNKNOWN_OR_DUPLICATE');seen.add(entry.blockId);
  if(entry.blockSHA256!==b.blockSHA256)throw Error('DOCUMENT_SOURCE_BLOCK_CHANGED');
  if(new Set(entry.targetIds).size!==entry.targetIds.length||entry.targetIds.some(id=>!targetIds.has(id)))throw Error('DOCUMENT_SOURCE_TARGET_UNKNOWN_OR_DUPLICATE');
  if(entry.disposition==='mapped'){
   if(!entry.targetIds.length)throw Error('DOCUMENT_SOURCE_MAPPED_TARGET_REQUIRED');
   for(const id of entry.targetIds){const d=decisions.find(d=>d.targetIds.includes(id));
    // A link must be backed by a citation in this exact source block. An
    // unrelated quote elsewhere in the same document is not coverage.
    if(!d||!['supported','assumption'].includes(d.disposition)||!d.citations.some(c=>c.documentId===b.documentId&&c.textSHA256===b.textSHA256&&c.quote.trim().length>=5&&(b.text.includes(c.quote)||c.quote.includes(b.text))))throw Error('DOCUMENT_SOURCE_TARGET_CITATION_REQUIRED');
   }
  }else if(entry.disposition==='context'&&entry.targetIds.length)throw Error('DOCUMENT_SOURCE_CONTEXT_HAS_TARGETS');
  if(['unresolved','conflict'].includes(entry.disposition))blockers.push({code:'DOCUMENT_SOURCE_'+entry.disposition.toUpperCase(),blockId:b.blockId,documentId:b.documentId,targetIds:entry.targetIds,reason:entry.reason});
 }
 const missing=blocks.filter(b=>!seen.has(b.blockId));if(required)for(const b of missing)blockers.push({code:'DOCUMENT_SOURCE_UNREVIEWED',blockId:b.blockId,documentId:b.documentId});
 return {entries,blockers,summary:{required,blocks:blocks.length,reviewed:entries.length,unreviewed:missing.length,mapped:entries.filter(e=>e.disposition==='mapped').length,context:entries.filter(e=>e.disposition==='context').length,unresolved:entries.filter(e=>e.disposition==='unresolved').length,conflicts:entries.filter(e=>e.disposition==='conflict').length,complete:!missing.length&&!blockers.length,semanticCoverageAccepted:false,professionalApproval:false}};
}
