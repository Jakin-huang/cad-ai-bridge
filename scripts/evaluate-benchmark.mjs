import fs from 'node:fs/promises';
import path from 'node:path';
import {evaluateBenchmark} from '../src/benchmarks.mjs';
import {hashFile,isWithin} from '../src/drawings.mjs';
import {atomicJson} from '../src/files.mjs';
const [suiteFile,attemptsFile,output]=process.argv.slice(2);if(!suiteFile||!attemptsFile||!output)throw Error('Usage: node scripts/evaluate-benchmark.mjs SUITE.json ATTEMPTS.json REPORT.json');
const read=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,'')),suite=await read(suiteFile),attempts=await read(attemptsFile),root=await fs.realpath(path.dirname(attemptsFile));
for(const attempt of attempts)for(const artifact of attempt.artifacts??[]){const file=await fs.realpath(path.resolve(root,artifact.file));if(!isWithin(root,file))throw Error('BENCHMARK_ARTIFACT_OUTSIDE_EVIDENCE_ROOT');if(await hashFile(file)!==artifact.sha256.toLowerCase())throw Error('BENCHMARK_ARTIFACT_CHANGED');}
const report={...evaluateBenchmark(suite,attempts),artifactsVerified:true,suiteSha256:await hashFile(suiteFile),attemptsSha256:await hashFile(attemptsFile),evaluatedAt:new Date().toISOString()};await atomicJson(path.resolve(output),report);console.log(JSON.stringify({ok:true,comparable:report.comparable,competitiveSuperiority:report.competitiveSuperiority,output:path.resolve(output)}));
