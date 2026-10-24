"""Read-only independent PDF checks after the real client publishes its model."""
import hashlib
import json
import pathlib
import subprocess
import sys
import pypdf
from PIL import Image, ImageChops

assert len(sys.argv) in [4, 5]
folder, runs, poppler = map(lambda p: pathlib.Path(p).resolve(), sys.argv[1:4])
publication_name = sys.argv[4] if len(sys.argv) == 5 else 'client-publication.json'
assert pathlib.Path(publication_name).name == publication_name and publication_name.endswith('.json')
read = lambda p: json.loads(p.read_text(encoding='utf-8-sig'))
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
publication = read(folder / publication_name)
assert (publication.get('ok') or publication.get('finalEngineeringStatePassed'))
assert publication.get('actualInstalledAiClient') is True or publication.get('controllerDrivenNative') is True
kind = publication.get('kind', 'ordinary-lighting')
assert kind in ['ordinary-lighting', 'office-space-planning']
state_name = 'space-planning.json' if kind == 'office-space-planning' else 'engineering.json'
state = read(runs / publication['jobId'] / state_name)
model = read(runs / publication['jobId'] / ('model-' + str(state['revision']) + '.json'))
assert state['modelSHA256'] == publication['modelSHA256']
packet = read(pathlib.Path(state['pdfReview']['manifestFile']))
assert sha(pathlib.Path(state['pdfReview']['manifestFile'])) == state['pdfReview']['manifestSHA256']
assert len(packet['files']) == len(model['sheets'])
render = folder / 'pdf-check'
render.mkdir(exist_ok=False)
report = {'ok': False, 'scope': 'Exact declared synthetic design sheets, strict parsing and raw/derived rendering preservation; not professional design approval',
          'readerVersion': pypdf.__version__, 'rendererSHA256': sha(poppler), 'dpi': 120,
          'kind': kind, 'actualAiPublished': publication.get('actualInstalledAiClient') is True,
          'controllerDrivenNative': publication.get('controllerDrivenNative') is True, 'priorWholeClientTrialPassed': publication.get('priorWholeClientTrialPassed'),
          'wholeClientTrialPassed': publication.get('wholeClientTrialPassed'),
          'pages': [], 'visualReview': 'pending', 'professionalApproval': False}
papers = {'A0': [1189, 841], 'A1': [841, 594], 'A2': [594, 420], 'A3': [420, 297], 'A4': [297, 210]}
for f in packet['files']:
    source, target = pathlib.Path(f['source']), pathlib.Path(f['file'])
    assert sha(source) == f['sourceSHA256'] and sha(target) == f['sha256']
    a, b = pypdf.PdfReader(source, strict=False), pypdf.PdfReader(target, strict=True)
    assert len(a.pages) == len(b.pages) == 1 and a.get_fields() == b.get_fields()
    old_text, text = a.pages[0].extract_text(), b.pages[0].extract_text()
    assert text == old_text and len(text.strip()) > 10
    size = [float(b.pages[0].mediabox.width) * 25.4 / 72, float(b.pages[0].mediabox.height) * 25.4 / 72]
    sheet = next(s for s in model['sheets'] if s['id'] == f['sheet'])
    assert all(abs(x-y) < .2 for x, y in zip(size, papers[sheet.get('paper', 'A3')]))
    images = []
    for role, pdf in [('source', source), ('review', target)]:
        prefix = render / (role + '-' + f['sheet'])
        subprocess.run([str(poppler), '-r', '120', '-singlefile', '-png', str(pdf), str(prefix)], check=True, capture_output=True)
        images.append(prefix.with_suffix('.png'))
    with Image.open(images[0]) as ia, Image.open(images[1]) as ib:
        aa, bb = ia.convert('RGB'), ib.convert('RGB')
        assert aa.size == bb.size and ImageChops.difference(aa, bb).getbbox() is None
        assert ImageChops.difference(bb, Image.new('RGB', bb.size, 'white')).getbbox() is not None
        pixels_sha = hashlib.sha256(bb.tobytes()).hexdigest()
    (render / (f['sheet'] + '.txt')).write_text(text, encoding='utf-8')
    report['pages'].append({'sheet': f['sheet'], 'paper': sheet.get('paper', 'A3'), 'sizeMm': size,
                            'source': str(source), 'sourceSHA256': f['sourceSHA256'], 'file': str(target), 'sha256': f['sha256'],
                            'strictReaderAccepted': True, 'sourceAndReviewPixelIdentical': True,
                            'image': str(images[1]), 'imageSHA256': sha(images[1]), 'pixelSHA256': pixels_sha})
protected_file = folder / 'protected-before.json'
if protected_file.exists():
    protected = read(protected_file)
elif (folder / 'before-files.json').exists():
    before = read(folder / 'before-files.json')
    allowed = set(read(folder / 'allowed-mutable.json'))
    for item in before:
        assert sha(pathlib.Path(item['preservedAt'])) == item['sha256']
    protected = [item for item in before if item['file'] not in allowed]
    report['preservedBeforeSnapshotFiles'] = len(before)
    report['mutableLifecycleViewsSeparatelyAudited'] = True
else:
    protected = read(folder / 'experiment.json')['protectedFiles']
for f in protected:
    assert sha(pathlib.Path(f['file'])) == f['sha256']
report['ok'] = True
report['protectedInputsAndModelsUnchanged'] = True
with (folder / 'independent-pdf-check.json').open('x', encoding='utf-8') as out:
    out.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'ok': True, 'strictPass': len(report['pages']), 'pixelIdentical': len(report['pages']), 'visualReview': 'pending', 'professionalApproval': False}))
