// Mechanical preflight only. No replacement prose or engineering interpretation.
import {readDocumentText,documentBytesSHA} from './project-document-store.mjs';
export async function verifyIntakeEvidence(parameters,documents){
 const rows=[],add=(item,path)=>item.evidence.forEach((e,i)=>rows.push({...e,path:path+'.evidence['+i+'].quote'}));
 add(parameters.frozen,'parameters.frozen');
 for(const key of ['roomUses','requirements','program','relations','additionalPending'])for(const [i,item]of (parameters[key]??[]).entries())add(item,'parameters.'+key+'['+i+']');
 if(parameters.selection)add(parameters.selection,'parameters.selection');
 const texts=new Map(),invalid=[];let invalidCount=0;
 for(const row of rows){
  if(!texts.has(row.documentId))texts.set(row.documentId,await readDocumentText(documents,row.documentId));
  const source=texts.get(row.documentId);
  if(!source.text.includes(row.quote)){
   invalidCount++;
   if(invalid.length<12)invalid.push({path:row.path,documentId:row.documentId,sourceTextSHA256:source.document.textSHA256,quoteSHA256:documentBytesSHA(row.quote),quoteLength:row.quote.length});
  }
 }
 if(invalidCount)throw Error('INTAKE_LITERAL_EVIDENCE_INVALID: '+JSON.stringify({documents:documents.ref,invalidCount,invalidEvidence:invalid,truncated:invalidCount>invalid.length,repair:'Read these exact fields against the named frozen original document and text SHA256. Submit continuous unchanged source substrings; do not concatenate separate sentences or normalize whitespace. No replacement quote, numeric value, priority, authority or approval was chosen.'}));
 return texts;
}
