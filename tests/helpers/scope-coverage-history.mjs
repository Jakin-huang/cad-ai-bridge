import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {hashFile} from '../../src/drawings.mjs';

// engineering-projects.save updates this exact task-root summary on every state
// transition. Native operation receipts named result.json remain immutable.
export async function verifyScopeHistory(experiment, child) {
 const latest=path.resolve(child,'result.json'),changes=[];let immutableFiles=0;
 for(const f of experiment.oldFiles){
  const actual=await hashFile(f.file);
  if(path.resolve(f.file)!==latest){assert.equal(actual,f.sha256,f.file);immutableFiles++;continue;}
  const result=JSON.parse(await fs.readFile(latest,'utf8'));
  const state=JSON.parse(await fs.readFile(path.join(child,'engineering.json'),'utf8'));
  assert.equal(result.jobId,experiment.context.designJobId);
  for(const key of ['revision','status','inputSHA256','modelSHA256'])assert.equal(result[key],state[key],key);
  changes.push({file:f.file,beforeSHA256:f.sha256,currentSHA256:actual,changed:actual!==f.sha256,classification:'mutable current task summary',source:'src/engineering-projects.mjs:save'});
 }
 return {immutableFiles,mutableSummaries:changes};
}
