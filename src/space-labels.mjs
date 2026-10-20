import crypto from 'node:crypto';
export function sourceSpaceLabels(room,sourceId){return (room.aliases||[]).map(a=>({id:a.id,name:a.name,relationship:a.relationship,reason:a.reason,status:'unverified_interpretation',spatialStatus:a.spatialStatus,sourceIds:[sourceId],instancePaths:a.label.instancePaths||[a.label.instancePath]}));}
export function spaceLabelsDigest(rooms){
 const records=rooms.filter(r=>r.sourceSpaceLabels?.length).map(r=>({roomId:r.id,labels:r.sourceSpaceLabels.map(l=>({id:l.id,name:l.name,relationship:l.relationship,reason:l.reason,status:l.status,spatialStatus:l.spatialStatus,sourceIds:[...l.sourceIds].sort(),instancePaths:l.instancePaths.map(p=>p.map(h=>h.toUpperCase()))})).sort((a,b)=>a.id.localeCompare(b.id))})).sort((a,b)=>a.roomId.localeCompare(b.roomId));
 return crypto.createHash('sha256').update(JSON.stringify(records)).digest('hex');
}
