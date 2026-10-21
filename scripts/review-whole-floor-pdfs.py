"""Verify saved native sheets and create a review booklet; visual QA remains separate."""
import hashlib
import json
import pathlib
import subprocess
import sys

from pypdf import PdfReader, PdfWriter

folder, poppler = [pathlib.Path(value).resolve() for value in sys.argv[1:]]
read = lambda file: json.loads(file.read_text(encoding='utf-8'))
sha = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()
ready = read(folder / 'floor-quality-ready.json')
native = read(folder / 'floor-delivery-ready.json')
assert ready['ok'] and ready['stage'] == 'ready_for_native_delivery'
assert native['ok'] and native['stage'] == 'native_verified_visual_review_pending'
assert native['modelSHA256'] == ready['modelSHA256']
model = read(pathlib.Path(ready['modelFile']))
delivery = native['delivery']
assert sha(pathlib.Path(delivery['drawing'])) == delivery['drawingSHA256']
pdfs = [item for item in delivery['files'] if item['kind'] == 'pdf']
assert len(pdfs) == len(model['sheets'])
files = {pathlib.Path(item['file']).stem: item for item in pdfs}
assert len(files) == len(pdfs)
assert set(files) == {sheet['id'] for sheet in model['sheets']}
sizes = {'A3': [420, 297], 'A2': [594, 420], 'A1': [841, 594], 'A0': [1189, 841]}
out = folder / 'output' / 'pdf'
out.mkdir(parents=True, exist_ok=False)
writer = PdfWriter()
report = {
    'schemaVersion': 1,
    'scope': 'Known procedural twelve-room lighting study, not an independent project',
    'modelSHA256': ready['modelSHA256'],
    'visualReview': 'pending',
    'professionalApproval': False,
    'pages': [],
}
for sheet in model['sheets']:
    item = files[sheet['id']]
    source = pathlib.Path(item['file'])
    assert sha(source) == item['sha256']
    reader = PdfReader(source)
    assert len(reader.pages) == 1
    page = reader.pages[0]
    assert int(page.get('/Rotate', 0)) % 360 == 0, source
    size = [float(page.mediabox.width) * 25.4 / 72, float(page.mediabox.height) * 25.4 / 72]
    paper = sheet.get('paper', 'A3')
    assert all(abs(actual - expected) < .2 for actual, expected in zip(size, sizes[paper])), (source, size, paper)
    text = page.extract_text()
    assert len(text.strip()) > 10, source
    (out / (sheet['id'] + '.txt')).write_text(text, encoding='utf-8')
    writer.add_page(page)
    report['pages'].append({
        'sheet': sheet['id'], 'source': str(source), 'sha256': item['sha256'],
        'paper': paper, 'sizeMm': size, 'textCharacters': len(text),
        'textSHA256': hashlib.sha256(text.encode('utf-8')).hexdigest(),
    })
target = out / '整层照明质量-待人工审核.pdf'
writer.write(target)
assert len(PdfReader(target).pages) == len(model['sheets'])
subprocess.run([str(poppler), '-r', '120', '-png', str(target), str(out / 'sheet')], check=True)
renders = sorted(out.glob('sheet-*.png'))
assert len(renders) == len(model['sheets'])
for record, render in zip(report['pages'], renders):
    record['render'] = str(render)
    record['renderSHA256'] = sha(render)
report['booklet'] = {'file': str(target), 'sha256': sha(target), 'pages': len(model['sheets'])}
(folder / 'pdf-review.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'ok': True, 'pages': len(report['pages']), 'visualReview': 'pending', 'booklet': str(target)}, ensure_ascii=False))
