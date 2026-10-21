import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {normalizeClientEvents,unwrapDeferredCalls,findDeliveryMessage,markdownFileLinks,toolResultErrors,clientExecutionErrors,clientToolPayload,decodeClientResponseText} from '../helpers/client-trace.mjs';
const dwg=path.resolve('output.dwg'),csv=path.resolve('summary.csv'),png=path.resolve('preview.png'),text=[dwg,csv,png].map(file=>'[file](<'+file.replaceAll('\\','/')+'>)').join('\n');
test('deferred tool wrappers retain actual request, call identity and result association',()=>{const raw=[{type:'function_call',name:'DeferExecuteTool',callId:'x',arguments:JSON.stringify({toolName:'mcp__cad-ai-bridge__cad_design_project',params:{action:'prepare'}})},{type:'function_call_result',callId:'x',output:{text:'actual result'}}],events=unwrapDeferredCalls(raw);assert.equal(events[0].name,'mcp__cad-ai-bridge__cad_design_project');assert.equal(JSON.parse(events[0].arguments).action,'prepare');assert.equal(events[0].callId,events[1].callId);assert.equal(raw[0].name,'DeferExecuteTool');});
test('deferred JSON-object strings retain nested arrays exactly like the installed CLI normalization',()=>{
 const params={action:'prepare',parameters:{action:'prepare',project:{rooms:[{polygon:[[0,0],[8000,0],[0,6000]]}],sources:[]}}},raw={type:'function_call',name:'DeferExecuteTool',callId:'json-param',arguments:JSON.stringify({toolName:'mcp__cad-ai-bridge__cad_engineering_task',params:JSON.stringify(params)})},event=unwrapDeferredCalls([raw])[0];assert.deepEqual(JSON.parse(event.arguments),params);assert.equal(event.parameterEncoding,'json_object_string');assert.equal(event.callId,raw.callId);assert.equal(JSON.parse(raw.arguments).params,JSON.stringify(params));
 for(const value of ['not JSON','[]','null','1']){const invalid=unwrapDeferredCalls([{...raw,arguments:JSON.stringify({toolName:'tool',params:value})}])[0];assert.equal(JSON.parse(invalid.arguments),value);assert.equal(invalid.parameterEncoding,'string');}
});
test('nested MCP Bridge rejection is a tool error even when outer transport succeeds; blocked intake is not',()=>{
 const wrap=value=>({type:'function_call_result',status:'success',callId:'x',output:{text:JSON.stringify([{type:'text',text:JSON.stringify(value)}])}});
 assert.deepEqual(toolResultErrors(wrap({ok:false,error:{code:'HOST_OR_INPUT_ERROR',message:'REVISION_PLAN_QUOTE_NOT_IN_BRIEF'}})),[{callId:'x',kind:'bridge_error',error:{code:'HOST_OR_INPUT_ERROR',message:'REVISION_PLAN_QUOTE_NOT_IN_BRIEF'}}]);
 assert.deepEqual(toolResultErrors(wrap({ok:true,status:'blocked',intake:{ok:false,issues:['Unknown use']}})),[]);
 assert.equal(toolResultErrors({type:'function_call_result',status:'success',output:{text:'Input validation error: unsupported field'}})[0].kind,'input_protocol_error');
 assert.equal(toolResultErrors({type:'function_call_result',status:'failed'})[0].kind,'transport_or_tool_error');
});

test('CLI-joined JSON and exact bridge delivery text preserve payloads and cannot hide failure',()=>{
 const suffix='\n交付文件：最终答复请直接使用以下实际文件链接，不改写成代码路径。\n[file](<output.pdf>)',wrap=body=>({type:'function_call_result',callId:'joined',status:'success',output:{text:JSON.stringify([{type:'text',text:JSON.stringify(body)+suffix}])}}),body={ok:true,jobId:'job-task-example',current:{status:'delivered',pending:{ok:false}},caption:'Escaped quote " and braces } {',nested:[{value:'\\path'}]};assert.deepEqual(clientToolPayload(wrap(body)),body);assert.deepEqual(toolResultErrors(wrap(body)),[]);const failed={ok:false,error:{code:'PRESENTATION_FAILED'},files:[{file:'retained.pdf'}]};assert.deepEqual(clientToolPayload(wrap(failed)),failed);assert.deepEqual(toolResultErrors(wrap(failed)),[{callId:'joined',kind:'bridge_error',error:failed.error}]);
});

