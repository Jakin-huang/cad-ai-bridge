import fs from 'node:fs/promises';
import path from 'node:path';
import {dataHome} from './local-paths.mjs';
import {hashFile} from './drawings.mjs';

// Imported local evidence is separate from AI-authored project input. A caller
// cannot establish clause verification merely by passing verified=true.
export async function resolveEngineeringStandards(input,{profile=process.env.CADBRIDGE_ENGINEERING_STANDARDS||path.join(dataHome(),'engineering-standards.json')}={}){
 let registry;try{registry=JSON.parse(await fs.readFile(profile,'utf8'));}catch(error){if(error.code==='ENOENT')return [];throw error;}
 const evidence=[];
 for(const item of registry.standards||[]){
  if(!item.sourceFile||await hashFile(item.sourceFile).catch(()=>null)!==item.sourceSHA256)continue;
  for(const standard of input.standards){const source=input.sources.find(s=>s.id===standard.sourceId);if(source?.role!=='standard'||source.sha256.toLowerCase()!==item.sourceSHA256.toLowerCase()||standard.code.replace(/\s/g,'')!==item.code.replace(/\s/g,''))continue;
   for(const clause of standard.clauses){const imported=item.clauses.find(c=>c.locator===clause.locator.split(/[ /]/)[0]&&c.check===clause.check);if(imported&&item.effectiveFrom<=input.designDate&&(!item.effectiveUntil||input.designDate<item.effectiveUntil))evidence.push({standardId:standard.id,clauseId:clause.id,locator:imported.locator,sourceSHA256:item.sourceSHA256,page:imported.page,textSHA256:imported.textSHA256,method:'Imported source PDF page text and bounded rule anchors; professional applicability remains separate'});}
  }
 }
 return evidence;
}
