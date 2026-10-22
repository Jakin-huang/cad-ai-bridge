// Export a frozen local review snapshot. No design mutations or native CAD work.
import fs from 'node:fs/promises';import path from 'node:path';
import {dependencyDigest} from './task-dependencies.mjs';import {hashFile,isWithin} from './drawings.mjs';import {atomicJson} from './files.mjs';import {projectReviewHtml} from './project-review-report.mjs';
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
export async function verifyProjectReviewPackage(folder,expectedManifestSHA256){
 const real=await fs.realpath(folder);if((await fs.lstat(folder)).isSymbolicLink())throw Error('PROJECT_PACKAGE_OUTSIDE_FOLDER');
 const manifestFile=await fs.realpath(path.join(real,'manifest.json'));if(!isWithin(real,manifestFile))throw Error('PROJECT_PACKAGE_OUTSIDE_FOLDER');if(await hashFile(manifestFile)!==expectedManifestSHA256)throw Error('PROJECT_PACKAGE_MANIFEST_CHANGED');const manifest=await read(manifestFile);
 for(const f of manifest.files){if(path.isAbsolute(f.path)||f.path.split(/[\\/]/).includes('..'))throw Error('PROJECT_PACKAGE_OUTSIDE_FOLDER');const file=await fs.realpath(path.join(real,f.path));if(!isWithin(real,file)||await hashFile(file)!==f.sha256)throw Error('PROJECT_PACKAGE_FILE_CHANGED');}
 return manifest;
}
export async function publishProjectReviewPackage({runs,q,report,snapshots,assertCurrent}){
 if(report.reportSHA256!==q.expectedReportSHA256.toLowerCase())throw Error('PROJECT_REVIEW_SNAPSHOT_CHANGED');
 const root=await fs.realpath(runs),jobId='job-projectreview-'+q.requestId,folder=path.join(root,jobId),fingerprint=dependencyDigest(q);
 const response=(manifest,sha256)=>({ok:true,jobId,folder,entry:path.join(folder,'index.html'),reportSHA256:report.reportSHA256,manifestSHA256:sha256,summary:report.summary,files:[...manifest.files,{path:'manifest.json',sha256}].map(f=>({kind:f.kind??(f.path.endsWith('.html')?'html':'json'),file:path.join(folder,f.path),sha256:f.sha256})),reviewStatus:'awaiting_human_review',engineeringAcceptance:false,professionalApproval:false,historicalSnapshot:true});
 try{await fs.mkdir(folder);}catch(error){
  if(error.code!=='EEXIST')throw error;
  if((await fs.lstat(folder)).isSymbolicLink()||!isWithin(root,await fs.realpath(folder)))throw Error('PROJECT_PACKAGE_OUTSIDE_RUNS');
  const request=await read(path.join(folder,'request.json'));if(request.fingerprint!==fingerprint)throw Error('PROJECT_PACKAGE_REQUEST_CONFLICT');
  const result=await read(path.join(folder,'result.json')).catch(()=>undefined);if(!result?.ok)throw Error('PROJECT_PACKAGE_UNCONFIRMED: inspect retained files; no automatic overwrite');
  const manifest=await verifyProjectReviewPackage(folder,result.manifestSHA256);if(manifest.reportSHA256!==report.reportSHA256||manifest.requestId!==q.requestId||manifest.projectId!==report.projectId)throw Error('PROJECT_PACKAGE_IDENTITY_CHANGED');await assertCurrent();return {...response(manifest,result.manifestSHA256),replayed:true};
 }
 const write=async(name,value)=>{const file=path.join(folder,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx'});return {path:name,sha256:await hashFile(file)};};
 await write('request.json',{fingerprint,request:q});const task={jobId,action:'project_review_package',requestId:q.requestId,status:'running',phase:'copying_review_snapshot',ownerPid:process.pid};await atomicJson(path.join(folder,'task.json'),task);
 try{
  const createdAt=new Date().toISOString(),files=[],outputs=[];let totalBytes=0;
  for(const [index,t] of report.tasks.entries())for(const [i,f] of t.files.entries()){
   if(outputs.length>=10000)throw Error('PROJECT_PACKAGE_FILE_BUDGET');
   const source=await fs.realpath(f.file);if(!isWithin(root,source))throw Error('PROJECT_PACKAGE_SOURCE_OUTSIDE_RUNS');
   const stat=await fs.stat(source);totalBytes+=stat.size;if(!stat.isFile()||totalBytes>2*1024**3)throw Error('PROJECT_PACKAGE_SIZE_BUDGET');
   if(await hashFile(source)!==f.sha256)throw Error('PROJECT_PACKAGE_SOURCE_CHANGED');
   const name=path.basename(source),ext=path.extname(source);if(!/^\.[a-z0-9]{1,12}$/i.test(ext))throw Error('PROJECT_PACKAGE_EXTENSION_UNSUPPORTED');
   const relative=`outputs/task-${index+1}/${i+1}${ext.toLowerCase()}`,to=path.join(folder,relative);await fs.mkdir(path.dirname(to),{recursive:true});await fs.copyFile(source,to,fs.constants.COPYFILE_EXCL);
   if(await hashFile(to)!==f.sha256||await hashFile(source)!==f.sha256)throw Error('PROJECT_PACKAGE_SOURCE_CHANGED');
   const entry={taskJobId:t.jobId,kind:f.kind,name,path:relative,sha256:f.sha256,source:f.file};files.push(entry);outputs.push(entry);
  }
  const evidence=snapshots.map(s=>({jobId:s.status.jobId,graph:s.graph??null,scope:s.scope??null}));
  files.push(await write('report.json',report));files.push(await write('evidence.json',evidence));files.push(await write('index.html',projectReviewHtml({report,evidence,files:outputs,createdAt})));
  const manifest={schemaVersion:1,requestId:q.requestId,createdAt,projectId:report.projectId,reportSHA256:report.reportSHA256,scope:report.scope,files,sourceFileCount:outputs.length,totalSourceBytes:totalBytes,reviewStatus:'awaiting_human_review',engineeringAcceptance:false,professionalApproval:false,historicalSnapshot:true};
  const manifestEntry=await write('manifest.json',manifest);await verifyProjectReviewPackage(folder,manifestEntry.sha256);await assertCurrent();
  const result=response(manifest,manifestEntry.sha256);
  await atomicJson(path.join(folder,'task.json'),{...task,status:'completed',phase:'review_snapshot_published'});await write('result.json',result);return result;
 }catch(error){await atomicJson(path.join(folder,'task.json'),{...task,status:'blocked',phase:'publication_unconfirmed',error:error.message});throw error;}
}
