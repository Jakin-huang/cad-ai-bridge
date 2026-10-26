// Shared project-facing text, explicitly interpreted by the Agent. Literal
// evidence and projection checks do not certify semantic completeness.
import {z} from 'zod';
const sha=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const plain=(min,max)=>z.string().trim().min(min).max(max).regex(/^[^\u0000-\u001f\u007f]*$/,'Use a single plain-text paragraph');
const original=z.strictObject({documentId:id,quote:z.string().min(5).max(4000)});
const claim=(min,max,evidence=original)=>z.strictObject({text:plain(min,max),reason:z.string().min(10).max(1000),evidence:z.array(evidence).min(1).max(10)});
export const presentationParameters=z.strictObject({title:claim(1,80),scope:claim(20,1000),spaceIds:z.array(id).min(1).max(100),notes:z.array(claim(10,500)).min(1).max(8),reviewed:z.literal(true)}).refine(p=>Buffer.byteLength(JSON.stringify(p))<=64000,'Presentation evidence budget exceeded');
const citation=original.extend({textSHA256:sha});
const legacyPresentation=z.strictObject({schemaVersion:z.literal(1),title:claim(1,80,citation),scope:claim(20,1000,citation),notes:z.array(claim(10,500,citation)).min(1).max(8),documents:z.strictObject({jobId:z.string(),projectId:z.uuid(),revision:z.number().int().nonnegative(),sha256:sha}),semanticCoverageAccepted:z.literal(false),professionalApproval:z.literal(false)});
export const drawingPresentationSchema=z.discriminatedUnion('schemaVersion',[legacyPresentation,legacyPresentation.extend({schemaVersion:z.literal(2),spaceIds:z.array(id).min(1).max(100)})]);
export function presentationClaims(p){return [p.title,p.scope,...p.notes];}
export function presentationInputIssues(input){const p=input.drawingPresentation;if(!p)return[];const issues=[];if(p.title.text!==input.title)issues.push('PRESENTATION_TITLE_INPUT_MISMATCH');if(input.discipline==='ordinary-lighting'&&p.scope.text!==input.scope)issues.push('PRESENTATION_SCOPE_INPUT_MISMATCH');if(p.schemaVersion===2){const expected=(input.rooms??input.program).map(r=>r.id).sort(),actual=[...p.spaceIds].sort();if(new Set(actual).size!==actual.length||JSON.stringify(actual)!==JSON.stringify(expected))issues.push('PRESENTATION_SPACE_SCOPE_MISMATCH');}return issues;}
export function presentationLines(input){const p=input.drawingPresentation;return p?['项目范围（原文）：'+p.scope.text,...(p.schemaVersion===2?['本次设计空间：'+(input.rooms??input.program).map(r=>r.name+' ['+r.id+']').join('；')]:[]),...p.notes.map((n,i)=>'项目说明 '+(i+1)+'（原文）：'+n.text),'项目文字为Agent声明解释及字面引文校核，语义完整性、资料权威性和专业适用性仍待审。']:[];}
function noteText(model){return model.sheets.filter(s=>/^(E01|SP01)(-|$)/.test(s.id)).map(s=>model.scene.entities.filter(e=>e.kind==='text'&&e.position[0]>=s.region.min[0]&&e.position[0]<=s.region.max[0]&&e.position[1]>=3000&&e.position[1]<=22200).map(e=>e.text).join('')).join('');}
export function auditDrawingPresentation(model){const p=model.input.drawingPresentation;if(!p)return[];const checks=presentationInputIssues(model.input).map(id=>({id,ok:false,detail:'Source-declared project text differs from current input'})),text=noteText(model);
 for(const s of model.sheets){const headers=model.scene.entities.filter(e=>e.kind==='text'&&e.position[0]>=s.region.min[0]&&e.position[0]<=s.region.max[0]&&e.position[1]>s.region.max[1]-2500).map(e=>e.text).join('');checks.push({id:'presentation_title_'+s.id,ok:headers===p.title.text+' - '+s.title,detail:'Every sheet header exactly matches the source-declared project name and its sheet title'});}
 if(p.schemaVersion===2)checks.push({id:'presentation_space_scope',ok:text.includes('本次设计空间：'+(model.input.rooms??model.input.program).map(r=>r.name+' ['+r.id+']').join('；')),detail:'Explicit declared space IDs equal and name every space in this task; no project-label routing'});
 checks.push({id:'presentation_scope',ok:text.includes('项目范围（原文）：'+p.scope.text),detail:'Full source-declared scope is retained in the note sheets'});
 p.notes.forEach((n,i)=>checks.push({id:'presentation_note_'+i,ok:text.includes('项目说明 '+(i+1)+'（原文）：'+n.text),detail:'Full source-declared project note is retained in the note sheets'}));return checks;
}

export function presentationTextLines(text,width){const chars=Array.from(text),lines=[];width=Math.max(1,Math.floor(width));for(let i=0;i<chars.length;i+=width)lines.push(chars.slice(i,i+width).join(''));return lines;}
