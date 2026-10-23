// Preserve native CLI item identities and transport payloads. No synthetic Read,
// successful tool result, engineering value or terminal success is invented.
export function normalizeCodexClientEvents(raw){
 const events=[],started=new Set();let finalText='';
 const call=(item,sourceIndex)=>{if(started.has(item.id))return;started.add(item.id);const mcp=item.type==='mcp_tool_call';events.push({type:'function_call',callId:item.id,name:mcp?'mcp__'+item.server+'__'+item.tool:'codex_'+item.type,arguments:JSON.stringify(mcp?item.arguments:item),sourceIndex,nativeType:item.type});};
 raw.forEach((event,sourceIndex)=>{
  const item=event.item;if(['item.started','item.completed'].includes(event.type)&&item?.id){
   if(item.type==='agent_message'){if(event.type==='item.completed'){finalText=item.text;events.push({type:'assistant_text',text:item.text,sourceIndex,nativeType:item.type});}return;}
   if(['reasoning','todo_list'].includes(item.type))return;
   call(item,sourceIndex);if(event.type==='item.completed')events.push({type:'function_call_result',callId:item.id,status:item.status==='failed'||item.error!=null||item.type==='mcp_tool_call'&&item.result==null?'failed':'success',output:item.type==='mcp_tool_call'?item.result??{error:item.error}:item,sourceIndex,nativeType:item.type});return;
  }
  if(event.type==='turn.completed')events.push({type:'result',subtype:'success',result:finalText,sourceIndex,nativeType:event.type});
  if(event.type==='turn.failed')events.push({type:'result',subtype:'error_during_execution',error:event.error,sourceIndex,nativeType:event.type});
 });return events;
}
export function codexExecutionErrors(raw){return raw.flatMap((event,sourceIndex)=>['error','turn.failed'].includes(event.type)?[{kind:'client_execution_error',sourceIndex,error:event.error??event.message??null,nativeType:event.type}]:[]);}
