"""Independent read-only original-inventory / CSV / review-PDF checks."""
import csv
import hashlib
import json
from pathlib import Path
import re
import sys
import pypdf

root = Path(sys.argv[1])
read = lambda f: json.loads(f.read_text(encoding='utf-8-sig'))
sha = lambda f: hashlib.sha256(f.read_bytes()).hexdigest()
compact = lambda s: re.sub(r'\s+', '', s)
audit_name = sys.argv[2] if len(sys.argv) > 2 else 'independent-audit.json'
assert Path(audit_name).name == audit_name and audit_name.endswith('.json')
audit = read(root / audit_name)
assert audit['finalEngineeringStatePassed']
directory = root / 'data' / 'runs' / audit['jobId']
state = read(directory / 'space-planning.json')
model = read(directory / f"model-{state['revision']}.json")
expected = model['input']['assets']
actual = {a['id']: a for r in model['plan']['rooms'] for a in r.get('assets', [])}
csv_file = directory / f"assets-{state['revision']}.csv"
receipt = next(f for f in state['delivery']['files'] if f['file'] == str(csv_file))
assert sha(csv_file) == receipt['sha256']
with csv_file.open(encoding='utf-8-sig', newline='') as stream:
    rows = list(csv.DictReader(stream))
assert len(rows) == len(expected) and len({r['assetId'] for r in rows}) == len(expected)
for a in expected:
    row = next(r for r in rows if r['assetId'] == a['id'])
    g = actual[a['id']]
    assert row['name'] == a['name'] and row['spaceId'] == a['roomId']
    assert float(row['widthMm']) == a['widthMm'] and float(row['depthMm']) == a['depthMm']
    assert [float(row['xMm']), float(row['yMm'])] == g['position']
    assert int(row['orientationDegrees']) == g['orientationDegrees']
    assert row['fixed'] == str('fixed' in a).lower()
    assert row['evidenceStatus'] == a['status'] and row['sourceIds'] == '|'.join(a['sourceIds'])
    assert row['inputSHA256'] == model['inputSHA256']
    for side in ['frontMm', 'backMm', 'leftMm', 'rightMm']:
        assert float(row[side]) == a['clearances'][side]
    assert float(row['minFrontAccessMm']) == a['minFrontAccessMm']
    if 'fixed' in a:
        assert g['position'] == a['fixed']['position'] and g['orientationDegrees'] == a['fixed']['orientationDegrees']
texts = {}
for page in read(root / 'independent-pdf-check.json')['pages']:
    file = Path(page['file'])
    assert sha(file) == page['sha256']
    pdf = pypdf.PdfReader(file, strict=True)
    assert len(pdf.pages) == 1
    texts[page['sheet']] = compact(pdf.pages[0].extract_text())
table = ''.join(t for k, t in texts.items() if k.startswith('SP06'))
for index, a in enumerate(expected, 1):
    g = actual[a['id']]
    assert compact(a['name'] + ' [' + a['id'] + '] / ' + a['roomId']) in table
    assert compact(f"{a['widthMm']} x {a['depthMm']} | {g['orientationDegrees']}deg | {str(g['fixed']).lower()} | {a['clearances']['frontMm']} / {a['minFrontAccessMm']}") in table
    for sheet in ['SP02', 'SP03']:
        assert 'Q' + str(index).zfill(2) in texts[sheet]
result = {'ok': True, 'scope': 'Declared inventory, retained coordinates, CSV and review-PDF table/code preservation only; native geometric and visual checks separate',
          'inputSHA256': model['inputSHA256'], 'modelSHA256': state['modelSHA256'],
          'assets': len(expected), 'fixedAssets': sum('fixed' in a for a in expected),
          'csvSHA256': sha(csv_file), 'allOriginalAssetGradesRetained': True,
          'wholeClientTrialPassed': audit['wholeClientTrialPassed'], 'professionalApproval': False}
with (root / 'independent-assets-check.json').open('x', encoding='utf-8') as stream:
    stream.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(result))
