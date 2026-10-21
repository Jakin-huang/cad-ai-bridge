import path from 'node:path';
export function decodeClientResponseText(value){
 try{return JSON.parse(value);}catch{}
 // The installed CLI can join MCP JSON and the bridge's separate presentation
 // blocks into one text block. Accept only a complete leading JSON object and
 // an exact known presentation heading; never scan arbitrary source prose.
 const text=value.trim();if(!text.startsWith('{')||text.length>4*1024*1024)return undefined;let depth=0,quoted=false,escaped=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}if(c==='"'){quoted=true;continue;}if(c==='{')depth++;else if(c==='}'&&--depth===0){const suffix=text.slice(i+1).trimStart();if(!suffix.startsWith('交付文件：最终答复请直接使用以下实际文件链接，不改写成代码路径。\n')&&!suffix.startsWith('本次执行收据对应的依赖/影响清单（与当前设计交付分开）：\n'))return undefined;try{const body=JSON.parse(text.slice(0,i+1));return typeof body.ok==='boolean'?body:undefined;}catch{return undefined;}}}
 return undefined;
}
export function clientToolPayload(event){
 function unpack(v,depth=0){if(depth>12||v==null)return undefined;if(typeof v==='string'){const parsed=decodeClientResponseText(v);return parsed===undefined?undefined:unpack(parsed,depth+1);}if(Array.isArray(v))return v.map(x=>unpack(x,depth+1)).find(x=>x!==undefined);if(typeof v!=='object')return undefined;if(typeof v.ok==='boolean')return v;if(v.content!==undefined)return unpack(v.content,depth+1);if(v.text!==undefined)return unpack(v.text,depth+1);return undefined;}
 return unpack(event?.output);
}
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
  if(typeof v==='string'){const parsed=decodeClientResponseText(v);if(parsed!==undefined)return unpack(parsed,depth+1);if(/^Error: Permission to use [A-Za-z_]+ has been denied because this tool requires approval but permission prompts are not available in non-interactive mode\./.test(v.trim()))return [{kind:'client_permission_denied'}];if(/^<tool_use_error>[\s\S]*<\/tool_use_error>$/.test(v.trim()))return [{kind:'client_tool_use_error'}];return /Input validation error/.test(v)?[{kind:'input_protocol_error'}]:[];}
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
