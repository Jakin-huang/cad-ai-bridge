import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryLinks,deliveryMarkdown} from '../../src/delivery.mjs';
import {toolResponse} from '../../src/tool-response.mjs';
import {capabilities} from '../../src/capabilities.mjs';
import release from '../../release.json' with {type:'json'};
test('product release identity remains distinct from the preserved plugin protocol version',()=>{const c=capabilities();assert.equal(c.releaseVersion,release.version);assert.equal(c.compatibilityVersion,release.compatibilityVersion);});
test('delivery links retain exact file identity with spaces, percent, fragments and parentheses',()=>{
 const files=[{kind:'geometry-json',file:'E:\\data\\audit.json'},{kind:'png',file:'E:\\CAD 图纸\\a%(1)#2\\preview.png'},{kind:'dwg',file:'E:\\CAD 图纸\\a%(1)#2\\output.dwg'}],links=deliveryLinks(files);assert.deepEqual(links.map(l=>l.kind),['dwg','png']);for(const link of links){const target=link.markdown.match(/<([^>]+)>/)[1];assert.equal(decodeURIComponent(target),link.file.replaceAll('\\','/'));}assert.ok(deliveryMarkdown(files).startsWith('- [DWG'));
});
test('workflow transports machine-readable JSON and ready-to-copy clickable delivery separately',async()=>{
 const markdown='- [DWG 图纸](<E:/data/output.dwg>)',reply=await toolResponse('workflow',{response:'summary'},{ok:true,jobRoot:'job-test',delivery:{markdown},files:[]});assert.equal(JSON.parse(reply.content[0].text).delivery.markdown,markdown);assert.equal(reply.content[1].type,'text');assert.ok(reply.content[1].text.includes(markdown));assert.equal(reply.isError,false);
});
