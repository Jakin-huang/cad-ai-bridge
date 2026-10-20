import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {jobDirectory,jobJson} from './jobs.mjs';
import {hashFile} from './drawings.mjs';
import {atomicJson,csvCell} from './files.mjs';
import {matchesRow} from './query-index.mjs';

const unitToMm=Object.freeze({Millimeters:1,Centimeters:10,Meters:1000,Decimeters:100,Inches:25.4,Feet:304.8,USSurveyFeet:1200000/3937});
const fold=v=>String(v??'').toUpperCase();
const attribute=(row,tag)=>Object.entries(row.attributes||{}).find(([key])=>fold(key)===fold(tag))?.[1];
export const entityIdentity=row=>({handle:row.handle,instancePath:row.instancePath??[row.handle],layout:row.layout??'Model'});
function excluded(row,exclude){return exclude&&(exclude.layers?.some(v=>fold(v)===fold(row.layer))||exclude.handles?.some(v=>fold(v)===fold(row.handle))||exclude.blockNames?.some(v=>fold(v)===fold(row.blockName))||exclude.regions?.some(region=>matchesRow(row,{region})));}
export function analyzeCapture(capture,{filter={},exclude,checks=[],quantities=[]}={}){
 if(!capture.ok||!capture.query||!Array.isArray(capture.query.entities)||capture.query.truncated||capture.query.errors?.length)throw Error('ANALYSIS_CAPTURE_INCOMPLETE: a successful complete frozen scan is required');
 if(!/^[a-fA-F0-9]{64}$/.test(capture.inputSha256??''))throw Error('ANALYSIS_SOURCE_IDENTITY_MISSING');
 const all=capture.query.entities,rows=all.filter(row=>matchesRow(row,filter)&&!excluded(row,exclude));
 if(rows.length*(checks.length+quantities.length)>300000)throw Error('ANALYSIS_TOO_LARGE: narrow filters or split rules to keep at most 300000 entity-rule evaluations');
 const sourceSha256=capture.inputSha256,units=capture.query.units??capture.snapshot?.units,mm=unitToMm[units],issues=[],checkResults=[];
 const report=(rule,row,message,extra={})=>issues.push({ruleId:rule.id,severity:rule.severity??'warning',...entityIdentity(row),sourceSha256,message,...extra});
 for(const rule of checks){
  const selected=rows.filter(row=>matchesRow(row,rule.filter??{})),start=issues.length;let evaluated=0,pending=0;
  if(rule.type==='duplicate_attribute'){
   const groups=new Map();for(const row of selected){const value=attribute(row,rule.tag);if(value===undefined||!String(value).trim()){pending++;continue;}evaluated++;const key=rule.caseSensitive?value:fold(value);(groups.get(key)??groups.set(key,[]).get(key)).push(row);}
   for(const group of groups.values())if(group.length>1)for(const row of group)report(rule,row,'Duplicate attribute value',{tag:rule.tag,value:attribute(row,rule.tag),occurrences:group.length});
  }else for(const row of selected){
   if(rule.type==='required_attributes'){evaluated++;for(const tag of rule.tags)if(!String(attribute(row,tag)??'').trim())report(rule,row,'Required attribute is missing or blank',{tag});}
   else if(rule.type==='forbidden_text'){if(typeof row.text!=='string'){pending++;continue;}evaluated++;if((rule.caseSensitive?row.text:fold(row.text)).includes(rule.caseSensitive?rule.text:fold(rule.text)))report(rule,row,'Text contains a forbidden literal',{text:row.text});}
   else if(rule.type==='allowed_layers'){evaluated++;if(!rule.layers.some(v=>fold(v)===fold(row.layer)))report(rule,row,'Entity is outside the allowed layer set',{layer:row.layer});}
   else if(rule.type==='minimum_length'){
    if(!Number.isFinite(row.length)||rule.unit==='mm'&&!mm){pending++;continue;}evaluated++;const length=row.length*(rule.unit==='mm'?mm:1);if(length<rule.minimum)report(rule,row,'Length is below the declared minimum',{length,unit:rule.unit,minimum:rule.minimum});
   }else if(rule.type==='text_height'){
    if(!Number.isFinite(row.height)||!mm){pending++;continue;}evaluated++;const height=row.height*mm;if(height<rule.minimumMm||height>rule.maximumMm)report(rule,row,'Text height is outside the declared drawing-unit range',{heightMm:height});
   }else throw Error('ANALYSIS_RULE_UNSUPPORTED: '+rule.type);
  }
  checkResults.push({id:rule.id,type:rule.type,selected:selected.length,evaluated,pending,issueCount:issues.length-start,status:pending?'partial':'completed',authority:rule.authority??'User-supplied rule; not an independently established engineering standard'});
 }
 const quantityResults=[],quantityRows=[];
 for(const rule of quantities){
  const selected=rows.filter(row=>matchesRow(row,rule.filter??{}));let total=0,missing=0;
  for(const row of selected){let value;
   if(rule.measure==='count')value=1;
   else if(Number.isFinite(row.length)&&row.length>=0&&mm)value=row.length*mm/(rule.unit==='m'?1000:1);
   const computed=value===undefined?undefined:value*rule.factor;if(computed!==undefined&&!Number.isFinite(computed))throw Error('ANALYSIS_QUANTITY_OVERFLOW');
   if(computed===undefined)missing++;else total+=computed;
   quantityRows.push({ruleId:rule.id,...entityIdentity(row),sourceSha256,measure:rule.measure,raw:value,factor:rule.factor,value:computed,unit:rule.measure==='count'?'each':rule.unit,status:computed===undefined?'unavailable':'measured',reason:computed===undefined?!mm?'Drawing unit is unknown or unsupported':'No world-space length; definition lengths are not transformed into physical quantities':undefined});
  }
  const withWaste=total*(1+rule.wastePercent/100);let rounded=withWaste;
  if(rule.roundUpTo){const quotient=withWaste/rule.roundUpTo,nearest=Math.round(quotient),tolerance=Number.EPSILON*Math.max(1,Math.abs(quotient))*16,steps=Math.ceil(Math.abs(quotient-nearest)<=tolerance?nearest:quotient);if(!Number.isSafeInteger(steps))throw Error('ANALYSIS_QUANTITY_PRECISION_UNSUPPORTED');rounded=Number((steps*rule.roundUpTo).toPrecision(15));}
  if(!Number.isFinite(rounded))throw Error('ANALYSIS_QUANTITY_OVERFLOW');
  quantityResults.push({id:rule.id,meaning:rule.meaning,measure:rule.measure,unit:rule.measure==='count'?'each':rule.unit,selected:selected.length,measured:selected.length-missing,missing,measuredSubtotal:total,wastePercent:rule.wastePercent,roundUpTo:rule.roundUpTo,total:missing?null:rounded,partialSubtotal:missing?rounded:undefined,status:missing?'partial':'complete',ruleVersion:rule.version,authority:rule.authority??'User-supplied quantity rule; occurrence counts do not establish installed or procurement quantities',provenance:'quantityRows bound to sourceSha256 and instancePath'});
 }
 return {ok:true,sourceSha256,coverage:{captured:all.length,selected:rows.length,excluded:all.filter(row=>matchesRow(row,filter)).length-rows.length,units,mmPerDrawingUnit:mm??null,truncated:false,scope:capture.query.scope,exclusions:exclude,quantityMeaning:'Explicit rule semantics; no inferred circuits, connectivity, compliance or procurement truth'},checkResults,issues,quantityResults,quantityRows,summary:{issues:issues.length,checks:checks.length,pendingChecks:checkResults.reduce((n,r)=>n+r.pending,0),quantityRules:quantities.length,partialQuantities:quantityResults.filter(r=>r.status==='partial').length}};
}

