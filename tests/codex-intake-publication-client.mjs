// Actual client product use, continuing one independently audited synthetic
// task. No coding delegation, input migration, controller design or new task.
import fs from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {outsideProject,projectPath} from '../src/local-paths.mjs';
import {hashFile} from '../src/drawings.mjs';
import {engineeringDigest} from '../src/engineering-design.mjs';
import {auditEngineeringDesign} from '../src/engineering-verification.mjs';
import {taskDocumentStatus,verifyDocumentReview} from '../src/project-document-store.mjs';
import {publicFiles} from '../scripts/public-files.mjs';

const [cli,trialArgument,rootArgument]=process.argv.slice(2);
assert.ok(cli&&trialArgument&&rootArgument);
const trial=outsideProject(path.resolve(trialArgument)),root=outsideProject(path.resolve(rootArgument));
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const save=(f,v)=>fs.writeFile(f,JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const e=await read(trial+'/experiment.json'),audit=await read(trial+'/independent-audit.json');
assert.equal(e.syntheticNonPrivate,true);assert.equal(e.controllerSemanticRepair,false);assert.equal(audit.wholeClientTrialPassed,true);
assert.equal(audit.rawTraceSHA256,await hashFile(trial+'/events.ndjson'));
assert.equal(await hashFile(trial+'/workspace/baseline.json'),'65f968329808c9e055e7b2118bca32fd111ed03ca4c154d0f707c301ee27e539');
const old=await read(trial+'/workspace/context.json'),runs=trial+'/data/runs';
const commit=await read(path.join(runs,old.baseline.jobId,'commit.json'));
const binding=await read(path.join(runs,commit.task.jobId,'binding.json'));
const dir=path.join(runs,binding.childJobId),before=await read(dir+'/engineering.json');
const modelFile=path.join(dir,'model-'+before.revision+'.json'),inputFile=path.join(dir,'input-'+before.revision+'.json'),model=await read(modelFile);
assert.equal(before.inputSHA256,audit.design.inputSHA256);assert.equal(before.modelSHA256,audit.design.modelSHA256);
assert.equal(engineeringDigest(model),before.modelSHA256);assert.equal(auditEngineeringDesign(model).ok,true);
assert.equal(before.status,'designed');assert.equal(before.delivery,undefined);
assert.equal(model.input.photometricDesign,undefined);assert.equal(model.input.lightingEnvironment,undefined);
assert.equal((await taskDocumentStatus({runs,childJobId:binding.childJobId,inputSHA256:before.inputSHA256,modelSHA256:before.modelSHA256,modelBindingSHA256:before.documentModelBindingSHA256,requireCurrent:true,requireModel:true})).eligible,true);
await verifyDocumentReview(runs,commit.review);
await fs.mkdir(root);const workspace=root+'/workspace';await fs.mkdir(workspace);
// A forensic byte snapshot preserves the exact designed-phase evidence before
// this explicitly authorized continuation changes the original task's phase.
await fs.cp(trial+'/data',root+'/before-data',{recursive:true,force:false,errorOnExist:true});
const snapshot=[];
async function walk(dir,relative=''){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const rel=path.join(relative,entry.name),file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file,rel);else if(entry.isFile())snapshot.push({file:path.join('data',rel),sha256:await hashFile(file)});else throw new Error('Unexpected non-file snapshot entry');}}
await walk(root+'/before-data');await save(root+'/before-data-manifest.json',snapshot);
const context={syntheticNonPrivate:true,kind:'ordinary-lighting',task:commit.task,designJobId:binding.childJobId,expectedRevision:before.revision,expectedInputSHA256:before.inputSHA256,expectedModelSHA256:before.modelSHA256,expectedSheets:model.sheets.map(s=>({id:s.id,title:s.title,paper:s.paper??'A3'})),scope:'Same adopted synthetic flux-method model only; native draft and pending review packet, not professional or photometric acceptance.',professionalApproval:false};
await save(workspace+'/context.json',context);await save(root+'/state-before.json',before);
const protectedFiles=[];
for(const file of [...new Set([inputFile,modelFile,path.join(dir,'checks-'+before.revision+'.json'),...e.protectedFiles.map(f=>f.file),path.join(runs,old.baseline.jobId,'baseline.bin'),path.join(runs,old.baseline.jobId,'baseline.json'),path.join(runs,audit.draft.jobId,'draft.json'),path.join(runs,commit.review.jobId,'review.json'),path.join(dir,'document-binding.json')])])protectedFiles.push({file,sha256:await hashFile(file)});
await save(root+'/protected-before.json',protectedFiles);
const source=[];
for(const file of await publicFiles()){const dest=path.join(root,'source',file);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(projectPath(file),dest);source.push({file,sha256:await hashFile(dest)});}
await save(root+'/source-manifest.json',source);
const skillFiles=['skills/cadbridge-electrical/SKILL.md','skills/cadbridge-electrical/references/engineering-design.md','skills/cadbridge-electrical/references/engineering-agent-loop.md'];
const technical=await Promise.all(skillFiles.map(file=>fs.readFile(projectPath(file),'utf8')));
const prompt=`这是CAD AI Bridge产品实际使用验证，不是代码开发。只使用本次开放的cad_engineering_task，不执行命令、不读写本地文件、不写代码、不联网、不委派。完全合成任务，不含客户或医院资料。上下文：${JSON.stringify(context)}
用task完整身份status核对当前revision/inputSHA256/modelSHA256、documentEvidence current/eligible和pending。这个同一任务已完成需求解释、审阅、采纳和设计，禁止prepare/draft/commit/design/revise、另建任务或更改任何条件。本模型仅流明估算，缺真实IES和环境，禁止光学评估或质量验收声明。
先用capabilities kind=ordinary-lighting section=operations operation=deliver查看契约：全局capabilities不带任务身份；只有status和invoke带task的完整身份。未交付时只invoke一次deliver，parameters={expectedModelSHA256:核对后的摘要}，requestId自行生成UUID。由Bridge实际CAD新建、保存重开、实体核对和出图。如返回不明，先status核对收据/nativeSteps，不能换UUID重复CAD或新建任务。
再status读取真实pdfReviewSourceSHA256，查capabilities operation=review_pdfs后，invoke一次review_pdfs，传当前expectedModelSHA256和expectedSourceSHA256以及新UUID。最后status核对当前DWG与每张kind=pdf审核PDF；pdf_source不是审核版。只允许capabilities、同任务status、这两个invoke。中间不需要用户决定，不能只报告计划。
中文简要报告实际结果、待审限制；用绝对路径Markdown链接列出当前DWG和每一张审核PDF。成果为待人工审核的草案，不能把执行/数值自检/格式检查当作光学、规范适用性、施工或专业签审通过。
公开Skill及技术参考原文随初始提示提供，不代表Read调用：\n${technical.join('\n\n')}`;
await fs.writeFile(root+'/prompt.txt',prompt,{flag:'wx'});
await save(root+'/experiment.json',{clientKind:'codex-cli',skillDelivery:'initial_prompt',skillFiles:await Promise.all(skillFiles.map(async file=>({file,sha256:await hashFile(path.join(root,'source',file))}))),stdinSHA256:await hashFile(root+'/prompt.txt'),syntheticNonPrivate:true,knownFixtureContinuation:true,controllerSemanticRepair:false,priorWholeClientTrialPassed:true,priorAuditSHA256:await hashFile(trial+'/independent-audit.json'),priorTraceSHA256:audit.rawTraceSHA256,trialRoot:trial,task:commit.task,childJobId:binding.childJobId,cliSHA256:await hashFile(cli),expectedCreatedPdfs:model.sheets.length*2,modelSHA256:before.modelSHA256,inputSHA256:before.inputSHA256,privateOracleNotProvided:true,modelProvider:'Installed Codex CLI runtime default; no model or provider override',sourceManifestSHA256:await hashFile(root+'/source-manifest.json'),newNativeCadAuthorized:true,physicalLightingQualityAccepted:false,professionalApproval:false});
const config={command:process.execPath,args:[projectPath('mcp-server.mjs')],env:{CADBRIDGE_DATA_HOME:trial+'/data',CADAGENT_ALLOWED_ROOT:workspace,CADBRIDGE_READ_ONLY:'0'},enabled_tools:['cad_engineering_task'],required:true,startup_timeout_sec:30,tool_timeout_sec:600,default_tools_approval_mode:'approve'};
const toml=v=>typeof v==='object'&&!Array.isArray(v)?'{'+Object.entries(v).map(([k,value])=>JSON.stringify(k)+'='+toml(value)).join(',')+'}':JSON.stringify(v);
const args=['exec','--ignore-user-config','--ephemeral','--json','--skip-git-repo-check','--sandbox','read-only','--cd',workspace,'-c','approval_policy="never"','-c','features.shell_tool=false','-c','features.multi_agent=false','-c','features.apply_patch_freeform=false','-c','web_search="disabled"'];
for(const [key,value]of Object.entries(config))args.push('-c','mcp_servers.cad-ai-bridge.'+key+'='+toml(value));args.push('-');
await save(root+'/invocation.json',{cli,args,modelOverride:false,credentialValuesRead:false});
const started=Date.now();console.log(JSON.stringify({started:true,root,client:'Codex CLI',task:commit.task.jobId,sheets:model.sheets.length}));
const child=spawn(cli,args,{cwd:workspace,windowsHide:true,stdio:['pipe','pipe','pipe']});
await fs.writeFile(root+'/process.json',JSON.stringify({status:'running',pid:child.pid,harnessPid:process.pid,startedAt:new Date().toISOString()})+'\n');
child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
child.stdout.on('data',s=>appendFileSync(root+'/events.ndjson',s));child.stderr.on('data',s=>appendFileSync(root+'/stderr.txt',s));child.stdin.end(prompt);
const result=await new Promise(resolve=>{child.once('error',error=>resolve({code:null,error:error.message}));child.once('close',(code,signal)=>resolve({code,signal}));});
await fs.writeFile(root+'/process.json',JSON.stringify({status:'terminal',...result,elapsedMs:Date.now()-started})+'\n');
console.log(JSON.stringify({terminal:true,...result,root,elapsedMs:Date.now()-started}));if(result.code!==0)process.exitCode=1;
