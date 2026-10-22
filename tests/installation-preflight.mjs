// Explicit developer continuation of the existing nine-space study. This is
// neither an AI-authored brief nor a newly discovered customer requirement.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {outsideProject} from '../src/local-paths.mjs';
import {hashFile} from '../src/drawings.mjs';
import {makeEngineeringDesign,engineeringDigest} from '../src/engineering-design.mjs';
import {engineeringInputSchema} from '../src/engineering-contracts.mjs';
import {auditEngineeringDesign} from '../src/engineering-verification.mjs';
const [output,previous]=process.argv.slice(2),root=outsideProject(path.resolve(output)),priorRoot=outsideProject(path.resolve(previous)),read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
await fs.mkdir(root,{recursive:false});
const prior=await read(path.join(priorRoot,'native-report.json'));assert.ok(prior.ok);const old=await read(prior.modelPath),input=structuredClone(old.input),oldSHA=await hashFile(prior.modelPath);
const sourceId='INSTALLATION_DEV',basis={sourceIds:[sourceId],status:'assumed',description:'Explicit developer single-pole mounting and terminal topology assumptions; no site or product approval.'};
const conditions={topology:'ceiling_junction_single_pole',routingHeightM:3.2,panelHeightM:1.5,...basis,rooms:input.rooms.map(r=>({roomId:r.id,switchPosition:old.controls.find(c=>c.roomId===r.id).position,switchHeightM:1.3,switchRatingA:10,switchRatedVoltage:250,...basis}))};
const source={classification:'developer_assumptions',scope:'Add declared junction routing plane, switch mounting and ratings to the known office study. Preserve original lighting values, products, routing regions and max_drop=0.2%. Each circuit gets one independent manual pole at the declared room box. Original generated control anchor is a proposed location, not observed installation. All installation authority remains assumed. ARCHIVE and SUPPORT remain excluded by the existing brief; hospital assets are not used.',conditions};
const sourceFile=path.join(root,'installation-conditions.json');await fs.writeFile(sourceFile,JSON.stringify(source,null,2)+'\n',{flag:'wx'});
input.sources.push({id:sourceId,role:'review_instruction',sha256:await hashFile(sourceFile),location:sourceFile,description:source.scope,derivedFromFinalDrawing:false});input.installation=conditions;
input.title='普通照明接线深化-九空间开发验证';
const parsed=engineeringInputSchema.parse(input);await fs.writeFile(path.join(root,'input.json'),JSON.stringify(parsed,null,2)+'\n',{flag:'wx'});
const model=makeEngineeringDesign(parsed,{standardEvidence:old.standardEvidence,architecturalEvidence:old.architecturalEvidence,photometricEvidence:old.photometricEvidence,lightingStandardEvidence:old.lightingStandardEvidence}),audit=auditEngineeringDesign(model);
await fs.writeFile(path.join(root,'model.json'),JSON.stringify(model,null,2)+'\n',{flag:'wx'});await fs.writeFile(path.join(root,'audit.json'),JSON.stringify(audit,null,2)+'\n',{flag:'wx'});
assert.ok(model.ok);assert.ok(audit.ok,JSON.stringify(audit.checks.filter(c=>!c.ok)));
for(const key of ['requirements','rooms','luminaires','electrical','routingConditions','spaceProgram'])assert.deepEqual(parsed[key],old.input[key]);
assert.deepEqual(model.devices.map(({circuitId,controlId,...d})=>d),old.devices.map(({circuitId,controlId,...d})=>d));assert.equal(await hashFile(prior.modelPath),oldSHA);
const report={ok:true,newAiClient:false,professionalApproval:false,source:sourceFile,sourceSHA256:await hashFile(sourceFile),modelSHA256:engineeringDigest(model),priorModelSHA256:engineeringDigest(old),priorModelFileSHA256:oldSHA,oldLightsAndConditionsPreserved:true,rooms:parsed.rooms.length,lights:model.devices.length,oldCircuits:old.circuits.length,circuits:model.circuits.length,installationMaximumDropPercent:Math.max(...model.installation.circuits.map(c=>c.maximumDropPercent)),maximumAllowedDropPercent:.2,installationRuns:model.installation.circuits.reduce((n,c)=>n+c.runs.length,0),conductorLengthsM:model.installation.conductorLengthsM,sheets:model.sheets.map(s=>({id:s.id,paper:s.paper})),expectedPdfOutputs:model.sheets.length*2,automatedChecks:audit.checks.length,pending:audit.pending.length,scope:source.scope};
await fs.writeFile(path.join(root,'preflight.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
