// Continue the actual AI-created design record through local native CAD. No AI
// service is invoked here and the reference is read only after model freeze.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execute} from '../bridge.mjs';
import {dataHome} from '../src/local-paths.mjs';
import {hashFile} from '../src/drawings.mjs';
import {engineeringDigest} from '../src/engineering-design.mjs';
import {auditEngineeringDesign,compareEngineeringReference} from '../src/engineering-verification.mjs';
const [clientFile,manifestFile]=process.argv.slice(2),read=async f=>JSON.parse(await fs.readFile(f,'utf8')),client=await read(clientFile),manifest=await read(manifestFile),folder=path.dirname(manifestFile);assert.ok(client.ok&&client.privateInputAuthorized);
for(const f of manifest.files)assert.equal(await hashFile(f.file),f.sha256);
const jobRoot=path.join(dataHome(),'runs',client.jobId),state=await read(path.join(jobRoot,'engineering.json')),model=await read(path.join(jobRoot,'model-'+state.revision+'.json'));assert.equal(engineeringDigest(model),state.modelSHA256);const audit=auditEngineeringDesign(model);assert.ok(audit.ok);
await fs.writeFile(path.join(folder,'ai-model-freeze.json'),JSON.stringify({modelSHA256:state.modelSHA256,inputSHA256:state.inputSHA256,clientTraceSHA256:client.rawTraceSHA256,frozenAt:new Date().toISOString()},null,2));
const comparison=compareEngineeringReference(model,await read(manifest.referenceFile));await fs.writeFile(path.join(folder,'ai-reference-comparison.json'),JSON.stringify(comparison,null,2));
const delivered=await execute('engineering',{action:'deliver',jobId:client.jobId,requestId:crypto.randomUUID(),expectedModelSHA256:state.modelSHA256});assert.ok(delivered.ok&&delivered.status==='delivered',JSON.stringify(delivered));assert.ok(delivered.delivery.verification.ok);for(const f of delivered.delivery.files)assert.equal(await hashFile(f.file),f.sha256);for(const f of manifest.files)assert.equal(await hashFile(f.file),f.sha256);
const checks=[...client.checks,'Actual AI-derived constraints continued unchanged into native CAD creation, save, readback and five-sheet PDF/PNG delivery','Reference evaluated after AI model freeze and original files retained'];
const report={ok:true,checkedAt:new Date().toISOString(),jobId:client.jobId,jobRoot,scope:model.input.scope,modelSHA256:state.modelSHA256,deliveredRevision:state.revision,clientTraceSHA256:client.rawTraceSHA256,checks,devices:model.devices.length,circuits:model.circuits.length,sheets:model.sheets.length,initialDelivery:delivered.delivery,automatedChecks:{passed:audit.checks.filter(c=>c.ok).length,failed:audit.checks.filter(c=>!c.ok).length,pending:audit.pending.length},comparison,referenceComparisonFile:path.join(folder,'ai-reference-comparison.json'),acceptance:{actualClientToNativeCad:true,historicalTestBriefOnly:true,originalCustomerBrief:false,independentProspectiveDesign:false,humanProfessionalReview:false,constructionApproval:false}};
await fs.writeFile(path.join(folder,'ai-engineering-delivery-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,jobId:client.jobId,checks:checks.length,files:delivered.delivery.files.length,automatedChecks:report.automatedChecks}));
