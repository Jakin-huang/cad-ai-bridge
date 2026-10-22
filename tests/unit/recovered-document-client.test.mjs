import test from 'node:test';import assert from 'node:assert/strict';
import {qualifyRecoveredDocumentClient} from '../helpers/recovered-document-client.mjs';
test('native continuation preserves failed zero-error score and refuses permission, unknown, terminal or final-state failures',()=>{
 const report={wholeClientTrialPassed:false,finalEngineeringStatePassed:true,controllerSemanticRepair:false,actualInstalledAiClient:true,process:{code:0},checks:[{name:'CLI finishes successfully',passed:true},{name:'No protocol/Bridge/permission errors',passed:false},{name:'Final values preserved',passed:true}],protocolErrors:[{callId:'a'}]};
 const events=[{type:'function_call',callId:'a',name:'mcp__cad-ai-bridge__cad_project_documents',arguments:JSON.stringify({action:'draft_review'})},{type:'function_call_result',callId:'a',status:'failed',output:{text:'DOCUMENT_SOURCE_TARGET_CITATION_REQUIRED'}},{type:'result',subtype:'success'}],trace=JSON.stringify(events);
 assert.equal(qualifyRecoveredDocumentClient(report,trace).zeroErrorUsabilityPassed,false);
 for(const change of [{finalEngineeringStatePassed:false},{controllerSemanticRepair:true},{process:{code:1}},{checks:[...report.checks,{name:'Changed physical values',passed:false}]}])assert.throws(()=>qualifyRecoveredDocumentClient({...report,...change},trace));
 for(const text of ['Permission denied','DOCUMENT_TASK_INPUT_CHANGED','DOCUMENT_DRAFT_CHANGED'])assert.throws(()=>qualifyRecoveredDocumentClient(report,JSON.stringify(events.map(e=>e.type==='function_call_result'?{...e,output:{text}}:e))));
 assert.throws(()=>qualifyRecoveredDocumentClient(report,JSON.stringify(events.map(e=>e.type==='result'?{...e,subtype:'error_max_turns'}:e))));
 assert.equal(report.wholeClientTrialPassed,false);
 const paging=events.map(e=>e.type==='function_call'?{...e,arguments:JSON.stringify({action:'read',limit:2000})}:e.type==='function_call_result'?{...e,output:{text:'Input validation error: limit: Too big: expected number to be <=100'}}:e);
 assert.equal(qualifyRecoveredDocumentClient(report,JSON.stringify(paging)).recoveryErrors[0].kind,'page_limit');
});
