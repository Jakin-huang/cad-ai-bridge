// Read-only integration against existing actual deliveries. Does not create or rerun CAD.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {dataHome,outsideProject,projectPath} from '../src/local-paths.mjs';
import {hashFile} from '../src/drawings.mjs';
import {publicFiles} from '../scripts/public-files.mjs';
const folder=outsideProject(path.resolve(process.argv[2]??'')),journals=process.argv.slice(3);assert.ok(process.argv[2]&&journals.length);await fs.mkdir(folder);
const report={ok:false,actualAiClient:false,newNativeCadExecuted:false,professionalApproval:false,cases:[],calls:0},write=(name,value)=>fs.writeFile(path.join(folder,name),JSON.stringify(value,null,2)+'\n');
const client=new Client({name:'project-review-readonly-validation',version:'1'});
async function call(args,negative=false){await fs.appendFile(path.join(folder,'calls.ndjson'),JSON.stringify({args})+'\n');const raw=await client.callTool({name:'cad_engineering_task',arguments:args},{timeout:120000}),r=JSON.parse(raw.content.find(c=>c.type==='text').text);await fs.appendFile(path.join(folder,'calls.ndjson'),JSON.stringify({result:r})+'\n');report.calls++;if(!negative)assert.equal(r.ok,true,JSON.stringify(r));assert.ok(!r.responseTruncated);return r;}
async function filesIn(dir){const rows=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){assert.equal(e.isSymbolicLink(),false);const file=path.join(dir,e.name);if(e.isDirectory())rows.push(...await filesIn(file));else rows.push({file,sha256:await hashFile(file)});}return rows.sort((a,b)=>a.file.localeCompare(b.file));}
try{
 const source=[];for(const file of await publicFiles()){const to=path.join(folder,'source',file);await fs.mkdir(path.dirname(to),{recursive:true});await fs.copyFile(projectPath(file),to,fs.constants.COPYFILE_EXCL);source.push({file,sha256:await hashFile(to)});}await write('source-manifest.json',source);
 await client.connect(new StdioClientTransport({command:process.execPath,args:[projectPath('mcp-server.mjs')],env:{...process.env,CADBRIDGE_READ_ONLY:'1',CADAGENT_ALLOWED_ROOT:dataHome()},stderr:'pipe'}));
 for(const journal of journals){
  const prior=JSON.parse(await fs.readFile(journal,'utf8')),a=prior.spaceTask,b=prior.lightingTask;assert.ok(a&&b);assert.equal(a.project.id,b.project.id);
  const refs=[a,b].map(r=>({jobId:r.jobId,expectedTaskSHA256:r.taskSHA256})),dirs=[a,b].flatMap(r=>[path.join(dataHome(),'runs',r.jobId),path.join(dataHome(),'runs',r.current.jobId)]);
  const before=(await Promise.all(dirs.map(filesIn))).flat();
  const q={action:'project_review',expectedProjectId:a.project.id,tasks:refs,scopeTaskJobId:a.jobId,requiredKinds:['office-space-planning','ordinary-lighting']};
  const summary=await call(q),sections={};
  for(const section of ['tasks','spaces','issues']){const items=[];let offset=0;for(;;){const page=await call({...q,section,offset,limit:25,expectedReportSHA256:summary.reportSHA256});items.push(...page.items);if(!page.hasMore)break;assert.ok(page.nextOffset>offset);offset=page.nextOffset;}sections[section]=items;}
  assert.equal(summary.summary.scopeSpaces,11);assert.equal(sections.tasks.length,2);assert.equal(sections.spaces.length,11);
  const coverage=sections.spaces.filter(s=>s.disciplines.find(d=>d.kind==='ordinary-lighting').deliveredBy.length===1);assert.equal(coverage.length,5);assert.equal(summary.summary.issuesByCode.SPACE_DELIVERY_MISSING,6);assert.equal(summary.summary.deliveryCoverageComplete,false);assert.equal(summary.engineeringAcceptance,false);
  const bad=await call({...q,expectedReportSHA256:'f'.repeat(64)},true);assert.equal(bad.ok,false);assert.match(JSON.stringify(bad),/SNAPSHOT_CHANGED/);
  const again=await call(q);assert.equal(again.reportSHA256,summary.reportSHA256);assert.deepEqual((await Promise.all(dirs.map(filesIn))).flat(),before);
  const item={sourceJournal:journal,sourceJournalSHA256:await hashFile(journal),summary,sections,protectedFiles:before};report.cases.push(item);await write('report.json',report);
 }
 report.ok=true;report.scope='Existing known developer projects and actual delivered files; read-only coverage/issue aggregation, not new design quality, actual AI understanding or independent customer acceptance';await write('report.json',report);console.log(JSON.stringify({ok:true,cases:report.cases.length,calls:report.calls,protectedFiles:report.cases.reduce((n,c)=>n+c.protectedFiles.length,0),coverage:report.cases.map(c=>({spaces:c.summary.summary.scopeSpaces,missingDelivery:c.summary.summary.issuesByCode.SPACE_DELIVERY_MISSING,issues:c.summary.summary.openIssues}))}));
}catch(e){report.error=e.stack;await write('report.json',report);throw e;}finally{await client.close().catch(()=>{});}
