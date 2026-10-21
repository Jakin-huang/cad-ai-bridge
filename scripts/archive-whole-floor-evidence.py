"""Archive an explicit terminal study selection, including retained failed trials.

The caller must establish process termination separately. No global run discovery,
CAD calls, source-data edits or release packaging occur here.
"""
import hashlib
import json
import pathlib
import re
import sys
import zipfile

selection_file, runs = [pathlib.Path(value).resolve() for value in sys.argv[1:]]
selection = json.loads(selection_file.read_text(encoding='utf-8'))
destination = selection_file.parent
base = pathlib.Path(selection.get('evidenceRoot', destination)).resolve()
assert base.is_dir() and destination.is_relative_to(base)
assert selection['syntheticNonPrivateExperiment'] is True
assert selection['allSelectedTrialsTerminal'] is True
assert selection['professionalApproval'] is False
assert selection['productRelease'] is False
assert len(selection['cases']) == len(set(selection['cases']))
assert len(selection['runIds']) == len(set(selection['runIds']))
target = destination / '整层光度布局改进-完整试验证据.zip'
verification = destination / 'archive-verification.json'
assert not target.exists() and not verification.exists()
sha = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()
entries = []


def collect(directory, prefix):
    assert directory.is_dir() and not directory.is_symlink(), directory
    for file in sorted(directory.rglob('*')):
        assert not file.is_symlink(), file
        if file.is_file():
            entries.append((prefix + '/' + file.relative_to(directory).as_posix(), file))


entries.append(('selection.json', selection_file))
for relative in selection['cases']:
    assert not pathlib.Path(relative).is_absolute()
    assert not (base / relative).is_symlink()
    directory = (base / relative).resolve()
    assert directory.is_relative_to(base)
    assert directory != base
    assert not target.is_relative_to(directory), 'Archive destination cannot be inside a selected source case'
    collect(directory, 'cases/' + directory.relative_to(base).as_posix())
for name in selection['runIds']:
    assert re.fullmatch(r'job-[A-Za-z0-9_-]+', name), name
    directory = runs / name
    assert not (directory / 'engineering.lock').exists(), directory
    collect(directory, 'runs/' + name)
for relative in selection.get('supportFiles', []):
    assert not pathlib.Path(relative).is_absolute()
    assert not (base / relative).is_symlink()
    file = (base / relative).resolve()
    assert file.is_relative_to(base) and file.is_file()
    assert file not in [target, verification, selection_file]
    entries.append(('support/' + file.relative_to(base).as_posix(), file))
assert len(entries) == len({name for name, _ in entries})
manifest = {
    'schemaVersion': 1,
    'syntheticNonPrivateExperiment': True,
    'professionalApproval': False,
    'productRelease': False,
    'runSelection': 'Only explicit case folders, support files and run IDs in selection.json; no global run scan',
    'files': [{'path': name, 'bytes': file.stat().st_size, 'sha256': sha(file)} for name, file in entries],
}
encoded = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for (name, file), item in zip(entries, manifest['files']):
        assert sha(file) == item['sha256'], ('Changed before archiving', file)
        archive.write(file, name)
    archive.writestr('MANIFEST.json', encoded)
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
    assert len(archive.namelist()) == len(entries) + 1
    assert archive.read('MANIFEST.json') == encoded
    for (name, file), item in zip(entries, manifest['files']):
        assert hashlib.sha256(archive.read(name)).hexdigest() == item['sha256'], name
        assert sha(file) == item['sha256'], ('Source changed while archiving', file)
report = {
    'ok': True, 'productRelease': False, 'professionalApproval': False,
    'file': str(target), 'sha256': sha(target), 'manifestEntries': len(entries),
    'zipEntries': len(entries) + 1, 'selectedRuns': len(selection['runIds']),
    'crcAndAllHashesVerified': True,
    'processScope': 'Caller-confirmed terminal selection; the archiver does not certify process ownership or termination',
}
verification.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
