"""Read-only independent input-history -> amendment JSON/CSV/PDF verification."""
import csv
import hashlib
import json
from pathlib import Path
import re
import sys
import pypdf

root, runs = Path(sys.argv[1]), Path(sys.argv[2])
read = lambda f: json.loads(f.read_text(encoding='utf-8-sig'))
sha = lambda f: hashlib.sha256(f.read_bytes()).hexdigest()
compact = lambda s: re.sub(r'\s+', '', s)
audit = read(root / 'independent-audit.json')
assert audit['finalEngineeringStatePassed']
directory = runs / audit['jobId']
state = read(directory / 'space-planning.json')
model = read(directory / f"model-{state['revision']}.json")
report = model['assetChanges']
assert model['sceneVersion'] >= 8 and report['inputSHA256'] == model['inputSHA256']
assert not report['professionalApproval'] and not report['sourceAuthorityVerified']
report_file = directory / f"asset-changes-{state['revision']}.json"
csv_file = directory / f"asset-changes-{state['revision']}.csv"
assert read(report_file) == report
for file in [report_file, csv_file]:
    assert sha(file) == next(f['sha256'] for f in state['delivery']['files'] if Path(f['file']) == file)
with csv_file.open(encoding='utf-8-sig', newline='') as stream:
    csv_rows = list(csv.DictReader(stream))

def physical(a):
    return {k: v for k, v in (a or {}).items() if k not in ['sourceIds', 'evidenceQuote']}

def flattened(v, prefix=''):
    if isinstance(v, (dict, list)):
        out = {}
        iterator = v.items() if isinstance(v, dict) else enumerate(v)
        for k, child in iterator:
            field = f'{prefix}[{k}]' if isinstance(v, list) else f'{prefix}.{k}' if prefix else str(k)
            out.update(flattened(child, field))
        return out
    return {prefix: v}

text = ''
pages = read(root / 'independent-pdf-check.json')['pages']
for page in pages:
    if page['sheet'].startswith('SP07'):
        file = Path(page['file'])
        assert sha(file) == page['sha256']
        text += pypdf.PdfReader(file, strict=True).pages[0].extract_text()
assert text
text = compact(text)
labels = {'widthMm': '宽度(mm)', 'depthMm': '深度(mm)', 'roomId': '所属空间', 'name': '名称', 'status': '依据等级', 'fixed.position[0]': '固定X(mm)', 'fixed.position[1]': '固定Y(mm)', 'fixed.orientationDegrees': '固定朝向(度)', 'clearances.frontMm': '正面净空(mm)', 'clearances.backMm': '背面净空(mm)', 'clearances.leftMm': '左侧净空(mm)', 'clearances.rightMm': '右侧净空(mm)', 'minFrontAccessMm': '正面接触宽度(mm)'}
display = lambda v: v if isinstance(v, str) else json.dumps(v, ensure_ascii=False, separators=(',', ':'))
count = 0
for revision in report['revisions']:
    before = read(directory / f"input-{revision['fromRevision']}.json")
    after = read(directory / f"input-{revision['toRevision']}.json")
    for item in revision['items']:
        a = next((a for a in before.get('assets', []) if a['id'] == item['assetId']), None)
        b = next((a for a in after.get('assets', []) if a['id'] == item['assetId']), None)
        assert item['before'] == a and item['after'] == b
        old, new = flattened(physical(a)), flattened(physical(b))
        fields = [{'field': key, 'before': old.get(key), 'after': new.get(key)} for key in sorted(old.keys() | new.keys()) if old.get(key) != new.get(key)]
        assert fields == item['fields']
        assert item['assetId'] in text and compact(item['reason']) in text
        for field in fields:
            row = next(r for r in csv_rows if int(r['fromRevision']) == revision['fromRevision'] and r['assetId'] == item['assetId'] and r['field'] == field['field'])
            assert json.loads(row['before']) == field['before'] and json.loads(row['after']) == field['after']
            assert row['reason'] == item['reason'] and json.loads(row['sourceEvidence']) == item['evidence']
            assert compact(f"{labels.get(field['field'], field['field'])}：{display(field['before'])} → {display(field['after'])}") in text
            count += 1
        for evidence in item['evidence']:
            assert evidence['documentId'] in text and evidence['textSHA256'][:12] in text
result = {'ok': True, 'revisions': len(report['revisions']), 'fieldChanges': count, 'reportSHA256': sha(report_file), 'csvSHA256': sha(csv_file), 'wholeClientTrialPassed': audit['wholeClientTrialPassed'], 'scope': 'Recorded old/new input values, change reasons and literal source trace agree with review PDF/JSON/CSV; no authority or semantic approval.', 'professionalApproval': False}
with (root / 'independent-asset-change-check.json').open('x', encoding='utf-8') as stream:
    json.dump(result, stream, ensure_ascii=False, indent=2)
print(json.dumps(result, ensure_ascii=False))
