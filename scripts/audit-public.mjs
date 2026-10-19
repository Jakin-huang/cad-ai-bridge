// A bounded, redacted pre-publication check; not a substitute for a dedicated secret scanner.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {root,publicFiles} from './public-files.mjs';
function git(args,input){const r=spawnSync('git',args,{cwd:root,input,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});assert.equal(r.status,0,r.stderr||String(r.error));return r.stdout;}
const findings=[];
const forbidden=/(?:^|\/)(?:node_modules|runs|artifacts|dist)(?:\/|$)|(?:^|\/)(?:\.env(?:\..*)?|[^/]*\.local\.json[^/]*)$|\.(?:dwg|dxf|arx|dll|iso|qcow2|vhdx|pfx|p12)$/i;
const rules=[
 ['private-key',new RegExp('-----BEGIN (?:RSA |EC |OPENSSH )?'+'PRIVATE KEY-----')],
 ['github-token',/\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/],
 ['cloud-access-key',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
 ['api-key',/\bsk-[A-Za-z0-9_-]{32,}\b/],
 ['personal-windows-path',/C:[\\/]Users[\\/](?!PUBLIC\b|<|\$|%)[A-Za-z0-9_.-]+[\\/]/i]
];
function inspect(text,location){
 for(const [rule,pattern]of rules)if(pattern.test(text))findings.push({rule,location});
 const normalized=text.replaceAll('\\','/');
 if(normalized.includes(root.replaceAll('\\','/')))findings.push({rule:'development-workspace',location});
 const home=os.homedir().replaceAll('\\','/');
 if(home.length>5&&normalized.includes(home))findings.push({rule:'development-home',location});
}
const objects=git(['rev-list','--objects','--all']).trim().split('\n').filter(Boolean);
const types=new Map(git(['cat-file','--batch-check=%(objectname) %(objecttype)'],objects.map(line=>line.split(' ')[0]).join('\n')+'\n').trim().split('\n').map(line=>line.split(' ')));
// Inspect each unique reachable blob, including deleted and superseded source files.
let blobs=0;
for(const line of objects){
 const split=line.indexOf(' '),oid=split<0?line:line.slice(0,split),file=split<0?'':line.slice(split+1).trim();
 if(!file)continue;
 if(types.get(oid)!=='blob')continue;
 blobs++;
 if(forbidden.test(file))findings.push({rule:'excluded-history-file',location:oid.slice(0,12)+':'+file});
 const content=git(['cat-file','blob',oid]);
 if(content.includes('\0'))findings.push({rule:'binary-history-file',location:oid.slice(0,12)+':'+file});
 inspect(content,oid.slice(0,12)+':'+file);
}
const files=await publicFiles();for(const file of files){if(forbidden.test(file))findings.push({rule:'excluded-public-file',location:file});inspect(await fs.readFile(path.join(root,file),'utf8'),file);}
const identities=new Set(git(['log','--all','--format=%ae']).trim().split('\n').filter(Boolean));
const report={ok:findings.length===0,checkedAt:new Date().toISOString(),head:git(['rev-parse','HEAD']).trim(),commits:Number(git(['rev-list','--all','--count']).trim()),reachableBlobs:blobs,publicFiles:files.length,authorEmailCount:identities.size,findings,limits:['Pattern checks cover reachable Git blobs and the public source allowlist; values are never printed','Original Git author identities remain in history and will be public if the repository is published','Does not establish ownership or compatibility of third-party software']};
await fs.mkdir(path.join(root,'artifacts'),{recursive:true});await fs.writeFile(path.join(root,'artifacts/public-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;
