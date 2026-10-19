// Explicit AI-client acceptance. Uses a temporary project and session-only tool permissions.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {hashFile} from '../src/drawings.mjs';
import {projectRoot as root} from '../src/config.mjs';
import {workbuddyLocations} from '../src/client-install.mjs';
const [cli,home]=process.argv.slice(2);if(!cli||!home)throw Error('Supply the WorkBuddy bundled CLI path and installed client home');
const replay=cli==='--replay';
const folder=replay?path.resolve(home):await fs.mkdtemp(path.join(root,'artifacts/workbuddy-skill-'));
if(!replay){
const locations=workbuddyLocations(home);
const skill=path.join(folder,'.codebuddy/skills/cadbridge-electrical');await fs.mkdir(path.dirname(skill),{recursive:true});await fs.cp(locations.skill,skill,{recursive:true});
const names=['cad_doctor','cad_create_test_drawing','electrical_apply','electrical_takeoff','electrical_validate'];
const settings=path.join(folder,'test-settings.json');await fs.writeFile(settings,JSON.stringify({permissions:{allow:['Skill','Read','ToolSearch','DeferExecuteTool',...names.map(n=>'mcp__cad-ai-bridge__'+n)]}}));
const prompt='帮我用已连接的 CAD 工具做一次小型电气绘图测试：新建天正适配的合成测试图，在(0,0)和(3000,0)各放一盏灯，沿这两个点连接 WL1，编号 L-001、L-002。保存后重新统计数量和3000毫米路线，并校验连接。只访问本测试需要的文件和工具；不要修改设置或安装软件。最后用中文给出实际保存的DWG和核验结果。';
const args=[cli,'-p','--settings',settings,'--mcp-config',locations.config,'--strict-mcp-config','--no-session-persistence','--max-turns','14','--output-format','json','--',prompt];
const result=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,args,{cwd:folder,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('error',reject);const timer=setTimeout(()=>{p.kill();reject(Error('WorkBuddy skill acceptance exceeded 240 seconds; inspect retained CAD jobs before retrying writes'));},240000);p.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});});
await fs.writeFile(path.join(folder,'events.json'),result.stdout);await fs.writeFile(path.join(folder,'stderr.txt'),result.stderr);
assert.equal(result.code,0,result.stderr);
}
const events=JSON.parse(await fs.readFile(path.join(folder,'events.json'),'utf8')),calls=events.filter(e=>e.type==='function_call');
const skillCalls=calls.filter(e=>e.name==='Skill');assert.ok(skillCalls.some(e=>e.arguments.includes('cadbridge-electrical')),'Client must discover and invoke Skill from project configuration');
const executions=calls.filter(e=>e.name==='DeferExecuteTool').map(e=>JSON.parse(e.arguments));
for(const name of ['cad_create_test_drawing','electrical_apply','electrical_takeoff','electrical_validate'])assert.ok(JSON.stringify(executions).includes(name),'Missing actual call: '+name);
const failures=events.filter(e=>e.type==='function_call_result'&&e.status==='failed');assert.equal(failures.length,0);
const results={};
for(const call of calls.filter(e=>e.name==='DeferExecuteTool')){
 const name=JSON.parse(call.arguments).toolName;
 const reply=events.find(e=>e.type==='function_call_result'&&e.callId===call.callId);assert.ok(reply,'Missing tool result');
 const result=JSON.parse(reply.output.text);assert.equal(result.ok,true,JSON.stringify(result.error));results[name.split('__').at(-1)]=result;
}
const applied=results.electrical_apply,fixture=results.cad_create_test_drawing;
assert.equal(applied.drawingSaved,true);assert.equal(await hashFile(applied.drawing),applied.drawingSha256);assert.equal(await hashFile(fixture.drawing),fixture.drawingSha256);
assert.equal(calls.filter(e=>e.name==='DeferExecuteTool'&&JSON.parse(e.arguments).toolName.endsWith('__electrical_apply')).length,1);
for(const name of ['electrical_apply','electrical_takeoff','electrical_validate']){
 const snapshot=results[name].snapshot;assert.equal(snapshot.devices.length,2);assert.equal(snapshot.routes.length,1);assert.equal(snapshot.routeLengthMm,3000);
 assert.deepEqual(snapshot.devices.map(d=>d.attributes.DEVICE_ID).sort(),['L-001','L-002']);assert.deepEqual(snapshot.issues,[]);
}
const final=events.findLast(e=>e.type==='result');assert.equal(final.subtype,'success');
const report={ok:true,checkedAt:new Date().toISOString(),scope:'WorkBuddy bundled CLI: identical installed Skill discovered in documented .codebuddy project scope; not desktop global Skill discovery',checks:['Installed Skill copied without modification into isolated project scope','Skill selected automatically from Chinese task','Create, atomic edit, saved takeoff and validation called','No tool call reported failure','Two lights, 3000 mm route, numbering and zero issues verified in persisted tool results','Saved DWG and unchanged source match returned digests; one atomic edit'],folder,calls:calls.map(e=>({name:e.name,arguments:e.arguments})),drawing:applied.drawing,drawingSha256:applied.drawingSha256,final};
await fs.writeFile(path.join(root,'artifacts/workbuddy-skill-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,checks:report.checks,folder}));
