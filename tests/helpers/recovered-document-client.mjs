// Native delivery can verify a successfully recovered final design separately
// from the stricter zero-error usability score. Never rewrite that score.
import assert from 'node:assert/strict';
import {parseTrace,normalizeClientEvents,unwrapDeferredCalls,toolResultErrors,clientExecutionErrors} from './client-trace.mjs';
export function qualifyRecoveredDocumentClient(report,trace){
 assert.equal(report.wholeClientTrialPassed,false);assert.equal(report.finalEngineeringStatePassed,true);assert.equal(report.controllerSemanticRepair,false);
 assert.equal(report.actualInstalledAiClient,true);assert.equal(report.process.code,0);
 assert.equal(report.checks.find(c=>c.name==='CLI finishes successfully')?.passed,true);
 assert.ok(report.checks.every(c=>c.passed||c.name==='No protocol/Bridge/permission errors'));
 const raw=parseTrace(trace),events=unwrapDeferredCalls(normalizeClientEvents(raw)),errors=events.flatMap(toolResultErrors);
 assert.equal(events.findLast(e=>e.type==='result')?.subtype,'success');
 assert.equal(clientExecutionErrors(raw).length,0);assert.equal(errors.length,report.protocolErrors.length);assert.ok(errors.length>0);
 const recoveryErrors=errors.map(error=>{
  const call=events.find(c=>c.type==='function_call'&&c.callId===error.callId),result=events.find(c=>c.type==='function_call_result'&&c.callId===error.callId),q=typeof call?.arguments==='string'?JSON.parse(call.arguments):call?.arguments,text=result?.output?.text??'';
  assert.ok(call?.name.endsWith('cad_project_documents'));assert.ok(['read','targets','source_blocks','draft_review'].includes(q?.action));
  const citation=q.action==='draft_review'&&text.includes('DOCUMENT_SOURCE_TARGET_CITATION_REQUIRED');
  const page=['read','targets','source_blocks'].includes(q.action)&&text.includes('Input validation error')&&text.includes('limit: Too big: expected number to be <=100');
  assert.ok(citation||page,'Only explicit citation/page validation recovery qualifies for this continuation');
  return {callId:error.callId,action:q.action,kind:citation?'missing_source_citation':'page_limit'};
 });
 return {zeroErrorUsabilityPassed:false,finalClientStatePassed:true,controllerSemanticRepair:false,recoveryErrors};
}