test('joined-response decoding requires the complete leading object and known suffix, never arbitrary JSON in source prose',()=>{
 const body={ok:false,error:{code:'QUOTED_SOURCE_ONLY'}},json=JSON.stringify(body);for(const text of ['Source says '+json+'\n交付文件：example',json+'\nUnrelated source commentary',json.slice(0,-1)+'\n交付文件：最终答复请直接使用以下实际文件链接，不改写成代码路径。\n[file](output.pdf)'])assert.equal(decodeClientResponseText(text),undefined);const event={type:'function_call_result',status:'success',output:{text:JSON.stringify({ok:true,text:json+'\n交付文件：最终答复请直接使用以下实际文件链接，不改写成代码路径。\n[file](output.pdf)'})}};assert.deepEqual(toolResultErrors(event),[]);assert.equal(clientToolPayload(event).ok,true);
});

test('client permission refusal inside a successful text envelope remains a usability error, while source content is not scanned',()=>{
 const text='Error: Permission to use Read has been denied because this tool requires approval but permission prompts are not available in non-interactive mode. Retain this refused attempt.';
 const wrap=v=>({type:'function_call_result',callId:'read-cache',status:'success',output:{text:JSON.stringify([{type:'text',text:typeof v==='string'?v:JSON.stringify(v)}])}});
 assert.deepEqual(toolResultErrors(wrap(text)),[{callId:'read-cache',kind:'client_permission_denied'}]);assert.deepEqual(toolResultErrors(wrap({ok:true,text,sourceDocument:'A quoted source warning is data'})),[]);assert.deepEqual(toolResultErrors(wrap('The supplied manual discusses permission denied errors.')),[]);
});
test('Read raw-response failure cannot disappear behind is_error=false in the CLI tool envelope',()=>{
 const raw=[{type:'user',message:{content:[{type:'tool_result',tool_use_id:'missing-file',is_error:false,_meta:{rawResponse:{is_error:true,tool_error_code:'1001'}},content:[{type:'text',text:'<tool_use_error>File does not exist.</tool_use_error>'}]}]}}];const events=normalizeClientEvents(raw);assert.equal(events[0].status,'failed');assert.deepEqual(toolResultErrors(events[0]),[{callId:'missing-file',kind:'transport_or_tool_error'}]);
});
test('exact CLI tool-use error wrapper counts as failure but a successful Bridge source payload containing that string stays data',()=>{
 const text='<tool_use_error>File does not exist.</tool_use_error>',wrap=v=>({type:'function_call_result',status:'success',callId:'read',output:{text:JSON.stringify([{type:'text',text:typeof v==='string'?v:JSON.stringify(v)}])}});assert.deepEqual(toolResultErrors(wrap(text)),[{callId:'read',kind:'client_tool_use_error'}]);assert.deepEqual(toolResultErrors(wrap({ok:true,text,sourceDocument:true})),[]);assert.deepEqual(toolResultErrors(wrap('   1→'+text)),[]);
});
test('zero-token CLI synthetic unavailable-tool messages are failures without misclassifying ordinary assistant prose',()=>{
 const event={type:'assistant',message:{content:[{type:'text',text:'Tool Bash not found in agent cli.'}],usage:{input_tokens:0,output_tokens:0},stop_reason:null}};assert.deepEqual(clientExecutionErrors([event]),[{kind:'client_tool_unavailable',tool:'Bash',sourceIndex:0,message:'Tool Bash not found in agent cli.'}]);const prose=structuredClone(event);prose.message.usage.output_tokens=12;assert.deepEqual(clientExecutionErrors([prose]),[]);const source=structuredClone(event);source.type='user';assert.deepEqual(clientExecutionErrors([source]),[]);const quoted=structuredClone(event);quoted.message.content[0].text='The log contained: Tool Bash not found in agent cli.';assert.deepEqual(clientExecutionErrors([quoted]),[]);
});
test('visible assistant delivery survives a later memory/footer result without inventing links',()=>{
 const events=normalizeClientEvents([{type:'assistant',message:{role:'assistant',content:[{type:'tool_use',id:'cad',name:'DeferExecuteTool',input:{}}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'cad',content:'actual result'}]}},{type:'assistant',message:{role:'assistant',content:[{type:'text',text}]}},{type:'result',subtype:'success',result:'Delivery links are above; memory could not be saved'}]);
 const delivery=findDeliveryMessage(events,[[dwg],[csv],[png]]);assert.equal(delivery.source,'assistant_text');assert.equal(delivery.text,text);assert.equal(delivery.sourceIndex,2);
});
test('tool text, pre-execution plans and code blocks cannot stand in for a visible final delivery',()=>{
 assert.equal(markdownFileLinks('```md\n'+text+'\n```').length,0);assert.equal(markdownFileLinks('`'+text.replaceAll('\n',' ')+'`').length,0);
 const events=[{type:'assistant_text',text},{type:'function_call',name:'DeferExecuteTool',callId:'cad'},{type:'function_call_result',callId:'cad',output:{text}},{type:'result',subtype:'success',result:'done'}];assert.equal(findDeliveryMessage(events,[[dwg],[csv],[png]]),undefined);
});
