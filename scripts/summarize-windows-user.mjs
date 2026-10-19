import {projectPath,parseLocalJSON,resolveLocalPath} from '../src/local-paths.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {projectRoot as root} from '../src/config.mjs';
import {readDxf,tag,curveLength,xdata,field} from '../src/dxf-audit.mjs';
const read=async file=>parseLocalJSON((await fs.readFile(projectPath(file),'utf8')).replace(/^\uFEFF/,''));
const [pkg,dependencies,runtime,readonly,environment]=await Promise.all(['windows-user-package-report','windows-dependency-repair-report','runtime-bootstrap-report','windows-readonly-report','windows-user-environment'].map(name=>read('artifacts/'+name+'.json')));
const release=await read('release.json');
for(const report of [pkg,dependencies,runtime,readonly])assert.equal(report.ok,true);
assert.equal(pkg.packageSha256,dependencies.packageSha256);assert.equal(environment.elevated,false);
const unitText=await fs.readFile(projectPath('artifacts/windows-user-unit.txt'),'utf8');assert.match(unitText,/# fail 0\b/);const unitChecks=Number(unitText.match(/# pass (\d+)/)[1]);
const snapshot=pkg.results.upgraded.takeoff.snapshot;assert.equal(snapshot.routeLengthMm,3000);assert.deepEqual(snapshot.devices.map(device=>device.attributes.DEVICE_ID).sort(),['L-001','L-002']);
const dxf=await readDxf(pkg.results.upgraded.applied.dxf),devices=dxf.roots.filter(entity=>entity.type==='INSERT'&&tag(entity,2)==='EA_LIGHT');
assert.equal(devices.length,2);assert.deepEqual(devices.map(device=>dxf.attributes.get(device.handle).DEVICE_ID).sort(),['L-001','L-002']);
assert.deepEqual(devices.map(device=>[Number(tag(device,10)),Number(tag(device,20))]).sort((a,b)=>a[0]-b[0]),[[0,0],[3000,0]]);
const routes=dxf.roots.filter(entity=>entity.type==='LWPOLYLINE'&&field(xdata(entity),'linenum')==='WL1');assert.equal(routes.length,1);assert.ok(Math.abs(curveLength(routes[0])-3000)<1e-6);
const summary={status:'user-preview-validated-on-existing-windows',checkedAt:new Date().toISOString(),version:'0.2.0',distribution:'Windows user preview',environment:'Windows 10 x64; non-elevated process; isolated client, minimal PATH and offline bootstrap',unitChecks,checks:{package:pkg.checks,dependencyRepair:dependencies.checks,runtimeFaults:runtime.checks,readOnlyDirectory:readonly.checks},runtimeVersions:{node:'22.23.3',powershell:'7.4.20'},cleanWindowsVerified:false,separateStandardAccountVerified:false,cleanWindowsHarnessPrepared:true,limitations:['Non-elevated process belongs to the existing Windows account; it is not a separate standard-account acceptance','Local VM acceptance is deferred by user; no fresh Windows bridge test completed','Fresh-system harness has not been executed; no fresh-system compatibility claim','Existing user-assisted WorkBuddy desktop acceptance remains separate from this package/SDK test'],pending:['Fresh Windows evidence from an independent physical or external test environment','Independent standard Windows account evidence']};
summary.releaseVersion=release.version;summary.compatibilityVersion=release.compatibilityVersion;
summary.unitScope={suite:'Source test suite',node:process.version,packageRuntime:'Bundled Node/PowerShell verified separately by extracted-package SDK and real CAD tasks'};
for(const [key,file]of [['userOnboarding','practical-user-onboarding-report.json'],['publisherCache','launcher-cache-report.json']])try{const evidence=await read('artifacts/'+file);assert.equal(evidence.ok,true);summary.checks[key]=evidence.checks;}catch(error){if(error.code!=='ENOENT')throw error;}
summary.checks.savedOutput=['Independent DXF and saved snapshot agree on two light positions, L-001/L-002 and 3000 mm WL1 route'];
let clean;
try{clean=await read('artifacts/windows-clean-report.json');}catch(error){if(error.code!=='ENOENT')throw error;}
if(clean){
 assert.equal(clean.ok,true);assert.equal(clean.cleanWindowsVerified,true);assert.equal(clean.separateStandardAccountVerified,true);
 summary.cleanWindowsVerified=true;summary.separateStandardAccountVerified=true;
 summary.cleanWindows={scope:clean.scope,os:clean.os,isoSHA256:clean.isoSHA256,packageSHA256:clean.packageSHA256,guestChecks:clean.guestChecks,evidenceChecks:clean.evidenceChecks,cadInGuestVerified:false,workbuddyDesktopInGuestVerified:false};
 summary.limitations=clean.limitations;
 summary.pending=['Licensed CAD and signed-in WorkBuddy desktop under the independent guest account remain outside the fresh-bootstrap acceptance','Browser download / Mark-of-the-Web flow remains unverified'];
}
await fs.writeFile(projectPath('docs/windows-user-validation.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({ok:true,unitChecks,checks:Object.values(summary.checks).reduce((sum,checks)=>sum+checks.length,0),pending:summary.pending}));
