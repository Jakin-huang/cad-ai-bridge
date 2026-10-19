import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {outsideProject,dataHome,projectPath} from '../../src/local-paths.mjs';
import {assertNoSampleFiles} from '../../scripts/public-files.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));
test('generated data cannot target the source tree or a relative directory',()=>{
 assert.throws(()=>outsideProject(project),/outside|source/);
 assert.throws(()=>outsideProject(path.join(project,'runs')),/source/);
 assert.throws(()=>outsideProject('relative-data'),/absolute/);
 assert.equal(outsideProject(path.join(os.tmpdir(),'cadbridge-data')),path.resolve(os.tmpdir(),'cadbridge-data'));
});
test('runtime and validation files resolve outside source while executable sources stay in it',()=>{
 assert.ok(path.relative(project,dataHome()).startsWith('..')||path.isAbsolute(path.relative(project,dataHome())));
 assert.notEqual(projectPath('artifacts/report.json'),path.join(project,'artifacts/report.json'));
 assert.equal(projectPath('mcp-server.mjs'),path.join(project,'mcp-server.mjs'));
});
test('release allowlist refuses drawings, previews and fixture directories',()=>{
 for(const file of ['examples/input.json','tests/fixtures/input.json','docs/preview.svg','drawing.dwg','drawing.dxf','output.pdf'])assert.throws(()=>assertNoSampleFiles([file]),/must not be distributed/);
 assert.doesNotThrow(()=>assertNoSampleFiles(['src/runner.mjs','使用说明.html','scripts/UserLauncher.cs']));
});
