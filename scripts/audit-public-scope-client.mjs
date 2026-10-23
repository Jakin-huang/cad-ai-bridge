// Read-only reconstruction of source/trace/protocol facts. Quote overlap is
// deliberately not a semantic grade; the frozen obligations need human review.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {hashFile} from '../src/drawings.mjs';
import {dependencyDigest as digest} from '../src/task-dependencies.mjs';
import {loadDocumentSet, documentSetSourceBlocks, readDocumentText} from '../src/project-document-store.mjs';
import {checkSourceCoverage} from '../src/document-source-coverage.mjs';
import {loadScopeReview, reviewScopeSchema} from '../src/engineering-scope-intake.mjs';
import {parseTrace, normalizeClientEvents, clientTraceErrors, clientToolPayload} from '../tests/helpers/client-trace.mjs';
import {publicOfficeCommission as source} from '../tests/helpers/public-office-commission.mjs';

const root = path.resolve(process.argv[2] || '');
assert.ok(process.argv[2]);
const read = async f => JSON.parse(await fs.readFile(f, 'utf8'));
const report = {ok: false, actualInstalledAiClient: true, checks: [], errors: [],
  sourceAuthorIndependent: true, independentProfessionalGrader: false,
  semanticCoverageAccepted: false, independentProjectAcceptance: false,
  professionalApproval: false, nativeCadExecuted: false};
