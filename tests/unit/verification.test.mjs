import test from 'node:test';
import assert from 'node:assert/strict';
import {verificationReport,legacyVerification} from '../../src/verification.mjs';
const passed={status:'passed'};
const proof={write:true,execution:passed,source:passed,saved:passed,reopened:passed,geometry:passed,preservation:passed,delivery:passed};
test('pending geometry cannot inherit execution success; failure dominates partial evidence',()=>{
 const r=verificationReport({...proof,geometry:{status:'partial',pending:[{type:'offset'}]}});assert.equal(r.status,'partial');assert.equal(r.requiredSatisfied,false);assert.equal(r.levels.saved.status,'passed');assert.equal(r.pending[0].level,'geometry');
 assert.equal(verificationReport({...proof,reopened:{status:'failed'},geometry:{status:'partial'}}).status,'failed');
});
test('machine checks and independent visual acceptance have separate status',()=>{
 const r=verificationReport({...proof,render:passed,visualRequested:true});assert.equal(r.requiredSatisfied,true);assert.equal(r.status,'partial');assert.equal(r.levels.visualReview.status,'unknown');assert.equal(r.acceptance.externalUser,false);
});
test('read-only tasks do not claim saved/edit verification and historical ok is not proof',()=>{
 const r=verificationReport({execution:passed,source:passed,delivery:passed});assert.equal(r.status,'passed');assert.equal(r.levels.geometry.status,'not_applicable');assert.equal(legacyVerification({ok:true}).requiredSatisfied,false);assert.throws(()=>verificationReport({execution:{status:'complete'}}),/INVALID_VERIFICATION_STATUS/);
});
