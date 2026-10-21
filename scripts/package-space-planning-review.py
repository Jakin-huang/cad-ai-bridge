"""Private evidence archive, not a product/source release. Copies retained trials."""
import datetime, hashlib, json, pathlib, re, shutil, sys, zipfile
first, final, runs, repo = map(pathlib.Path, sys.argv[1:])
out = final / '第二设计包-证据包'
out.mkdir()
records, owned_jobs, scene_bytes, drawing_shas, windows = [], set(), set(), set(), []
def sha(data): return hashlib.sha256(data).hexdigest()
def copy(source, relative):
    target = out / relative
    if target.exists():
        assert target.read_bytes() == source.read_bytes()
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    data = target.read_bytes()
    assert sha(data) == sha(source.read_bytes())
    records.append({'file': target.relative_to(out).as_posix(), 'sha256': sha(data), 'bytes': len(data)})
def canonical(value): return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
for label, folder in [('retained-first-trial', first), ('final-trial', final)]:
    journal = json.loads((folder/'journal.json').read_text(encoding='utf-8'))
    calls = [json.loads(s) for s in (folder/'calls.ndjson').read_text(encoding='utf-8').splitlines()]
    windows.append((calls[0]['at'], calls[-1]['at']))
    for source in folder.iterdir():
        if source.is_file(): copy(source, pathlib.Path(label)/source.name)
    for source in (folder/'待审图册').iterdir():
        if source.is_file(): copy(source, pathlib.Path(label)/'待审图册'/source.name)
    for task in [journal['taskB'], journal['taskC']]:
        owned_jobs.update([task['jobId'], task['current']['jobId']])
    child = runs/journal['design1']['current']['jobId']
    state = json.loads((child/'space-planning.json').read_text(encoding='utf-8'))
    for step in state.get('nativeSteps', []):
        if step.get('jobRoot'): owned_jobs.add(pathlib.Path(step['jobRoot']).name)
    for revision in [0,1]:
        model = json.loads((child/f'model-{revision}.json').read_text(encoding='utf-8'))
        scene_bytes.add(canonical(model['scene']))
        delivery = journal[f'delivered{revision}']['current']['delivery']
        drawing_shas.add(delivery['drawingSHA256'])
        owned_jobs.add(pathlib.Path(delivery['verification']['scanJob']).name)
        for file in delivery['files']:
            source = pathlib.Path(file['file'])
            assert sha(source.read_bytes()) == file['sha256']
            owned_jobs.add(source.parent.name)
# Retrospectively bind intermediate create/apply jobs by both time scope and
# exact scene/final drawing digest. Do not collect unrelated jobs in the window.
for candidate in runs.iterdir():
    if not re.fullmatch(r'job-[A-Za-z0-9]{6}', candidate.name): continue
    try:
        task = json.loads((candidate/'task.json').read_text(encoding='utf-8-sig'))
        if not any(a <= task.get('startedAt','') <= b for a,b in windows): continue
        result = json.loads((candidate/'result.json').read_text(encoding='utf-8-sig'))
        request = json.loads((candidate/'request.json').read_text(encoding='utf-8-sig'))
        if result.get('drawingSha256') in drawing_shas or result.get('inputSha256') in drawing_shas or ('scene' in request and canonical(request['scene']) in scene_bytes): owned_jobs.add(candidate.name)
    except (FileNotFoundError, ValueError): continue
for name in sorted(owned_jobs):
    source = runs/name
    assert source.is_dir() and source.resolve().parent == runs.resolve(), name
    for file in source.rglob('*'):
        if file.is_file():
            assert not file.is_symlink()
            copy(file, pathlib.Path('owned-runs')/name/file.relative_to(source))
for source in (repo/'src').iterdir():
    if re.match(r'(space-planning-|planning-|scene-capture-)', source.name): copy(source, pathlib.Path('source-snapshot/src')/source.name)
for relative in ['src/engineering-task-adapters.mjs','src/capabilities.mjs','mcp-server.mjs','tests/helpers/space-input.mjs','tests/unit/space-planning.test.mjs','tests/space-planning-integration.mjs','scripts/audit-space-planning-evidence.mjs','scripts/review-space-planning-pdfs.py','scripts/package-space-planning-review.py']:
    copy(repo/relative, pathlib.Path('source-snapshot')/relative)
manifest = {'schemaVersion': 1, 'baseCommit': '427a54a', 'productRelease': False, 'professionalApproval': False, 'knownDeveloperCases': True, 'ownedRuns': sorted(owned_jobs), 'files': sorted(records, key=lambda r:r['file'])}
(out/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
target = final/'第二设计包-证据包.zip'
with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for file in sorted(out.rglob('*')):
        if file.is_file(): archive.write(file, file.relative_to(out).as_posix())
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
    assert len(archive.namelist()) == len(records)+1
    for record in records: assert sha(archive.read(record['file'])) == record['sha256']
report = {'ok': True, 'file': str(target), 'sha256': sha(target.read_bytes()), 'manifestEntries': len(records), 'zipEntries': len(records)+1, 'ownedRuns': len(owned_jobs), 'crcAndAllHashesVerified': True, 'productRelease': False}
(final/'证据包-打包核对.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