const check = (name, passed) => {report.checks.push({name, passed: !!passed}); if (!passed) report.errors.push(name);};
try {
  const e = await read(root + '/experiment.json'), process = await read(root + '/process.json');
  assert.equal(process.status, 'terminal');
  assert.equal(e.publicSource.pdfSHA256, source.pdfSHA256);
  assert.equal(await hashFile(path.join(e.originalRoot, 'source-original.pdf')), source.pdfSHA256);
  assert.equal(await hashFile(path.join(e.originalRoot, 'expected-obligations.json')), e.oracleSHA256);
  const oracle = await read(path.join(e.originalRoot, 'expected-obligations.json'));
  // Invocation is created after the harness has verified and pinned the oracle,
  // immediately before spawn. Its recorded filesystem creation is additional
  // local ordering evidence; it is not an external timestamp attestation.
  check('Expected obligations frozen before actual client invocation',
    Date.parse(oracle.frozenAt) < (await fs.stat(root + '/invocation.json')).birthtimeMs);
  const raw = parseTrace(await fs.readFile(root + '/events.ndjson', 'utf8'));
  const events = normalizeClientEvents(raw), calls = events.filter(e => e.type === 'function_call');
  const args = c => typeof c.arguments === 'string' ? JSON.parse(c.arguments) : c.arguments;
  const response = c => clientToolPayload(events.find(r => r.type === 'function_call_result' && r.callId === c.callId));
  report.protocolErrors = clientTraceErrors(raw);
  report.process = process; report.calls = calls.length;
  report.traceSHA256 = await hashFile(root + '/events.ndjson');
  check('Actual client terminal success', process.code === 0 && events.findLast(e => e.type === 'result')?.subtype === 'success');
  check('No client/transport/Bridge tool errors', report.protocolErrors.length === 0);
  check('Only source reads, capabilities and immutable scope review actions', calls.every(c =>
    c.name === 'mcp__cad-ai-bridge__cad_project_documents' && ['read', 'source_blocks'].includes(args(c).action) ||
    c.name === 'mcp__cad-ai-bridge__cad_engineering_task' && args(c).action === 'capabilities' ||
    c.name === 'mcp__cad-ai-bridge__cad_engineering_intake' && ['capabilities', 'review_scope', 'read_scope_review'].includes(args(c).action)));
  const workspaceFiles = (await fs.readdir(root + '/workspace')).sort();
  check('No baseline, final drawing, oracle or grading annotations in client workspace',
    JSON.stringify(workspaceFiles) === JSON.stringify(['context.json', ...source.pages.map((_, i) => 'original-page-' + String(i + 1).padStart(2, '0') + '.txt')].sort()));
  const prompt = await fs.readFile(root + '/prompt.txt', 'utf8');
  check('Pinned public Skill supplied verbatim without oracle', await hashFile(root + '/prompt.txt') === e.stdinSHA256 &&
    !prompt.includes(oracle.obligations[0].criterion) && !prompt.includes(e.oracleSHA256));
  for (const f of e.skillFiles) check('Technical reference bytes ' + f.file,
    await hashFile(path.join(root, 'source', f.file)) === f.sha256 && prompt.includes(await fs.readFile(path.join(root, 'source', f.file), 'utf8')));
  const runs = root + '/data/runs', documents = await loadDocumentSet(runs, e.sourceSet, {requireCurrent: true});
  check('Only seven pinned original pages, no evaluation data in source set', documents.version.documents.length === 7 &&
    documents.version.documents.every((d, i) => d.id === 'P' + String(i + 1).padStart(2, '0') && d.role === 'requirements' && d.rawSHA256 === source.pages[i]));
  for (const d of documents.version.documents) {
    const {text} = await readDocumentText(documents, d.id), readCalls = calls.filter(c =>
      c.name.endsWith('cad_project_documents') && args(c).action === 'read' && args(c).documentId === d.id);
    const seen = new Set(); let end = false;
    for (const c of readCalls) {const r = response(c); if (!r?.ok) continue;
      for (const item of r.items) for (let n = item.start; n < item.end; n++) seen.add(n);
      if (r.nextOffset === null) end = true;}
    check('Actual client reads entire original ' + d.id, end && seen.size === text.length);
  }
  const blocks = await documentSetSourceBlocks(documents), reviews = [];
  for (const c of calls.filter(c => c.name.endsWith('cad_engineering_intake') && args(c).action === 'review_scope')) {
    const result = response(c); if (!result?.ok) continue;
    const q = reviewScopeSchema.parse(args(c)), record = await loadScopeReview(runs, result.review);
    check('Exact immutable scope request ' + record.jobId, record.requestSHA256 === digest(q));
    const decisions = [];
    for (const [index, item] of record.workItems.entries()) {
      const submitted = q.workItems[index], {evidence, ...value} = submitted;
      check('Actual caller owns scope item ' + item.id, Object.entries(value).every(([k, v]) => digest(v) === digest(item[k])) &&
        item.citations.length === evidence.length && item.citations.every((cit, i) => cit.documentId === evidence[i].documentId && cit.quote === evidence[i].quote));
      for (const citation of item.citations) {const {document, text} = await readDocumentText(documents, citation.documentId);
        assert.equal(citation.textSHA256, document.textSHA256); assert.ok(text.includes(citation.quote));}
      decisions.push({targetIds: ['workItems/' + index], disposition: ['unresolved', 'conflict'].includes(item.disposition) ? item.disposition : 'supported', citations: item.citations});
    }
    const coverage = checkSourceCoverage(blocks, record.workItems.map((value, i) => ({id: 'workItems/' + i, value})), decisions, q.sourceCoverage, {required: true});
    check('Independently reconstruct source coverage ' + record.jobId, digest(coverage) === digest(record.sourceCoverage));
    reviews.push({ref: result.review, record});
  }
  check('At least one actual immutable scope interpretation retained', reviews.length > 0);
  const final = reviews.at(-1); assert.ok(final);
  report.finalReview = final.ref;
  for (const section of ['summary', 'work_items', 'source_coverage']) {
    const seen = new Set(); let end = false;
    for (const c of calls.filter(c => c.name.endsWith('cad_engineering_intake') && args(c).action === 'read_scope_review' &&
      args(c).section === section && digest(args(c).review) === digest(final.ref))) {
      const r = response(c); if (!r?.ok) continue;
      if (section === 'summary') {end = true; seen.add(0);} else {
        for (let n = 0; n < r.items.length; n++) seen.add(r.offset + n);
        if (r.nextOffset === null) end = true;}
    }
    check('Client reads final complete ' + section, end && seen.size === (section === 'summary' ? 1 :
      section === 'work_items' ? final.record.workItems.length : final.record.sourceCoverage.entries.length));
  }
  report.sourceCoverage = final.record.sourceCoverage.summary;
  report.workItems = final.record.workItems.map(({id, description, disposition, taskKind, reason, dependsOn}) => ({id, description, disposition, taskKind, reason, dependsOn}));
  report.quoteOverlapCandidates = oracle.obligations.map(o => ({id: o.id,
    candidateWorkItemIds: final.record.workItems.filter(w => w.citations.some(c => c.documentId === o.documentId &&
      (c.quote.includes(o.quote) || o.quote.includes(c.quote)))).map(w => w.id),
    semanticGrade: 'not_determined_by_quote_overlap'}));
  report.finalMessage = events.findLast(e => e.type === 'result')?.result;
  report.oracleSHA256 = e.oracleSHA256;
  report.obligationDenominator = oracle.obligations.length;
  report.ok = report.errors.length === 0;
} catch (error) {report.error = error.stack; report.errors.push(error.message);}
await fs.writeFile(root + '/independent-protocol-audit.json', JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({ok: report.ok, calls: report.calls, checks: report.checks.length,
  protocolErrors: report.protocolErrors?.length, sourceCoverage: report.sourceCoverage,
  finalReview: report.finalReview, errors: report.errors, semanticCoverageAccepted: false}));
