"""Archive this bounded synthetic intake increment; preserve earlier verdicts."""
import hashlib, json, pathlib, sys, zipfile

root = pathlib.Path(sys.argv[1]).resolve()
trials = [pathlib.Path(p).resolve() for p in sys.argv[2:]]
assert len(trials) == 2 and len(set([root, *trials])) == 3
target = root / '冻结条件意图草稿-完整试验证据.zip'
assert not target.exists()
for trial in trials:
    experiment = json.loads((trial/'experiment.json').read_text(encoding='utf-8'))
    assert experiment['syntheticNonPrivate'] and experiment['oracleExcluded']
    assert not experiment['controllerSemanticRepair']
    assert json.loads((trial/'process.json').read_text(encoding='utf-8'))['status'] == 'terminal'
    assert (trial/'independent-audit-final.json').is_file()

entries = []
for base, prefix in [(root, 'validation'), *[(p, 'trials/'+p.name) for p in trials]]:
    assert not base.is_symlink()
    for file in sorted(base.rglob('*')):
        assert not file.is_symlink(), file
        if file.is_dir():
            continue
        if base == root and file.name in [target.name, 'archive-verification.json', 'post-commit-check.json']:
            continue
        assert not file.name.endswith('.lock'), file
        entries.append((prefix+'/'+file.relative_to(base).as_posix(), file))
assert len({name for name, _ in entries}) == len(entries)
manifest = {'schemaVersion': 1, 'syntheticNonPrivate': True, 'productRelease': False,
            'goalComplete': False, 'professionalApproval': False,
            'scope': 'Exact two client trial directories, including failed verifier report, plus this increment validation/source snapshot. Earlier failed trials and native outputs remain referenced unchanged.',
            'files': [{'path': name, 'bytes': file.stat().st_size,
                       'sha256': hashlib.sha256(file.read_bytes()).hexdigest()} for name, file in entries]}
encoded = (json.dumps(manifest, ensure_ascii=False, indent=2)+'\n').encode('utf-8')
with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for name, file in entries:
        archive.write(file, name)
    archive.writestr('MANIFEST.json', encoded)
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
    assert len(archive.namelist()) == len(entries)+1
    assert archive.read('MANIFEST.json') == encoded
    for item in manifest['files']:
        assert hashlib.sha256(archive.read(item['path'])).hexdigest() == item['sha256'], item['path']
report = {'ok': True, 'file': str(target), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
          'manifestEntries': len(entries), 'zipEntries': len(entries)+1,
          'crcAndAllHashesVerified': True, 'productRelease': False, 'goalComplete': False}
(root/'archive-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
