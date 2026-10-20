import path from 'node:path';
export function parseTrace(text){return text.trim().startsWith('[')?JSON.parse(text):text.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}
export function normalizeClientEvents(raw){
 const events=[];
 raw.forEach((event,sourceIndex)=>{
  if(['function_call','function_call_result','result'].includes(event.type)){events.push({...event,sourceIndex});return;}
  for(const block of event.message?.content||[]){
   if(block.type==='text'&&(event.type==='assistant'||event.message.role==='assistant'))events.push({type:'assistant_text',text:block.text,sourceIndex});
   if(block.type==='tool_use')events.push({type:'function_call',callId:block.id,name:block.name,arguments:JSON.stringify(block.input),sourceIndex});
   if(block.type==='tool_result')events.push({type:'function_call_result',callId:block.tool_use_id,status:block.is_error?'failed':'success',output:{text:typeof block.content==='string'?block.content:JSON.stringify(block.content)},sourceIndex});
  }
 });return events;
}
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
