import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {jobDirectory,jobJson,registeredFiles,registeredJobResult} from './jobs.mjs';
import {isWithin} from './drawings.mjs';
import {boundForTransport} from './results.mjs';
const actions=new Set(['capabilities','doctor','get_job','read_result','project','analyze','scan','workflow','engineering','engineering_task','project_documents','engineering_intake','engineering_title','engineering_notes']);
export function taskCenterDocument(raw){const html=raw.replace(/\r\n?/g,'\n'),script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1]??'';return {html,scriptHash:crypto.createHash('sha256').update(script).digest('base64')};}
export async function listJobs(runs,{offset=0,limit=30,snapshot}={}){
 const entries=(await fs.readdir(runs,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;})).filter(entry=>entry.isDirectory()&&/^job-[A-Za-z0-9_-]+$/.test(entry.name)),ranked=[],jobs=[];
 // Reading every historical journal is costly on Windows and unnecessary for
 // one page. Atomic journal replacement updates its directory's timestamp.
 if(snapshot)ranked.push(...snapshot.map(name=>({entry:{name}})));else{for(let i=0;i<entries.length;i+=32)ranked.push(...await Promise.all(entries.slice(i,i+32).map(async entry=>({entry,mtime:(await fs.stat(path.join(runs,entry.name)).catch(()=>({mtimeMs:0}))).mtimeMs}))));ranked.sort((a,b)=>b.mtime-a.mtime||a.entry.name.localeCompare(b.entry.name));}
 for(const {entry}of ranked.slice(offset,offset+limit)){
  try{const task=await jobJson(await jobDirectory(runs,entry.name),'task.json');jobs.push({jobId:entry.name,action:task.action,status:task.status,phase:task.phase,updatedAt:task.updatedAt??task.startedAt,requestId:task.requestId,itemCount:task.items?.length});}
  catch(error){jobs.push({jobId:entry.name,status:'unconfirmed',error:'Task journal unavailable; inspect retained evidence'});}
 }
 return {ok:true,jobs,total:ranked.length,nextOffset:offset+jobs.length,hasMore:offset+jobs.length<ranked.length,orderedJobIds:ranked.map(r=>r.entry.name)};
}
export async function startTaskCenter({execute,runs,port=0}={}){
 if(typeof execute!=='function')throw Error('TASK_EXECUTOR_REQUIRED');
 const token=crypto.randomBytes(32).toString('hex'),{html,scriptHash}=taskCenterDocument(await fs.readFile(fileURLToPath(new URL('./task-center.html',import.meta.url)),'utf8'));
 let origin;
 const snapshots=new Map();
 const server=http.createServer(async(req,res)=>{
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  try{
   if(req.headers.host!==origin?.slice(7)||req.headers.origin&&req.headers.origin!==origin)return send(403,{ok:false,error:'Local origin required'});
   const url=new URL(req.url,origin);
   if(req.method==='GET'&&url.pathname==='/'){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':`default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`});return res.end(html);
   }
   const supplied=req.headers.authorization??'',expected='Bearer '+token;
   if(Buffer.byteLength(supplied)!==Buffer.byteLength(expected)||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))return send(401,{ok:false,error:'Local access token required'});
   if(req.method==='POST'&&url.pathname==='/api/shutdown'){req.resume();send(200,{ok:true,message:'Local entry closed; in-flight drawing work retains its evidence and finishes normally.'});server.close();return;}
   if(req.method==='GET'&&url.pathname==='/api/jobs'){
    const offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??30);if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)return send(400,{ok:false,error:'Invalid page'});
    const requested=url.searchParams.get('snapshot');for(const [key,value]of snapshots)if(Date.now()-value.at>300000)snapshots.delete(key);if(requested&&!snapshots.has(requested))return send(409,{ok:false,error:'任务列表快照已过期，请刷新后继续。'});
    const {orderedJobIds,...result}=await listJobs(runs,{offset,limit,snapshot:requested?snapshots.get(requested).ids:undefined}),snapshotId=requested??crypto.randomBytes(12).toString('hex');if(!requested){while(snapshots.size>=8)snapshots.delete(snapshots.keys().next().value);snapshots.set(snapshotId,{at:Date.now(),ids:orderedJobIds});}return send(200,{...result,snapshotId});
   }
   if(req.method==='GET'&&url.pathname==='/api/file'){
    const result=await registeredJobResult(runs,url.searchParams.get('jobId')??''),index=Number(url.searchParams.get('index')),expected=url.searchParams.get('sha256'),files=registeredFiles(result);
    if(expected&&!/^[a-f0-9]{64}$/i.test(expected))return send(400,{ok:false,error:'Invalid deliverable identity'});
    // A completed CAD delivery can reorder the earlier quality-only file list.
    // Resolve the exact displayed bytes rather than an obsolete array position.
    const file=expected?files.find(f=>f.sha256.toLowerCase()===expected.toLowerCase()):files[index];
    if(expected&&!file)return send(409,{ok:false,error:'Deliverable list changed; refresh the task'});
    if(!expected&&(!Number.isSafeInteger(index)||!file))return send(404,{ok:false,error:'No registered deliverable'});
    const resolved=await fs.realpath(file.file),root=await fs.realpath(runs);if(!isWithin(root,resolved))return send(403,{ok:false,error:'Deliverable escapes task outputs'});
    if(!['.dwg','.dxf','.pdf','.png','.csv','.json','.html'].includes(path.extname(resolved).toLowerCase()))return send(403,{ok:false,error:'Unsupported deliverable format'});
    const bytes=await fs.readFile(resolved);if(crypto.createHash('sha256').update(bytes).digest('hex')!==file.sha256)return send(409,{ok:false,error:'Deliverable changed since verification'});
    res.writeHead(200,{'Content-Type':path.extname(resolved).toLowerCase()==='.png'?'image/png':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(path.basename(resolved))}`,'Content-Length':bytes.length});return res.end(bytes);
   }
   if(req.method==='POST'&&url.pathname==='/api/call'){
    if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{ok:false,error:'JSON required'});
    const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>2*1024*1024)return send(413,{ok:false,error:'Request exceeds 2 MiB'});parts.push(part);}
    const input=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!actions.has(input.action))return send(400,{ok:false,error:'Unsupported task action'});
    const result=await execute(input.action,input.args??{});return send(200,boundForTransport(result));
   }
   send(404,{ok:false,error:'Not found'});
  }catch(error){send(400,{ok:false,error:{code:error.message.split(':')[0],message:error.message}});}
 });
 server.requestTimeout=600000;server.headersTimeout=15000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
 return {url:origin+'/#token='+token,origin,token,server,close:()=>new Promise((resolve,reject)=>server.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve()))};
}
