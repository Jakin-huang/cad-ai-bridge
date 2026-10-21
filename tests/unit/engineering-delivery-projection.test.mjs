import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {initialFixture,controllerAssessment} from '../helpers/lighting-solver-fixture.mjs';
import {solveInitialLighting} from '../../src/lighting-optimizer.mjs';
import {engineeringDigest} from '../../src/engineering-design.mjs';
import {buildEngineeringDeliveryProjection} from '../../src/engineering-delivery-projection.mjs';

// Controller-only values test result provenance and drawing annotations, not physics.
async function fixture(){const f=await initialFixture(),folder=path.join(f.root,'projection-study'),study=await solveInitialLighting(f.context,{folder,maxCandidates:1,assess:controllerAssessment()}),selected=study.records.find(r=>r.planId===study.selectedPlanId),model=JSON.parse(await fs.readFile(path.join(folder,selected.modelFile),'utf8')),bytes=await fs.readFile(path.join(folder,selected.qualityFile));return {model,options:{modelSHA256:engineeringDigest(model),qualityReportBytes:bytes,qualityReportSHA256:crypto.createHash('sha256').update(bytes).digest('hex')}};}
function altered(options,change){const q=JSON.parse(options.qualityReportBytes);change(q);const bytes=Buffer.from(JSON.stringify(q));return {...options,qualityReportBytes:bytes,qualityReportSHA256:crypto.createHash('sha256').update(bytes).digest('hex')};}
test('audited drawing presents recomputed total illuminance and binds both immutable records without changing design geometry',async()=>{
 const {model,options}=await fixture(),before=JSON.stringify(model),r=buildEngineeringDeliveryProjection(model,altered(options,q=>q.rooms[0].summary={averageLux:999999,uniformity:1}));
 assert.equal(JSON.stringify(model),before);assert.equal(r.manifest.sourceModelSHA256,engineeringDigest(model));assert.equal(r.manifest.sceneSHA256,engineeringDigest(r.scene));assert.equal(r.manifest.rows[0].averageLux,380);assert.equal(r.manifest.rows[0].uniformity,1);assert.equal(r.manifest.rows[0].referenceUgr,undefined);
 assert.deepEqual(r.scene.entities.filter(e=>e.kind!=='text'),model.scene.entities.filter(e=>e.kind!=='text'));
 assert.deepEqual(r.scene.symbols,model.scene.symbols);assert.deepEqual(r.scene.views,model.scene.views);
 const texts=r.scene.entities.filter(e=>e.kind==='text').map(e=>e.text);assert.ok(texts.some(t=>t.includes('380.0/')&&t.includes('未请求')));assert.ok(texts.some(t=>t.includes(r.manifest.qualityReportSHA256)));assert.ok(texts.some(t=>t.includes('E05展示冻结复核结果')));assert.equal(texts.some(t=>t.includes('图中计算表保留直射口径')),false);
});
test('stale model, changed report bytes, failed raw grids and missing room block presentation even with passed flags',async()=>{
 const {model,options}=await fixture();assert.throws(()=>buildEngineeringDeliveryProjection(model,{...options,modelSHA256:'0'.repeat(64)}),/MODEL_CHANGED/);assert.throws(()=>buildEngineeringDeliveryProjection(model,{...options,qualityReportSHA256:'0'.repeat(64)}),/QUALITY_CHANGED/);
 for(const change of [q=>q.rooms=[],q=>{q.passed=true;for(const p of ['medium','fine'])q.rooms[0].profiles[p].fill(1);},q=>q.modelSHA256='0'.repeat(64)])assert.throws(()=>buildEngineeringDeliveryProjection(model,altered(options,change)),/QUALITY_FAILED/);
});
test('missing or ambiguous sheet anchors fail instead of silently dropping accepted values from a drawing',async()=>{
 const {model,options}=await fixture();for(const change of [m=>m.sheets=m.sheets.filter(s=>s.id!=='E05'),m=>{const row=m.scene.entities.find(e=>e.kind==='text'&&e.text.startsWith('房间 | 灯具数'));m.scene.entities.push(structuredClone(row));}]){
  const changed=structuredClone(model);change(changed);const sha=engineeringDigest(changed),opts=altered({...options,modelSHA256:sha},q=>q.modelSHA256=sha);assert.throws(()=>buildEngineeringDeliveryProjection(changed,opts),/SHEET_MISSING|ANNOTATION_MISMATCH/);
 }
});
