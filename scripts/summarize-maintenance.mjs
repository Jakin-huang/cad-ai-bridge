import {projectPath,parseLocalJSON,resolveLocalPath} from '../src/local-paths.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {root} from './public-files.mjs';
const read=async file=>parseLocalJSON((await fs.readFile(projectPath(file),'utf8')).replace(/^\uFEFF/,''));
const before=await read('artifacts/maintenance-before.json'),efficiency=await read('artifacts/maintenance-efficiency-report.json'),protocol=await read('artifacts/maintenance-mcp-report.json'),faults=await read('artifacts/maintenance-host-faults-report.json'),workbuddy=await read('artifacts/workbuddy-client-report.json');
for(const r of [efficiency,protocol,faults,workbuddy])assert.equal(r.ok,true);
const build=await read('plugin/bin/build.json'),generic=await read('artifacts/integration-report.json'),tangent=await read('artifacts/tangent-integration-report.json'),scene=await read('artifacts/school-mcp-report.json'),pages=await read('artifacts/mcp-results-report.json'),deliveryFaults=await read('artifacts/school-delivery-report.json');
const folder=resolveLocalPath((await fs.readFile(projectPath('artifacts/school-project-current.txt'),'utf8')).trim()),school=parseLocalJSON(await fs.readFile(path.join(folder,'delivery.json'),'utf8'));
const projectFolder=resolveLocalPath((await fs.readFile(projectPath('artifacts/real-project-current.txt'),'utf8')).trim()),project=parseLocalJSON(await fs.readFile(path.join(projectFolder,'project-validation.json'),'utf8'));
for(const r of [generic,tangent,scene,pages,deliveryFaults,school,project])assert.equal(r.ok,true);
const inspectorResults=[];for(const name of ['doctor','create','takeoff']){const wrapper=await read('artifacts/inspector-'+name+'.json'),r=parseLocalJSON(wrapper.result.content[0].text);assert.equal(r.ok,true);inspectorResults.push(name);}
const summary={checkedAt:new Date().toISOString(),version:'0.2.0',pluginSHA256:build.sha256,implementation:['A1','A2','B1','B2','C1','C2'],environment:'Windows x64 / Node 22.20.0 / AutoCAD 2022 zh-CN / Tangent Electrical V8.0',protocolChecks:protocol.checks.length,realFaultChecks:faults.checks.length,existingRegression:{generic:generic.checks.length,tangent:tangent.checks.length,engineering:project.checks.length,comparedRecords:project.preservation.compared,mcpResults:pages.checks.length,scene:scene.checks.length,schoolDesign:school.designChecks,schoolCad:school.cadChecks,schoolDeliveryFaults:deliveryFaults.checks.length,schoolSheets:school.sheetCount},clients:[{name:workbuddy.client,scope:workbuddy.scope,checks:workbuddy.checks},{name:'MCP Inspector CLI 2.11.0',scope:'Independent CLI; no desktop UI assertion',checks:inspectorResults}],measurements:{before:{configurationMs:before.configMs,mcpStartupMs:before.mcpStartupMs},after:{configurationMs:efficiency.configMs,mcpStartupMs:efficiency.mcpStartupMs},sameTaskComparison:{batchMs:efficiency.batchMs,separateMs:efficiency.separateMs,hostLaunches:efficiency.launchCount,checks:efficiency.checks},limitation:'Single-machine samples; batching compares invocation strategies, not old/new geometry performance.'},pending:['Clean Windows runtime bootstrap and installer/download failures','WorkBuddy desktop UI and Skill installation flow','Additional CAD versions and live user sessions remain outside this release scope']};
const optional=async file=>{try{return await read(file);}catch(error){if(error.code==='ENOENT')return;throw error;}};
const installed=await optional('artifacts/workbuddy-installed-report.json'),skill=await optional('artifacts/workbuddy-skill-report.json');
if(installed&&skill){
 assert.equal(installed.ok,true);assert.equal(skill.ok,true);
 summary.workbuddyFollowup={installedConfiguration:{scope:installed.scope,checks:installed.checks},skill:{scope:skill.scope,checks:skill.checks},desktop:{status:'incomplete',observedVersion:'5.3.8',blockers:['Screenshot capture timeout and unavailable input geometry','After controller update: minimized window and detected user input'],pending:['Custom connector enablement','Global Skill discovery','Desktop conversation and file presentation']}};
 summary.pending=summary.pending.map(item=>item==='WorkBuddy desktop UI and Skill installation flow'?'WorkBuddy desktop connector enablement, global Skill discovery, conversation and file presentation':item);
 const desktop=await optional('artifacts/workbuddy-desktop-status.json');
 if(desktop?.globalSkillDiscovered===true){
  summary.workbuddyFollowup.desktop.globalSkillDiscovered=true;
  summary.workbuddyFollowup.desktop.checks=['Installed global cadbridge-electrical Skill and full instructions visible in desktop detail page'];
  summary.workbuddyFollowup.desktop.pending=summary.workbuddyFollowup.desktop.pending.filter(item=>item!=='Global Skill discovery');
  summary.pending=summary.pending.map(item=>item.replace('connector enablement, global Skill discovery, conversation','connector enablement, conversation'));
  if(desktop.connector){
   summary.workbuddyFollowup.desktop.connector={configurationReadByDesktop:desktop.connector.configurationReadByDesktop,enabled:desktop.connector.enabled,userConfirmedEnabled:desktop.connector.userConfirmedEnabled===true,reason:desktop.connector.reason};
   if(desktop.connector.userConfirmedEnabled===true){
    summary.workbuddyFollowup.desktop.pending=summary.workbuddyFollowup.desktop.pending.map(item=>item==='Custom connector enablement'?'Desktop connector runtime verification':item);
    summary.pending=summary.pending.map(item=>item.replace('desktop connector enablement,','desktop connector runtime verification,'));
   }
  }
 }
 const desktopTask=await optional('artifacts/workbuddy-desktop-task-report.json');
 if(desktop?.desktopUICompleted===true&&desktopTask?.acceptanceComplete===true){
  assert.equal(desktopTask.ok,true);assert.equal(desktopTask.drawingSha256,desktop.drawingSha256);
  summary.workbuddyFollowup.desktop={status:'complete-user-assisted',observedVersion:desktop.desktopVersion,globalSkillDiscovered:true,connector:summary.workbuddyFollowup.desktop.connector,checks:desktopTask.checks,manualChecks:desktopTask.manualChecks,statistics:desktopTask.statistics,presentation:{fileCardsVisible:true,manualDwgOpen:true,embeddedCadPreviewVerified:false,cardDirectOpenVerified:null},limitations:['Desktop clicks and task entry assisted by user because computer-use capture/input was unreliable','No embedded CAD preview or direct card-to-CAD opening assertion'],pending:[]};
  summary.clients.push({name:'WorkBuddy desktop '+desktop.desktopVersion,scope:desktopTask.scope,checks:desktopTask.checks,manualChecks:desktopTask.manualChecks});
  summary.pending=summary.pending.filter(item=>!item.startsWith('WorkBuddy desktop'));
 }
}
const windowsUser=await optional('docs/windows-user-validation.json');
if(windowsUser?.status==='user-preview-validated-on-existing-windows'){
 summary.windowsUserRelease=windowsUser;
 summary.pending=summary.pending.filter(item=>!item.startsWith('Clean Windows runtime bootstrap'));
 summary.pending.push(...(windowsUser.cleanWindowsVerified&&windowsUser.separateStandardAccountVerified?windowsUser.pending:['Fresh Windows and independent standard-account acceptance remain pending; local VM acceptance is deferred by user']));
}
await fs.writeFile(projectPath('docs/maintenance-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({ok:true,protocolChecks:summary.protocolChecks,realFaultChecks:summary.realFaultChecks,clients:summary.clients.map(c=>c.name)}));
