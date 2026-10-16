import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
export const hashFile=async file=>crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
export function isWithin(root,file){const rel=path.relative(root,file);return rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);}
export async function snapshotDrawing(drawing,workspace,job,expectedSha256){
 const [input,allowed]=await Promise.all([fs.realpath(drawing),Promise.all((Array.isArray(workspace)?workspace:[workspace]).map(directory=>fs.realpath(directory)))]);
 if(!allowed.some(directory=>isWithin(directory,input))||path.extname(input).toLowerCase()!=='.dwg')throw new Error('Drawing must be a DWG within CADAGENT_ALLOWED_ROOT or owned task outputs');
 const stat=await fs.stat(input);if(!stat.isFile()||stat.size>250*1024*1024)throw new Error('Drawing exceeds 250 MiB or is not a file');
 const snapshot=path.join(job,'input.dwg');await fs.copyFile(input,snapshot,fs.constants.COPYFILE_EXCL);
 const digest=await hashFile(snapshot);
 if(expectedSha256&&expectedSha256.toLowerCase()!==digest)throw new Error('STALE_FILE: source DWG digest differs from expectedSha256');
 return digest;
}