export async function runAnalysis(runs,args){
 const captureJob=await jobDirectory(runs,args.captureJobId),captureFile=path.join(captureJob,'result.json'),bytes=await fs.readFile(captureFile),sha=createHash('sha256').update(bytes).digest('hex');
 if(args.expectedResultSha256&&sha!==args.expectedResultSha256.toLowerCase())throw Error('RESULT_CHANGED: frozen capture differs from the expected result SHA-256');
 // Analyze exactly the bytes whose digest was checked, without a second read
 // that could select a different record or reinterpret drawing text as paths.
 const capture=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')),task=await jobJson(captureJob,'task.json');
 if(task.action!=='scan')throw Error('ANALYSIS_SCAN_REQUIRED: use cad_scan_drawing to create a complete capture first');
 const result=analyzeCapture(capture,args),job=await fs.mkdtemp(path.join(runs,'job-analysis-'));
 const files=[];for(const [name,columns,rows]of [['issues',['ruleId','severity','handle','instancePath','layout','message','sourceSha256'],result.issues],['quantities',['ruleId','handle','instancePath','layout','raw','factor','value','unit','status','reason','sourceSha256'],result.quantityRows]]){
  const file=path.join(job,name+'.csv');await fs.writeFile(file,'\uFEFF'+[columns,...rows.map(row=>columns.map(key=>Array.isArray(row[key])?JSON.stringify(row[key]):row[key]))].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n');files.push({kind:name+'-csv',file,sha256:await hashFile(file),bytes:(await fs.stat(file)).size});
 }
 Object.assign(result,{jobRoot:job,captureJobId:args.captureJobId,captureResultSha256:sha,files,safeToRetry:true,details:{jobId:path.basename(job),tool:'cad_read_result',kinds:['issues','quantityRows','quantityResults']}});
 await atomicJson(path.join(job,'request.json'),args);await atomicJson(path.join(job,'result.json'),result);await atomicJson(path.join(job,'task.json'),{jobId:path.basename(job),action:'analyze',status:'completed',phase:'completed',updatedAt:new Date().toISOString()});return result;
}
