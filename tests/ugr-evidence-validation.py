"""Local importer fault checks on an operator-supplied private manifest, no assets bundled."""
import copy
import hashlib
import json
import subprocess
import sys
from pathlib import Path

manifest, destination = Path(sys.argv[1]), Path(sys.argv[2])
destination.mkdir()
original = json.loads(manifest.read_text(encoding='utf8'))
script = Path(__file__).resolve().parents[1] / 'scripts' / 'import-ugr-evidence.py'
checks = []

def run(name, mutate, code, wrong_digest=False, exists=False):
    data = copy.deepcopy(original)
    mutate(data)
    source, out = destination / (name+'.json'), destination / (name+'-profile.json')
    source.write_text(json.dumps(data, ensure_ascii=False), encoding='utf8')
    expected = '0'*64 if wrong_digest else hashlib.sha256(source.read_bytes()).hexdigest()
    if exists:
        out.write_text('Existing file retained', encoding='utf8')
    result = subprocess.run([sys.executable, '-O', str(script), str(source), expected, str(out)], capture_output=True, text=True, encoding='utf8')
    if code:
        if result.returncode == 0 or code not in result.stderr:
            raise ValueError(name+': '+result.stdout+result.stderr)
        if not exists and out.exists():
            raise ValueError('Partial profile created on failure')
    elif result.returncode != 0:
        raise ValueError(result.stderr)
    checks.append(name)

run('manifest', lambda d: None, 'UGR_MANIFEST_CHANGED', wrong_digest=True)
run('source', lambda d: d['source'].update(sha256='0'*64), 'UGR_SOURCE_CHANGED')
run('pixels', lambda d: d['witnesses'][0].update(pixelSHA256='0'*64), 'UGR_PAGE_WITNESS_CHANGED')
run('crosscheck', lambda d: d['witnesses'][0].update(crossCheckSHA256='0'*64), 'UGR_CROSSCHECK_CHANGED')
run('matrix', lambda d: d['positionIndex']['values'].pop(), 'UGR_TABLE_DIMENSIONS')
run('axes', lambda d: d['positionIndex']['lateralRatios'].__setitem__(1, 0), 'UGR_TABLE_AXES')
run('values', lambda d: d['positionIndex']['values'][0].__setitem__(0, float('nan')), 'UGR_TABLE_VALUES')
run('limits', lambda d: d['limits'].update(referenceWorkplaneM=0), 'UGR_LIMITS')
run('coverage', lambda d: d['witnesses'].pop(), 'UGR_WITNESS_COVERAGE')
run('existing', lambda d: None, 'UGR_PROFILE_EXISTS', exists=True)
run('valid', lambda d: None, None)
report = dict(ok=True, checks=checks, optimizationFlag='-O', scope='Integrity and fail-closed import, not table transcription certification')
(destination/'validation.json').write_text(json.dumps(report, indent=2), encoding='utf8')
print(json.dumps(report))
