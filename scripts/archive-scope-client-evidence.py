"""Archive only this synthetic experiment and explicitly referenced run folders."""
import hashlib, json, pathlib, re, sys, zipfile
root, runs = [pathlib.Path(p).resolve() for p in sys.argv[1:]]
target = root/'真实客户端范围修订-证据包.zip'
assert not target.exists()
traces = root/'client-traces'
for process in traces.glob('*/process.json'):
    assert json.loads(process.read_text(encoding='utf-8'))['status']=='terminal', process
references = [root/'setup-journal.json', root/'setup-calls.ndjson', root/'native-positive'/'journal.json', root/'native-positive'/'calls.ndjson', *traces.glob('*/events.ndjson')]
ids = set()
for file in references:
    text = file.read_text(encoding='utf-8')
    ids.update(re.findall(r'\bjob-[A-Za-z0-9_-]+\b',text))
owned = sorted(name for name in ids if (runs/name).is_dir())
assert len(owned)>=10
entries = []
def collect(base, prefix):
    for file in sorted(base.rglob('*')):
        assert not file.is_symlink(), file
        if file.is_dir():
            continue
        relative = file.relative_to(base).as_posix()
        if base==root and relative in [target.name,'archive-verification.json']:
            continue
        assert file!=target
        entries.append((prefix+'/'+relative,file))
collect(root,'experiment')
for name in owned:
    assert not (runs/name/'engineering.lock').exists(), name
    collect(runs/name,'runs/'+name)
manifest = {'schemaVersion':1,'syntheticNonPrivateExperiment':True,'professionalApproval':False,'productRelease':False,'ownedRuns':owned,'runSelection':'Only existing run IDs explicitly referenced by this experiment setup and actual trace/native logs; no global runs scan','files':[{'path':name,'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()} for name,file in entries]}
encoded = (json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode('utf-8')
with zipfile.ZipFile(target,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
    for name,file in entries:
        archive.write(file,name)
    archive.writestr('MANIFEST.json',encoded)
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
    assert len(archive.namelist())==len(entries)+1
    assert archive.read('MANIFEST.json')==encoded
    for item in manifest['files']:
        assert hashlib.sha256(archive.read(item['path'])).hexdigest()==item['sha256'],item['path']
report={'ok':True,'productRelease':False,'file':str(target),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'manifestEntries':len(entries),'zipEntries':len(entries)+1,'ownedRuns':len(owned),'crcAndAllHashesVerified':True}
(root/'archive-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
