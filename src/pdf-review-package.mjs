// Shared, non-native review-artifact stage for delivered design packs.
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
import {dependencyDigest} from './task-dependencies.mjs';import {hashFile,isWithin} from './drawings.mjs';
const dependencyBytes=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

export function pdfReviewSource(state){
 const d=state.delivery;if(!d||!state.modelSHA256||state.status!=='delivered')return undefined;
 const pdfs=d.files.filter(f=>f.kind==='pdf').map(f=>({id:path.basename(f.file,'.pdf'),sha256:f.sha256})).sort((a,b)=>a.id.localeCompare(b.id));
 if(!pdfs.length||new Set(pdfs.map(f=>f.id)).size!==pdfs.length)return undefined;
 const identity={version:1,jobId:state.jobId,revision:state.revision,inputSHA256:state.inputSHA256,modelSHA256:state.modelSHA256,drawingSHA256:d.drawingSHA256,pdfs};return {...identity,sha256:dependencyDigest(identity)};
}
export function currentPdfReview(state){const source=pdfReviewSource(state),p=state.pdfReview;return source&&p&&source.sha256===p.sourceSHA256&&state.modelSHA256===p.modelSHA256?p:undefined;}
export function pdfReviewFiles(state){
 if(!state.delivery)return undefined;const p=currentPdfReview(state);if(!p)return state.files??state.delivery.files;
 const base=new Map([...state.delivery.files,...(state.files??[])].map(f=>[f.file,f])),others=[...base.values()].filter(f=>!['pdf','pdf_source'].includes(f.kind)&&!isWithin(p.folder,f.file));
 return [...p.files,...others,...state.delivery.files.filter(f=>f.kind==='pdf').map(f=>({...f,kind:'pdf_source',label:'原始CAD导出PDF（保留来源）'}))];
}
export async function verifyPdfReview(state,{dir}){
 const p=currentPdfReview(state);if(!p)return undefined;
 if(await hashFile(state.delivery.drawing)!==state.delivery.drawingSHA256)throw Error('PDF_REVIEW_DRAWING_CHANGED');
 if(!/^[a-f0-9-]{36}$/i.test(p.requestId)||path.resolve(p.folder)!==path.resolve(dir,'pdf-review-'+p.requestId)||path.resolve(p.manifestFile)!==path.resolve(p.folder,'manifest.json'))throw Error('PDF_REVIEW_PACKAGE_IDENTITY_CHANGED');
 const folder=await fs.realpath(p.folder);if((await fs.lstat(p.folder)).isSymbolicLink()||!isWithin(await fs.realpath(dir),folder))throw Error('PDF_REVIEW_PACKAGE_OUTSIDE_JOB');const manifest=JSON.parse(await fs.readFile(p.manifestFile,'utf8'));if(await hashFile(p.manifestFile)!==p.manifestSHA256||manifest.sourceSHA256!==p.sourceSHA256||manifest.requestId!==p.requestId||manifest.modelSHA256!==state.modelSHA256)throw Error('PDF_REVIEW_MANIFEST_CHANGED');
 const pdfs=p.files.filter(f=>f.kind==='pdf');if(pdfs.length!==manifest.files.length)throw Error('PDF_REVIEW_FILE_COVERAGE_CHANGED');
 for(const f of p.files){const real=await fs.realpath(f.file);if(!isWithin(folder,real)||await hashFile(real)!==f.sha256)throw Error('PDF_REVIEW_FILE_CHANGED');}
 for(const f of manifest.files){const item=pdfs.find(p=>p.file===f.file&&p.sha256===f.sha256);if(!item||f.audit.outputSHA256!==f.sha256||await hashFile(f.source)!==f.sourceSHA256)throw Error('PDF_REVIEW_SOURCE_OR_OUTPUT_CHANGED');}
 return p;
}
export async function preparePdfReview({state,model,dir,runs,requestId,expectedSourceSHA256}){
 if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestId))throw Error('PDF_REVIEW_REQUEST_ID_INVALID');requestId=requestId.toLowerCase();
 const source=pdfReviewSource(state);if(!source)throw Error('PDF_REVIEW_DELIVERY_REQUIRED');if(source.sha256!==expectedSourceSHA256.toLowerCase())throw Error('PDF_REVIEW_SOURCE_CHANGED');
 if(model.sheets.length!==source.pdfs.length||model.sheets.some(s=>!source.pdfs.some(f=>f.id===s.id)))throw Error('PDF_REVIEW_MODEL_SHEETS_MISMATCH');
 if(currentPdfReview(state)){await verifyPdfReview(state,{dir});return {package:state.pdfReview,reused:true};}
 const {normalizeCadPdf}=await import('./cad-pdf-compatibility.mjs'),root=await fs.realpath(runs),prepared=[];
 if(await hashFile(state.delivery.drawing)!==state.delivery.drawingSHA256)throw Error('PDF_REVIEW_DRAWING_CHANGED');
 for(const sheet of model.sheets){const f=state.delivery.files.find(f=>f.kind==='pdf'&&path.basename(f.file,'.pdf')===sheet.id),real=await fs.realpath(f.file);if(!isWithin(root,real)||await hashFile(real)!==f.sha256)throw Error('PDF_REVIEW_SOURCE_CHANGED');const normalized=await normalizeCadPdf(await fs.readFile(real),{paper:sheet.paper??'A3'});if(normalized.audit.sourceSHA256!==f.sha256)throw Error('PDF_REVIEW_SOURCE_CHANGED');prepared.push({sheet:sheet.id,paper:sheet.paper??'A3',source:real,sourceSHA256:f.sha256,...normalized});}
 const folder=path.join(dir,'pdf-review-'+requestId);await fs.mkdir(folder).catch(error=>{if(error.code!=='EEXIST')throw error;});if((await fs.lstat(folder)).isSymbolicLink()||!isWithin(await fs.realpath(dir),await fs.realpath(folder)))throw Error('PDF_REVIEW_OUTPUT_OUTSIDE_PACKAGE');
 const names=new Set([...prepared.map(p=>p.sheet+'.pdf'),'manifest.json']);if((await fs.readdir(folder)).some(file=>!names.has(file)))throw Error('PDF_REVIEW_UNEXPECTED_FILES');
 const write=async(file,bytes)=>{try{await fs.writeFile(file,bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST'||await hashFile(file)!==dependencyBytes(bytes))throw Error('PDF_REVIEW_EXISTING_FILE_CHANGED');}},files=[];
 for(const item of prepared){const file=path.resolve(folder,item.sheet+'.pdf');if(!isWithin(folder,file))throw Error('PDF_REVIEW_OUTPUT_OUTSIDE_PACKAGE');await write(file,item.bytes);files.push({kind:'pdf',sheet:item.sheet,paper:item.paper,file,sha256:await hashFile(file),source:item.source,sourceSHA256:item.sourceSHA256,audit:item.audit});}
 for(const f of files)if(await hashFile(f.source)!==f.sourceSHA256)throw Error('PDF_REVIEW_SOURCE_CHANGED');if(await hashFile(state.delivery.drawing)!==state.delivery.drawingSHA256)throw Error('PDF_REVIEW_DRAWING_CHANGED');
 const manifest={schemaVersion:1,requestId,sourceSHA256:source.sha256,source,modelSHA256:state.modelSHA256,files,reviewStatus:'awaiting_human_review',validation:'Payload objects, page geometry and output reparse verified locally. External strict-reader and visual validation are separate.',independentStrictReaderAccepted:false,visualAccepted:false,professionalApproval:false},manifestFile=path.join(folder,'manifest.json');await write(manifestFile,Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
 const packet={requestId,sourceSHA256:source.sha256,modelSHA256:state.modelSHA256,folder,manifestFile,manifestSHA256:await hashFile(manifestFile),files:[...files.map(({kind,file,sha256,sheet})=>({kind,file,sha256,sheet})),{kind:'json',file:manifestFile,sha256:await hashFile(manifestFile)}],reviewStatus:'awaiting_human_review',independentStrictReaderAccepted:false,visualAccepted:false,professionalApproval:false};
 await verifyPdfReview({...state,pdfReview:packet},{dir});return {package:packet,reused:false};
}
