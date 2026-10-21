// Read bounded local task text as data. No project mutation or authority claim.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {isWithin} from './drawings.mjs';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
export async function inspectBriefSource(briefFile,{inputRoot}){
 const root=await fs.realpath(inputRoot),file=await fs.realpath(path.isAbsolute(briefFile)?briefFile:path.resolve(root,briefFile));
 if(!isWithin(root,file)||!['.txt','.md'].includes(path.extname(file).toLowerCase()))throw Error('BRIEF_FILE_OUTSIDE_INPUT_ROOT');
 const info=await fs.stat(file);if(!info.isFile()||info.size>128*1024)throw Error('BRIEF_FILE_TOO_LARGE_OR_INVALID');
 const bytes=await fs.readFile(file);if(bytes.length>128*1024)throw Error('BRIEF_FILE_TOO_LARGE_OR_INVALID');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(text.trim().length<20||text.length>16000)throw Error('BRIEF_TEXT_SIZE_INVALID');
 return {ok:true,briefFile:file,rawSHA256:sha(bytes),textSHA256:sha(Buffer.from(text,'utf8')),bytes:bytes.length,text,normalization:'UTF-8 decode; optional leading BOM removed; line endings unchanged',scope:'Local text identity and literal content only; source authority, interpretation, standards and professional applicability unverified',professionalApproval:false};
}
