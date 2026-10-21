import path from 'node:path';
export function parseTrace(text){return text.trim().startsWith('[')?JSON.parse(text):text.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}
export function normalizeClientEvents(raw){
 const events=[];
 raw.forEach((event,sourceIndex)=>{
  if(['function_call','function_call_result','result'].includes(event.type)){events.push({...event,sourceIndex});return;}
  for(const block of event.message?.content||[]){
   if(block.type==='text'&&(event.type==='assistant'||event.message.role==='assistant'))events.push({type:'assistant_text',text:block.text,sourceIndex});
   if(block.type==='tool_use')events.push({type:'function_call',callId:block.id,name:block.name,arguments:JSON.stringify(block.input),sourceIndex});
   if(block.type==='tool_result')events.push({type:'function_call_result',callId:block.tool_use_id,status:block.is_error||block._meta?.rawResponse?.is_error===true?'failed':'success',output:{text:typeof block.content==='string'?block.content:JSON.stringify(block.content)},sourceIndex});
  }
 });return events;
}
export function unwrapDeferredCalls(events){return events.map(e=>{if(e.type!=='function_call'||e.name!=='DeferExecuteTool')return e;const args=typeof e.arguments==='string'?JSON.parse(e.arguments):e.arguments;let params=args.params,parameterEncoding='object';if(typeof params==='string'){parameterEncoding='string';try{const parsed=JSON.parse(params);if(parsed!==null&&typeof parsed==='object'&&!Array.isArray(parsed)){params=parsed;parameterEncoding='json_object_string';}}catch{}}return {...e,name:args.toolName,arguments:JSON.stringify(params),wrapper:e.name,parameterEncoding};});}
export function toolResultErrors(event){
 if(event.type!=='function_call_result')return [];
 if(event.status==='failed')return [{callId:event.callId,kind:'transport_or_tool_error'}];
 function unpack(v,depth=0){
  if(depth>12||v==null)return [];
  if(typeof v==='string'){try{return unpack(JSON.parse(v),depth+1);}catch{if(/^Error: Permission to use [A-Za-z_]+ has been denied because this tool requires approval but permission prompts are not available in non-interactive mode\./.test(v.trim()))return [{kind:'client_permission_denied'}];if(/^<tool_use_error>[\s\S]*<\/tool_use_error>$/.test(v.trim()))return [{kind:'client_tool_use_error'}];return /Input validation error/.test(v)?[{kind:'input_protocol_error'}]:[];}}
  if(Array.isArray(v))return v.flatMap(x=>unpack(x,depth+1));
  if(typeof v!=='object')return [];
  // Inspect the response envelope, never an embedded blocked intake/quality
  // report or source document that legitimately contains its own ok=false.
  if(Object.hasOwn(v,'ok'))return v.ok===false?[{kind:'bridge_error',error:v.error??null}]:[];
  if(v.isError===true)return [{kind:'mcp_error'}];
  if(v.content!==undefined)return unpack(v.content,depth+1);
  if(v.text!==undefined)return unpack(v.text,depth+1);
  return [];
 }
 return unpack(event.output).map(e=>({callId:event.callId,...e}));
}
export function clientExecutionErrors(raw){
 // Installed CLI sometimes emits a zero-token synthetic assistant message for
 // unavailable internal tools, without a tool_result or failed final result.
 // Match that observed envelope, never arbitrary assistant prose/source text.
 return raw.flatMap((event,sourceIndex)=>{const m=event.message,blocks=m?.content;if(event.type!=='assistant'||m?.usage?.input_tokens!==0||m?.usage?.output_tokens!==0||m.stop_reason!==null||blocks?.length!==1||blocks[0].type!=='text')return [];const match=blocks[0].text?.match(/^Tool ([A-Za-z_][A-Za-z0-9_]*) not found in agent cli\.$/);return match?[{kind:'client_tool_unavailable',tool:match[1],sourceIndex,message:blocks[0].text}]:[];});
}
export function clientTraceErrors(raw){return [...normalizeClientEvents(raw).flatMap(toolResultErrors),...clientExecutionErrors(raw)];}
export function markdownFileLinks(text){
 // Code-formatted paths and links inside code examples are not clickable delivery.
 const visible=String(text??'').replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g,'').replace(/`[^`\r\n]*`/g,'');
 return [...visible.matchAll(/\[[^\]]*\]\(<?([^>\r\n)]+)>?\)/g)].map(match=>{try{return path.resolve(decodeURIComponent(match[1])).toLowerCase();}catch{return '';}});
}
export function findDeliveryMessage(events,groups){
 const ids=new Set(events.filter(e=>e.type==='function_call'&&e.name==='DeferExecuteTool').map(e=>e.callId)),lastCadResult=events.findLastIndex(e=>e.type==='function_call_result'&&ids.has(e.callId));
 const candidates=events.map((e,index)=>({e,index})).filter(({e,index})=>index>lastCadResult&&(e.type==='assistant_text'||e.type==='result'&&e.subtype==='success')).reverse();
 for(const {e,index}of candidates){const text=e.type==='assistant_text'?e.text:e.result,links=markdownFileLinks(text);if(groups.every(group=>group.some(file=>links.includes(path.resolve(file).toLowerCase()))))return {text,source:e.type,eventIndex:index,sourceIndex:e.sourceIndex,links};}
 return undefined;
}
