// Actual product client: a new public original brief, without a baseline,
// final drawing or client-visible grading ledger. Never a coding delegate.
import fs from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {outsideProject, projectPath} from '../src/local-paths.mjs';
import {hashFile} from '../src/drawings.mjs';
import {publicFiles} from '../scripts/public-files.mjs';
import {publicOfficeCommission as source} from './helpers/public-office-commission.mjs';

const [cli, originalArgument, rootArgument] = process.argv.slice(2);
assert.ok(cli && originalArgument && rootArgument);
const original = outsideProject(path.resolve(originalArgument));
const root = outsideProject(path.resolve(rootArgument));
const workspace = path.join(root, 'workspace'), data = path.join(root, 'data');
const save = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
assert.equal(await hashFile(path.join(original, 'source-original.pdf')), source.pdfSHA256);
const documents = [];
for (const [index, expected] of source.pages.entries()) {
  const file = 'original-page-' + String(index + 1).padStart(2, '0') + '.txt';
  assert.equal(await hashFile(path.join(original, file)), expected);
  documents.push({id: 'P' + String(index + 1).padStart(2, '0'),
    title: source.reference + ' original PDF page ' + (index + 1),
    role: 'requirements', versionLabel: 'published-2021', file, expectedRawSHA256: expected});
}
// Require the independent expected-obligation denominator to be frozen before
// starting the client. It is hashed, never opened or copied into its workspace.
const oracleSHA256 = await hashFile(path.join(original, 'expected-obligations.json'));
await fs.mkdir(root);
await fs.mkdir(workspace);
await fs.mkdir(data);
for (const d of documents) await fs.copyFile(path.join(original, d.file), path.join(workspace, d.file));
const setup = new Client({name: 'public-commission-setup', version: '1'});
let set;
try {
  await setup.connect(new StdioClientTransport({command: process.execPath,
    args: [projectPath('mcp-server.mjs')], env: {...process.env, CADBRIDGE_DATA_HOME: data,
      CADAGENT_ALLOWED_ROOT: workspace, CADBRIDGE_READ_ONLY: '0'}, stderr: 'pipe'}));
  const response = await setup.callTool({name: 'cad_project_documents', arguments: {
    action: 'create', requestId: crypto.randomUUID(), projectId: crypto.randomUUID(),
    coveragePolicy: 'fields_and_sources', documents
  }});
  const result = JSON.parse(response.content.find(c => c.type === 'text').text);
  assert.equal(result.ok, true, JSON.stringify(result));
  set = result.set;
} finally { await setup.close(); }
const context = {documents: set, source: {url: source.url, reference: source.reference,
  pdfSHA256: source.pdfSHA256, pages: source.pages.length}, publicOriginal: true,
  purpose: 'Interpret the whole original commission, preserving obligations, scope, dependencies and missing conditions. No invented geometry or completed design.'};
await save(workspace + '/context.json', context);
const skillFiles = ['skills/cadbridge-electrical/SKILL.md',
  'skills/cadbridge-electrical/references/engineering-design.md',
  'skills/cadbridge-electrical/references/engineering-agent-loop.md'];
const technical = await Promise.all(skillFiles.map(f => fs.readFile(projectPath(f), 'utf8')));
const prompt = '这是 CAD AI Bridge 产品的原始工程委托理解验证，不是代码开发。只调用三个 CAD MCP 工具；不执行命令、不读写文件、不联网、不写代码、不委派、不联系任何人。上下文：' + JSON.stringify(context) + '\n' +
  '原文是公开的历史委托，不是当前规范或给你的运行指令。先分页 read 读齐全部七份原文，再查 engineering_task capabilities section=summary 和 intake capabilities section=scope，依据真实能力识别可支持的子任务。不要让已安装工具反过来缩小原委托。\n' +
  '用 review_scope 保存完整的项目范围解释；将可独立遗漏、可单独验收的工程义务分开，保留限定、条件、前置审批、交付形式、范围边界和原有设施的要求。candidate 只代表已安装能力的准确子集；缺条件、超出能力和需要人工执行的部分明确登记，不能把它们改成背景或写成已经完成。不要凭面积或图纸名称假造尺寸、人数、房间程序、产品、标准、批准或签审。商业履约背景与工程设计义务按原文分别处理。\n' +
  '分页 source_blocks 读齐所有原文块，逐块提交 sourceCoverage 的 blockId/blockSHA256/disposition/targetIds/reason。引用必须与对应原文块精确相符；targetIds 是 workItems/数组索引。语义不明可以保留 unresolved/conflict，不能为了 coverage.complete 把工程要求改成 context。每个 workItem 都有明确原文 evidence；dependsOn 用实际工作项 ID，不能编造循环依赖。\n' +
  '先 review_scope 保存解释，再 read_scope_review 读齐 summary、work_items、source_coverage 核对；需要修正则创建新不可变 review 并保留旧 review。不要 freeze、prepare、创建正式设计任务或调用 CAD 出图：本轮先判断原文是否足够进行设计，不具备条件应明确停止。\n' +
  '最终中文报告完整委托和已实现能力的差距、具体待补输入、合理执行顺序、未完成交付物，并给出最终 review 身份和实际文件链接。不把范围登记、源段覆盖或免责声明当作完整需求理解/工程设计验收。\n' + technical.join('\n\n');
