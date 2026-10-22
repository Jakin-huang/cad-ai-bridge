// Same frozen developer inputs, a new independently auditable CAD representation.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {outsideProject} from '../src/local-paths.mjs';
import {hashFile} from '../src/drawings.mjs';
import {makeEngineeringDesign,engineeringDigest} from '../src/engineering-design.mjs';
import {auditEngineeringDesign} from '../src/engineering-verification.mjs';
const [target,previous]=process.argv.slice(2),root=outsideProject(path.resolve(target)),read=async f=>JSON.parse(await fs.readFile(f,'utf8')),prior=await read(path.join(previous,'native-report.json'));
assert.ok(prior.ok);const old=await read(prior.modelPath),sha=await hashFile(prior.modelPath);
const model=makeEngineeringDesign(old.input,{standardEvidence:old.standardEvidence,architecturalEvidence:old.architecturalEvidence,photometricEvidence:old.photometricEvidence,lightingStandardEvidence:old.lightingStandardEvidence}),audit=auditEngineeringDesign(model);
assert.ok(audit.ok,JSON.stringify(audit.checks.filter(c=>!c.ok)));
for(const key of ['input','devices','circuits','installation'])assert.deepEqual(model[key],old[key]);
assert.equal(await hashFile(prior.modelPath),sha);await fs.mkdir(root,{recursive:false});
const report={ok:true,newAiClient:false,professionalApproval:false,modelSHA256:engineeringDigest(model),priorModelSHA256:engineeringDigest(old),physicalDesignUnchanged:true,rooms:model.input.rooms.length,lights:model.devices.length,circuits:model.circuits.length,sheets:model.sheets.map(s=>({id:s.id,paper:s.paper})),automatedChecks:audit.checks.length,pending:audit.pending.length};
for(const [name,value]of Object.entries({'input.json':old.input,'model.json':model,'audit.json':audit,'preflight.json':report}))await fs.writeFile(path.join(root,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report));
