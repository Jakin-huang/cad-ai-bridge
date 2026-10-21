"""Archive five owned development trials; never a product release."""
import hashlib, json, pathlib, re, shutil, sys, zipfile
repo, runs, *folders = [pathlib.Path(p).resolve() for p in sys.argv[1:]]
assert len(folders) == 5
final = folders[-1]
out = final/'空间与照明联动-证据包'
attempt=1
while out.exists():
    attempt+=1
    out=final/f'空间与照明联动-证据包-attempt-{attempt}'
out.mkdir()
records, jobs, scenes, drawing_shas, windows = [], set(), set(), set(), []
def canonical(value): return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def sha(data): return hashlib.sha256(data).hexdigest()
def copy(source, relative):
    assert source.is_file() and not source.is_symlink()
    target = out/relative
    if target.exists():
        assert target.read_bytes() == source.read_bytes()
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    content = target.read_bytes()
    assert sha(content) == sha(source.read_bytes())
    records.append({'file':target.relative_to(out).as_posix(),'sha256':sha(content),'bytes':len(content)})
def owned_references(value):
    if isinstance(value, dict):
        for child in value.values(): owned_references(child)
    elif isinstance(value, list):
        for child in value: owned_references(child)
    elif isinstance(value, str):
        if re.fullmatch(r'job-(?:task-|spaceplan-|design-)?[A-Za-z0-9-]+', value):
            if (runs/value).is_dir(): jobs.add(value)
        try:
            rel = pathlib.Path(value).relative_to(runs)
            if rel.parts and (runs/rel.parts[0]).is_dir(): jobs.add(rel.parts[0])
        except ValueError: pass
for index, folder in enumerate(folders):
    journal = json.loads((folder/'journal.json').read_text(encoding='utf-8'))
    owned_references(journal)
    calls=[json.loads(line) for line in (folder/'calls.ndjson').read_text(encoding='utf-8').splitlines()]
    windows.append((calls[0]['at'],calls[-1]['at']))
    for file in folder.iterdir():
        if file.is_file() and file.suffix in ['.json','.ndjson']: copy(file,pathlib.Path(f'trial-{index+1}')/file.name)
    booklet = folder/'待审图册'
    if booklet.exists():
        for file in booklet.iterdir():
            if file.is_file(): copy(file,pathlib.Path(f'trial-{index+1}')/'待审图册'/file.name)
    for discipline, statefile in [('space','space-planning.json'),('lighting','project.json')]:
        task = journal.get(discipline+'Task')
        if not task: continue
        child = runs/task['current']['jobId']
        for revision in [0,1]:
            model_file=child/f'model-{revision}.json'
            if model_file.exists(): scenes.add(canonical(json.loads(model_file.read_text(encoding='utf-8'))['scene']))
            layout=child/f'delivery-layout-scene-{revision}.json'
            if layout.exists(): scenes.add(canonical(json.loads(layout.read_text(encoding='utf-8'))))
            delivery=journal.get(discipline+'Deliver'+str(revision),{}).get('current',{}).get('delivery')
            if delivery: drawing_shas.add(delivery['drawingSHA256'])
        candidate = child/statefile
        if not candidate.exists() and discipline=='lighting': candidate=child/'engineering.json'
        if candidate.exists():
            state=json.loads(candidate.read_text(encoding='utf-8'))
            owned_references(state.get('nativeSteps',[]))
# Bind old intermediate jobs by a trial time window AND exact actual scene or
# final drawing digest; current nativeSteps alone omits previous revisions.
for candidate in runs.iterdir():
    if not re.fullmatch(r'job-[A-Za-z0-9]{6}',candidate.name): continue
    try:
        task=json.loads((candidate/'task.json').read_text(encoding='utf-8-sig'))
        if not any(a<=task.get('startedAt','')<=b for a,b in windows): continue
        result=json.loads((candidate/'result.json').read_text(encoding='utf-8-sig'))
        request=json.loads((candidate/'request.json').read_text(encoding='utf-8-sig'))
        if result.get('drawingSha256') in drawing_shas or result.get('inputSha256') in drawing_shas or ('scene' in request and canonical(request['scene']) in scenes): jobs.add(candidate.name)
    except (FileNotFoundError,ValueError): continue
for name in sorted(jobs):
    source=runs/name
    assert source.resolve().parent == runs.resolve(), name
    for file in source.rglob('*'):
        if file.is_file(): copy(file,pathlib.Path('owned-runs')/name/file.relative_to(source))
for directory in ['src','tests','scripts','skills/cadbridge-electrical/references']:
    for file in (repo/directory).rglob('*'):
        if file.is_file() and file.suffix in ['.mjs','.py','.md']: copy(file,pathlib.Path('source-snapshot')/file.relative_to(repo))
for relative in ['README.md','mcp-server.mjs','package.json','package-lock.json','docs/engineering-tasks.md','docs/task-portability.md','docs/engineering-design-plan.md','docs/engineering-design-progress.json','docs/shared-space-coordination-validation.json']:
    copy(repo/relative,pathlib.Path('source-snapshot')/relative)
for name in ['shared-space-final-regression.log','shared-space-static.log']:
    copy(repo.parent/name,pathlib.Path('checks')/name)
manifest={'schemaVersion':1,'baseCommit':'aa38a19','productRelease':False,'professionalApproval':False,'knownDeveloperCases':True,'archiveAttempt':attempt,'ownedRuns':sorted(jobs),'files':sorted(records,key=lambda r:r['file'])}
(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
target=final/'空间与照明联动-证据包.zip'
with zipfile.ZipFile(target,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for file in sorted(out.rglob('*')):
        if file.is_file(): z.write(file,file.relative_to(out).as_posix())
with zipfile.ZipFile(target) as z:
    assert z.testzip() is None
    assert len(z.namelist())==len(records)+1
    for r in records: assert sha(z.read(r['file']))==r['sha256']
report={'ok':True,'file':str(target),'sha256':sha(target.read_bytes()),'manifestEntries':len(records),'zipEntries':len(records)+1,'ownedRuns':len(jobs),'crcAndAllHashesVerified':True,'productRelease':False}
(final/'证据包-打包核对.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
