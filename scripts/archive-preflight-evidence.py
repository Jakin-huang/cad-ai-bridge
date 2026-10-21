"""Preserve successful and failed local replay variants; not a release package."""
import hashlib, json, pathlib, sys, zipfile

root = pathlib.Path(sys.argv[1]).resolve()
variants = [pathlib.Path(p).resolve() for p in sys.argv[2:]]
assert len(variants) >= 8 and len(set([root, *variants])) == len(variants)+1
target = root/'预检响应与数值守恒-完整试验证据.zip'
assert not target.exists()
for base in variants:
    process = base/'process.json'
    if process.exists():
        assert json.loads(process.read_text(encoding='utf-8'))['status'] == 'terminal'
entries = []
for base, prefix in [(root, 'validation'), *[(p, 'diagnostics/'+p.name) for p in variants]]:
    assert not base.is_symlink()
    for file in sorted(base.rglob('*')):
        assert not file.is_symlink(), file
        if file.is_dir():
            continue
        if base == root and file.name in [target.name, 'archive-verification.json', 'post-commit-check.json']:
            continue
        assert not file.name.endswith('.lock'), file
        entries.append((prefix+'/'+file.relative_to(base).as_posix(), file))
assert len(entries) == len({name for name, _ in entries})
manifest = {'schemaVersion': 1, 'productRelease': False, 'goalComplete': False,
            'professionalApproval': False, 'newNativeCadExecuted': False,
            'scope': 'Exact listed known synthetic ranking diagnostics, including initial failed probe and failed overhead audit, original unchanged reference snapshot and final source/regressions. No global user-file scan.',
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
