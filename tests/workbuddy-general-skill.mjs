// Explicit current-client acceptance, using its existing login and an isolated local project.
// Does not assert desktop rendering, global Skill discovery or external-user acceptance.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {projectPath,localPath} from '../src/local-paths.mjs';
import {hashFile} from '../src/drawings.mjs';
import {workbuddyLocations} from '../src/client-install.mjs';

const [cli,home]=process.argv.slice(2);if(!cli||!home)throw Error('Supply the installed WorkBuddy CLI and client home');
const replay=cli==='--replay',folder=replay?path.resolve(home):await fs.mkdtemp(localPath('artifacts','workbuddy-general-skill-'));
if(!replay){
 const skill=path.join(folder,'.codebuddy/skills/cadbridge-electrical');await fs.mkdir(path.dirname(skill),{recursive:true});await fs.cp(projectPath('skills/cadbridge-electrical'),skill,{recursive:true});
 const names=['cad_capabilities','cad_doctor','cad_create_drawing','cad_query_entities','cad_workflow','cad_get_job','cad_read_result','cad_export'];
 const settings=path.join(folder,'settings.json');await fs.writeFile(settings,JSON.stringify({permissions:{allow:['Skill','Read','ToolSearch','DeferExecuteTool',...names.map(name=>'mcp__cad-ai-bridge__'+name)]}}));
 const prompt='使用 CAD AI Bridge 检查连接，在毫米制新图中画两条长3000毫米、间隔1000毫米的水平线，并写“测试”。用通用工作流把文字替换为“CAD AI Bridge”，保存后重开核对，生成按对象类型和图层分组的CSV及PNG预览，返回实际DWG和交付文件链接。请使用可用的CAD技能和工具，不运行命令行、不安装软件、不修改设置。';
 const args=[cli,'-p','--settings',settings,'--mcp-config',workbuddyLocations(home).config,'--strict-mcp-config','--no-session-persistence','--max-turns','24','--output-format','json','--',prompt];
 const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:folder,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);child.once('error',reject);const timer=setTimeout(()=>{child.kill();reject(Error('Client QA exceeded 300 seconds; inspect retained jobs before retrying writes'));},300000);child.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});});
 await fs.writeFile(path.join(folder,'events.json'),result.stdout);await fs.writeFile(path.join(folder,'stderr.txt'),result.stderr);assert.equal(result.code,0,'Inspect the retained isolated client stderr: '+folder);
}
const events=JSON.parse(await fs.readFile(path.join(folder,'events.json'),'utf8')),calls=events.filter(event=>event.type==='function_call');
const candidateSkill=path.resolve(folder,'.codebuddy/skills/cadbridge-electrical/SKILL.md').toLowerCase();
assert.ok(calls.some(call=>call.name==='Skill'&&call.arguments.includes('cadbridge-electrical')||call.name==='Read'&&path.resolve(JSON.parse(call.arguments).file_path).toLowerCase()===candidateSkill),'General task must load the exact candidate Skill');
const executions=[],recoveredValidationErrors=[];
for(const call of calls.filter(call=>call.name==='DeferExecuteTool')){
 const args=JSON.parse(call.arguments),reply=events.find(event=>event.type==='function_call_result'&&event.callId===call.callId);assert.ok(reply);assert.notEqual(reply.status,'failed');
 if(reply.output.text.startsWith('Input validation error:')){recoveredValidationErrors.push({tool:args.toolName,message:reply.output.text});continue;}
 let result=JSON.parse(reply.output.text);if(Array.isArray(result))result=JSON.parse(result.find(block=>block.type==='text').text);assert.equal(result.ok,true,JSON.stringify(result.error));executions.push({tool:args.toolName,result});
}
const workflows=executions.filter(item=>item.tool.endsWith('__cad_workflow')).map(item=>item.result),replace=workflows.find(result=>result.workflow==='replace_text'),takeoff=workflows.find(result=>result.workflow==='takeoff');
assert.ok(replace&&takeoff,'Client must use actual generic replacement and takeoff');assert.equal(replace.summary.changed,1);assert.equal(await hashFile(replace.drawing),replace.drawingSha256);assert.ok(replace.query.entities.some(entity=>entity.text==='CAD AI Bridge'));assert.equal(takeoff.statistics.entityCount,3);assert.equal(takeoff.inputSha256,replace.drawingSha256,'CSV must describe the delivered edited drawing');
const lines=takeoff.query.entities.filter(entity=>['LINE','LWPOLYLINE'].includes(entity.type)).sort((a,b)=>a.bounds.min[1]-b.bounds.min[1]);assert.equal(lines.length,2);for(const line of lines){assert.ok(Math.abs(line.bounds.max[0]-line.bounds.min[0]-3000)<1e-5);assert.ok(Math.abs(line.bounds.max[1]-line.bounds.min[1])<1e-5);}assert.ok(Math.abs(lines[1].bounds.min[1]-lines[0].bounds.min[1]-1000)<1e-5);
const files=[...workflows.flatMap(result=>result.files||[]),...executions.filter(item=>item.result.exported).map(item=>({kind:path.extname(item.result.exported.file).slice(1).toLowerCase(),file:item.result.exported.file}))];
for(const file of files){await fs.access(file.file);if(file.sha256)assert.equal(await hashFile(file.file),file.sha256);}
assert.ok(files.some(file=>file.kind==='summary-csv'));assert.ok(files.some(file=>file.kind==='png'||file.kind==='after-png'));
const final=events.findLast(event=>event.type==='result');assert.equal(final.subtype,'success');
const seed=executions.find(item=>item.tool.endsWith('__cad_create_drawing'))?.result;assert.ok(seed);assert.equal(await hashFile(seed.drawing),seed.drawingSha256);
const report={ok:true,checkedAt:new Date().toISOString(),scope:'Installed WorkBuddy bundled CLI and existing login; exact candidate Skill copied into isolated documented project scope. No desktop, global discovery or external-user assertion.',pluginSHA256:JSON.parse((await fs.readFile(projectPath('plugin/bin/build.json'),'utf8')).replace(/^\uFEFF/,'')).sha256,skillSHA256:await hashFile(projectPath('skills/cadbridge-electrical/SKILL.md')),checks:['Candidate Skill loaded for a Chinese general-CAD request','Actual scene creation, generic replacement and takeoff completed','Saved text, two 3000 mm horizontal lines, 1000 mm spacing and three-entity CSV counts verified','Actual PNG and CSV files retained with verified hashes','Original synthetic DWG remains unchanged','Client returned a successful natural-language result'],recoveredValidationErrors,folder,executions,drawing:replace.drawing,files,final};
await fs.writeFile(localPath('artifacts','workbuddy-general-skill-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,checks:report.checks.length,folder}));
