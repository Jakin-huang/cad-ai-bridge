// Derive a compatible serialization from a registered static CAD export.
// Originals are never written here. This is not PDF/A or professional approval.
import crypto from 'node:crypto';
import {PDFDocument,PDFDict,PDFArray,PDFRawStream,PDFRef,PDFName} from 'pdf-lib';
import library from 'pdf-lib/package.json' with {type:'json'};

const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const digest=value=>sha(JSON.stringify(value));
const papers={A4:[297,210],A3:[420,297],A2:[594,420],A1:[841,594],A0:[1189,841]};
const loadOptions={updateMetadata:false,throwOnInvalidObject:true};
const name=value=>PDFName.of(value);
function snapshot(doc,{paper,maxObjects=100000}={}){
 if(!papers[paper])throw Error('PDF_COMPAT_PAPER_UNSUPPORTED');
 if(doc.isEncrypted)throw Error('PDF_COMPAT_ENCRYPTED_UNSUPPORTED');
 const objects=doc.context.enumerateIndirectObjects();if(objects.length>maxObjects)throw Error('PDF_COMPAT_OBJECT_BUDGET');
 for(const [,object]of objects)if(object instanceof PDFDict&&(object.has(name('ByteRange'))||object.get(name('Type'))?.toString()==='/Sig'||object.get(name('FT'))?.toString()==='/Sig'))throw Error('PDF_COMPAT_SIGNATURE_UNSUPPORTED');
 const pages=doc.getPages();if(pages.length!==1)throw Error('PDF_COMPAT_SINGLE_SHEET_REQUIRED');
 const geometry=pages.map(page=>({media:page.getMediaBox(),crop:page.getCropBox(),trim:page.getTrimBox(),bleed:page.getBleedBox(),art:page.getArtBox(),rotation:page.getRotation().angle}));
 const g=geometry[0],size=[g.media.width,g.media.height].map(v=>v*25.4/72);if(Math.abs(g.rotation)%180===90)size.reverse();
 if(!size.every((v,i)=>Number.isFinite(v)&&Math.abs(v-papers[paper][i])<=.2))throw Error('PDF_COMPAT_PAPER_MISMATCH');
 let streams=0;
 const serialize=(object,skipLength=false)=>{
  if(object===undefined)return ['missing'];
  if(object instanceof PDFRef)return ['ref',object.toString()];
  if(object instanceof PDFRawStream){streams++;return ['stream',serialize(object.dict,true),object.getContents().length,sha(object.getContents())];}
  if(object instanceof PDFDict)return ['dict',object.entries().filter(([key])=>!skipLength||key.toString()!=='/Length').sort(([a],[b])=>a.toString().localeCompare(b.toString())).map(([key,value])=>[key.toString(),serialize(value)])];
  if(object instanceof PDFArray)return ['array',object.asArray().map(value=>serialize(value))];
  return ['value',object.toString()];
 };
 // Xref/object-stream containers encode transport offsets or duplicate parsed
 // objects. Payload objects remain individually protected by their fixed refs.
 const payload=objects.filter(([,o])=>!(o instanceof PDFRawStream&&['/XRef','/ObjStm'].includes(o.dict.get(name('Type'))?.toString()))).map(([ref,object])=>[ref.toString(),serialize(object)]);
 const trailer=Object.entries(doc.context.trailerInfo).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[key,serialize(value)]);
 return {graphSHA256:digest({payload,trailer}),geometrySHA256:digest(geometry),geometry,sizeMm:size,objects:payload.length,streams,pageCount:pages.length};
}
async function parse(bytes){try{return await PDFDocument.load(bytes,loadOptions);}catch(error){throw Error('PDF_COMPAT_PARSE_REJECTED: '+error.message);}}
function inputBytes(bytes,maxBytes){if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>maxBytes)throw Error('PDF_COMPAT_INPUT_BUDGET');const copy=Buffer.from(bytes);if(!copy.subarray(0,1024).includes(Buffer.from('%PDF-')))throw Error('PDF_COMPAT_HEADER_INVALID');return copy;}
function compare(a,b){if(a.graphSHA256!==b.graphSHA256||a.geometrySHA256!==b.geometrySHA256)throw Error('PDF_COMPAT_CONTENT_OR_GEOMETRY_CHANGED');}

export async function auditCadPdfNormalization(sourceBytes,outputBytes,{paper,maxBytes=64*1024*1024}={}){
 const source=inputBytes(sourceBytes,maxBytes),output=inputBytes(outputBytes,2*maxBytes),before=snapshot(await parse(source),{paper}),after=snapshot(await parse(output),{paper});compare(before,after);
 return {ok:true,method:'local_pdf_reserialization_with_payload_and_page_geometry_identity',library:{name:'pdf-lib',version:library.version},sourceSHA256:sha(source),outputSHA256:sha(output),sourceBytes:source.length,outputBytes:output.length,pageCount:after.pageCount,paper,sizeMm:after.sizeMm,payloadGraphSHA256:before.graphSHA256,pageGeometrySHA256:before.geometrySHA256,payloadObjects:after.objects,payloadStreams:after.streams,originalSourceRewritten:false,visualComparisonRequired:true,independentStrictReaderRequired:true,pdfACompliance:false,professionalApproval:false};
}

export async function normalizeCadPdf(sourceBytes,{paper,maxBytes=64*1024*1024}={}){
 const source=inputBytes(sourceBytes,maxBytes),document=await parse(source);snapshot(document,{paper});
 const bytes=Buffer.from(await document.save({useObjectStreams:false,addDefaultPage:false,updateFieldAppearances:false,objectsPerTick:50}));
 return {bytes,audit:await auditCadPdfNormalization(source,bytes,{paper,maxBytes})};
}
