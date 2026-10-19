import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {localPath,projectPath} from '../src/local-paths.mjs';

const read=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
const run=await read(localPath('artifacts','practical-latest.json')),build=await read(projectPath('plugin/bin/build.json')),release=await read(projectPath('release.json'));
assert.equal(run.status,'passed');
const evidence=[];
for(const file of ['workflows-report.json','session-report.json','query-scope-report.json','integration-report.json','editing-report.json','tangent-integration-report.json','editing-tangent-report.json','native-tangent-report.json','mcp-results-report.json','school-mcp-report.json','maintenance-mcp-report.json','workbuddy-installed-report.json','editing-legacy-upgrade-report.json','preview4-editing-upgrade-report.json']){
 const report=await read(localPath('artifacts',file));assert.equal(report.ok,true,file);
 if(report.pluginSHA256)assert.equal(report.pluginSHA256.toLowerCase(),build.sha256.toLowerCase(),file);
 evidence.push({report:file,checkedAt:report.checkedAt,checks:report.checks?.length||0,scope:report.scope||'Current-machine regression',passed:true});
}
const unit=run.steps.findLast(item=>item.name==='unit'&&item.status==='passed'),tap=await fs.readFile(unit.log,'utf8'),session=await read(localPath('artifacts','session-report.json'));
let client;try{const report=await read(localPath('artifacts','workbuddy-general-skill-report.json'));assert.equal(report.ok,true);assert.equal(report.pluginSHA256.toLowerCase(),build.sha256.toLowerCase());client={checkedAt:report.checkedAt,scope:report.scope,checks:report.checks,elapsedMs:report.final.duration_ms,recoveredInputValidationErrors:report.recoveredValidationErrors.length,performanceScope:'One synthetic first-task client trace; no manual baseline or user productivity claim.'};}catch(error){if(error.code!=='ENOENT')throw error;}
const summary={release:release.version,status:'four-stage-development-validated-on-existing-machine',checkedAt:new Date().toISOString(),pluginSHA256:build.sha256,
 environment:{os:'Windows 10 x64',cad:'AutoCAD 2022 zh-CN',optionalExtension:'Tangent Electrical V8',client:'WorkBuddy 5.3.8 configuration via official MCP SDK'},
 stages:[{stage:1,status:'local-development-complete',delivered:['Capabilities without CAD','Existing offline setup, diagnostics and restoration retained','21 MCP tools and general-purpose Skill']},{stage:2,status:'local-development-complete',delivered:['Five generic workflows','Frozen input and output hashes','Actual CSV, PDF, PNG, persisted readback and replay']},{stage:3,status:'experimental-local-acceptance-passed',delivered:['Live document/view/selection','Memory revision conflicts and document switch protection','Transactions, undo, independent copies, recovery and cancellation','30 mixed requests with client reconnect']},{stage:4,status:'bounded-extension-complete',delivered:['Local nested read-only queries and distinct instance paths','WCS point/bounds transforms and definition scalar labels','Layout reads, xref identification, real units and explicit truncation']}],
 unitTests:{passed:Number(tap.match(/^# pass (\d+)/m)?.[1]),failed:Number(tap.match(/^# fail (\d+)/m)?.[1]),skipped:Number(tap.match(/^# skipped (\d+)/m)?.[1])},
 sessionSequence:{requests:session.results.sequence.length,passed:session.results.sequence.every(item=>item.ok),handlesBefore:session.results.resources.before.handleCount,handlesAfter:session.results.resources.after.handleCount},
 evidence,
 clientNaturalLanguage:client,
 pending:['Fresh Windows installation','Independent standard account','Browser download and trust prompts','External user trials and time-saved measurements','New-feature desktop natural-language acceptance','Long-term production reliability and additional CAD versions'],
 limitations:['Session editing is experimental and targets one COM-visible AutoCAD 2022 instance with PID checks','Nested, paper-space, xref, dynamic block and non-millimeter writes are unsupported','Traversal limits and definition-space scalar quantities must not be treated as complete procurement quantities','Historical desktop evidence does not establish acceptance of new tools'],
 dataPolicy:'No drawings, private paths, tokens or detailed job outputs are included in this public summary.'};
assert.ok(summary.unitTests.passed>0);assert.equal(summary.unitTests.failed,0);assert.equal(summary.sessionSequence.requests,30);
await fs.writeFile(projectPath('docs/practical-validation.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({ok:true,reports:evidence.length,unitTests:summary.unitTests}));
