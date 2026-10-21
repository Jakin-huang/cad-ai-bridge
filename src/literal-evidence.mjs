// Domain-neutral literal source checks. Never rewrite a quote or infer meaning.
import crypto from 'node:crypto';
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
export function assertLiteralEvidence(text,records,{code='LITERAL_EVIDENCE_INVALID',sourceTextSHA256,maxDetails=12}={}){
 if(typeof text!=='string'||!Array.isArray(records)||records.length>4096||!/^[A-Z][A-Z0-9_]{3,80}$/.test(code)||!Number.isInteger(maxDetails)||maxDetails<1||maxDetails>50||records.some(r=>!r||typeof r.path!=='string'||!r.path.length||r.path.length>256||typeof r.quote!=='string'||!r.quote.length||r.quote.length>16000)||new Set(records.map(r=>r.path)).size!==records.length)throw Error('LITERAL_EVIDENCE_ARGUMENTS: bounded text records and unique field paths required');
 const sourceSHA256=digest(text);if(sourceTextSHA256!==undefined&&sourceTextSHA256.toLowerCase()!==sourceSHA256)throw Error('LITERAL_EVIDENCE_SOURCE_CHANGED: text does not match declared source');
 const invalid=records.filter(r=>!text.includes(r.quote));
 if(invalid.length){const details={sourceTextSHA256:sourceSHA256,invalidCount:invalid.length,invalidEvidence:invalid.slice(0,maxDetails).map(r=>({path:r.path,quoteSHA256:digest(r.quote),quoteLength:r.quote.length})),truncated:invalid.length>maxDetails,repair:'Read the named fields against this exact source. Submit an unchanged continuous source substring; do not concatenate separate sentences or normalize whitespace. No replacement or semantic decision was made.'};throw Error(code+': '+JSON.stringify(details));}
 return {checked:records.length,sourceTextSHA256:sourceSHA256,semanticCoverageAccepted:false};
}
