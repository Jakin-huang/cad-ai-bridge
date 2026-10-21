import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {normalizeClientEvents,unwrapDeferredCalls,findDeliveryMessage,markdownFileLinks,toolResultErrors} from '../helpers/client-trace.mjs';
const dwg=path.resolve('output.dwg'),csv=path.resolve('summary.csv'),png=path.resolve('preview.png'),text=[dwg,csv,png].map(file=>'[file](<'+file.replaceAll('\\','/')+'>)').join('\n');
test('deferred tool wrappers retain actual request, call identity and result association',()=>{const raw=[{type:'function_call',name:'DeferExecuteTool',callId:'x',arguments:JSON.stringify({toolName:'mcp__cad-ai-bridge__cad_design_project',params:{action:'prepare'}})},{type:'function_call_result',callId:'x',output:{text:'actual result'}}],events=unwrapDeferredCalls(raw);assert.equal(events[0].name,'mcp__cad-ai-bridge__cad_design_project');assert.equal(JSON.parse(events[0].arguments).action,'prepare');assert.equal(events[0].callId,events[1].callId);assert.equal(raw[0].name,'DeferExecuteTool');});
test('nested MCP Bridge rejection is a tool error even when outer transport succeeds; blocked intake is not',()=>{
 const wrap=value=>({type:'function_call_result',status:'success',callId:'x',output:{text:JSON.stringify([{type:'text',text:JSON.stringify(value)}])}});
 assert.deepEqual(toolResultErrors(wrap({ok:false,error:{code:'HOST_OR_INPUT_ERROR',message:'REVISION_PLAN_QUOTE_NOT_IN_BRIEF'}})),[{callId:'x',kind:'bridge_error',error:{code:'HOST_OR_INPUT_ERROR',message:'REVISION_PLAN_QUOTE_NOT_IN_BRIEF'}}]);
 assert.deepEqual(toolResultErrors(wrap({ok:true,status:'blocked',intake:{ok:false,issues:['Unknown use']}})),[]);
 assert.equal(toolResultErrors({type:'function_call_result',status:'success',output:{text:'Input validation error: unsupported field'}})[0].kind,'input_protocol_error');
 assert.equal(toolResultErrors({type:'function_call_result',status:'failed'})[0].kind,'transport_or_tool_error');
});
test('visible assistant delivery survives a later memory/footer result without inventing links',()=>{
 const events=normalizeClientEvents([{type:'assistant',message:{role:'assistant',content:[{type:'tool_use',id:'cad',name:'DeferExecuteTool',input:{}}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'cad',content:'actual result'}]}},{type:'assistant',message:{role:'assistant',content:[{type:'text',text}]}},{type:'result',subtype:'success',result:'Delivery links are above; memory could not be saved'}]);
 const delivery=findDeliveryMessage(events,[[dwg],[csv],[png]]);assert.equal(delivery.source,'assistant_text');assert.equal(delivery.text,text);assert.equal(delivery.sourceIndex,2);
});
test('tool text, pre-execution plans and code blocks cannot stand in for a visible final delivery',()=>{
 assert.equal(markdownFileLinks('```md\n'+text+'\n```').length,0);assert.equal(markdownFileLinks('`'+text.replaceAll('\n',' ')+'`').length,0);
 const events=[{type:'assistant_text',text},{type:'function_call',name:'DeferExecuteTool',callId:'cad'},{type:'function_call_result',callId:'cad',output:{text}},{type:'result',subtype:'success',result:'done'}];assert.equal(findDeliveryMessage(events,[[dwg],[csv],[png]]),undefined);
});