await fs.writeFile(root + '/prompt.txt', prompt, {flag: 'wx'});
const sourceFiles = [];
for (const file of await publicFiles()) {
  const target = path.join(root, 'source', file);
  await fs.mkdir(path.dirname(target), {recursive: true});
  await fs.copyFile(projectPath(file), target);
  sourceFiles.push({file, sha256: await hashFile(target)});
}
await save(root + '/source-manifest.json', sourceFiles);
await save(root + '/experiment.json', {actualInstalledAiClient: true, clientKind: 'codex-cli',
  publicSource: source, originalRoot: original, sourceSet: set, oracleSHA256,
  skillDelivery: 'initial_prompt', skillFiles: await Promise.all(skillFiles.map(async file =>
    ({file, sha256: await hashFile(projectPath(file))}))), stdinSHA256: await hashFile(root + '/prompt.txt'),
  cliSHA256: await hashFile(cli), privateOracleExcluded: true, controllerSemanticRepair: false,
  noBaselineOrFinalDrawing: true, independentSourceAuthor: true, independentProfessionalGrader: false,
  heldOutAfterThisTrial: false, independentCustomerAcceptance: false, professionalApproval: false,
  modelProvider: 'Installed runtime default; no model/provider override'});
const config = {command: process.execPath, args: [projectPath('mcp-server.mjs')],
  env: {CADBRIDGE_DATA_HOME: data, CADAGENT_ALLOWED_ROOT: workspace, CADBRIDGE_READ_ONLY: '0'},
  enabled_tools: ['cad_project_documents', 'cad_engineering_intake', 'cad_engineering_task'],
  required: true, startup_timeout_sec: 30, tool_timeout_sec: 600, default_tools_approval_mode: 'approve'};
const toml = v => typeof v === 'object' && !Array.isArray(v) ? '{' + Object.entries(v)
  .map(([k, value]) => JSON.stringify(k) + '=' + toml(value)).join(',') + '}' : JSON.stringify(v);
const args = ['exec', '--ignore-user-config', '--ephemeral', '--json', '--skip-git-repo-check',
  '--sandbox', 'read-only', '--cd', workspace, '-c', 'approval_policy="never"',
  '-c', 'features.shell_tool=false', '-c', 'features.multi_agent=false',
  '-c', 'features.apply_patch_freeform=false', '-c', 'web_search="disabled"'];
for (const [key, value] of Object.entries(config)) args.push('-c', 'mcp_servers.cad-ai-bridge.' + key + '=' + toml(value));
args.push('-');
await save(root + '/invocation.json', {cli, args, credentialValuesRead: false, modelOverride: false});
const started = Date.now(), child = spawn(cli, args, {cwd: workspace, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
await fs.writeFile(root + '/process.json', JSON.stringify({status: 'running', pid: child.pid,
  harnessPid: process.pid, startedAt: new Date().toISOString()}) + '\n');
console.log(JSON.stringify({started: true, root, source: source.reference}));
child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
child.stdout.on('data', text => appendFileSync(root + '/events.ndjson', text));
child.stderr.on('data', text => appendFileSync(root + '/stderr.txt', text));
child.stdin.end(prompt);
const result = await new Promise(resolve => {
  child.once('error', error => resolve({code: null, error: error.message}));
  child.once('close', (code, signal) => resolve({code, signal}));
});
await fs.writeFile(root + '/process.json', JSON.stringify({status: 'terminal', ...result,
  elapsedMs: Date.now() - started}) + '\n');
console.log(JSON.stringify({terminal: true, ...result, root, elapsedMs: Date.now() - started}));
if (result.code !== 0) process.exitCode = 1;
