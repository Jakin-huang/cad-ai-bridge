// Read-only correction of the old oracle's ID-label comparison. Keep the
// original client report and all protocol/process failures; never edit inputs.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {outsideProject} from '../src/local-paths.mjs';import {hashFile} from '../src/drawings.mjs';
import {engineeringDigest} from '../src/engineering-design.mjs';import {auditEngineeringDesign} from '../src/engineering-verification.mjs';
import {sameSourceBoundValues,hasCurrentRequirementSource} from './helpers/document-source-oracle.mjs';
const root=outsideProject(path.resolve(process.argv[2])),read=async p=>JSON.parse(await fs.readFile(p,'utf8')),prior=await read(root+'/client-report.json'),experiment=await read(root+'/experiment.json'),oracle=await read(root+'/oracle.json');
assert.equal(await hashFile(root+'/oracle.json'),experiment.oracleSHA256);for(const f of experiment.protectedFiles)assert.equal(await hashFile(f.file),f.sha256);
const runs=root+'/data/runs',state=await read(path.join(runs,prior.childJobId,'engineering.json')),input=await read(path.join(runs,prior.childJobId,'input-'+state.revision+'.json')),original=await read(root+'/workspace/baseline.json'),freeze=await read(root+'/document-freeze.json'),set=freeze.reply.set,version=await read(path.join(runs,set.jobId,'version-'+set.revision+'.json'));
assert.equal(engineeringDigest(original),oracle.originalInputSHA256);assert.equal(engineeringDigest(input),prior.inputSHA256);assert.equal(state.modelSHA256,prior.modelSHA256);
const changes=[],checks=prior.checks.map(c=>({...c})),replace=(name,passed)=>{const c=checks.find(c=>c.name===name);assert.ok(c);changes.push({name,originalPassed:c.passed,passed});c.passed=passed;};
for(const key of ['architecture','electrical','luminaires'])replace('Preserved frozen '+key,sameSourceBoundValues(original[key],input[key],original.sources,input.sources));
for(const room of input.rooms)for(const rule of ['target_lux',...Object.keys(oracle.common)]){const rows=input.requirements.filter(r=>r.rule===rule&&r.roomIds.includes(room.id));replace(room.id+' '+rule+' keeps actual current document source',rows.length>0&&rows.every(r=>hasCurrentRequirementSource(r,input.sources,version.documents.filter(d=>['MAIN','COORD'].includes(d.id)).map(d=>d.textSHA256))));}
if(state.modelSHA256){const model=await read(path.join(runs,prior.childJobId,'model-'+state.revision+'.json'));assert.equal(engineeringDigest(model),state.modelSHA256);assert.ok(auditEngineeringDesign(model).ok);}
const report={...prior,checks,errors:checks.filter(c=>!c.passed).map(c=>c.name),originalReportSHA256:await hashFile(root+'/client-report.json'),oracleCorrections:changes,originalReportPreserved:true,controllerSemanticRepair:false};
report.ok=checks.every(c=>c.passed);report.wholeClientTrialPassed=report.ok;report.finalEngineeringStatePassed=checks.filter(c=>!['CLI finishes successfully','No protocol/Bridge/permission errors'].includes(c.name)).every(c=>c.passed);
await fs.writeFile(root+'/client-reaudit.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({ok:report.ok,finalEngineeringStatePassed:report.finalEngineeringStatePassed,errors:report.errors,corrections:changes.filter(c=>c.originalPassed!==c.passed).length}));
