// An input-shaped editing aid, never a review/adoption or a new authority.
// Stored output metadata and derived citation hashes are deliberately omitted.
export function editablePresentation(presentation,spaceIds=[]){
 if(!presentation)return null;
 const claim=c=>({text:c.text,reason:c.reason,evidence:c.evidence.map(({documentId,quote})=>({documentId,quote}))});
 return {title:claim(presentation.title),scope:claim(presentation.scope),spaceIds:[...(presentation.spaceIds??spaceIds)],notes:presentation.notes.map(claim),reviewed:false};
}
export const presentationEditingScope={parameterPath:'parameters.presentation',reviewRequired:true,scope:'Editable input shape only. Re-read current originals and conditions, select applicable notes and explicitly set reviewed=true before submitting. Do not submit the response wrapper; no semantic, authority or professional acceptance.'};
