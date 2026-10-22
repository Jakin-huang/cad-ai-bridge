"""Independent format/render preservation for both mechanical native schemes."""
import hashlib
import json
import pathlib
import subprocess
import sys
import pypdf
from PIL import Image, ImageChops

root, poppler = (pathlib.Path(p).resolve() for p in sys.argv[1:3])
read = lambda p: json.loads(p.read_text(encoding='utf-8-sig'))
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
trial = read(root / 'comparison.json')
assert trial['ok'] and trial['actualMcpProtocol'] and not trial['actualInstalledAiClient']
assert len(trial['cases']) == 2 and trial['cases'][0]['inputSHA256'] == trial['cases'][1]['inputSHA256']
report = {'ok': False, 'actualAiAcceptance': False, 'professionalApproval': False,
          'dpi': 120, 'readerVersion': pypdf.__version__, 'rendererSHA256': sha(poppler),
          'cases': [], 'visualReview': 'pending'}
papers = {'A3': [420, 297], 'A2': [594, 420], 'A1': [841, 594], 'A0': [1189, 841]}
for case in trial['cases']:
    folder = root / 'pdf-check' / case['mode']
    folder.mkdir(parents=True, exist_ok=False)
    state = read(root / 'data/runs' / case['jobId'] / 'space-planning.json')
    model = read(root / 'data/runs' / case['jobId'] / 'model-0.json')
    packet = read(pathlib.Path(state['pdfReview']['manifestFile']))
    assert sha(pathlib.Path(state['pdfReview']['manifestFile'])) == state['pdfReview']['manifestSHA256']
    assert state['modelSHA256'] == case['modelSHA256'] and packet['modelSHA256'] == case['modelSHA256']
    pages = []
    for item in packet['files']:
        raw, review = pathlib.Path(item['source']), pathlib.Path(item['file'])
        assert sha(raw) == item['sourceSHA256'] and sha(review) == item['sha256']
        a, b = pypdf.PdfReader(raw, strict=False), pypdf.PdfReader(review, strict=True)
        assert len(a.pages) == len(b.pages) == 1 and a.get_fields() == b.get_fields()
        text = b.pages[0].extract_text()
        assert text == a.pages[0].extract_text() and len(text.strip()) > 10
        sheet = next(s for s in model['sheets'] if s['id'] == item['sheet'])
        size = [float(b.pages[0].mediabox.width)*25.4/72, float(b.pages[0].mediabox.height)*25.4/72]
        assert all(abs(x-y) < .2 for x, y in zip(size, papers[sheet['paper']]))
        images = []
        for role, pdf in [('source', raw), ('review', review)]:
            prefix = folder / (role + '-' + item['sheet'])
            subprocess.run([str(poppler), '-r', '120', '-singlefile', '-png', str(pdf), str(prefix)], check=True, capture_output=True)
            images.append(prefix.with_suffix('.png'))
        with Image.open(images[0]) as ia, Image.open(images[1]) as ib:
            aa, bb = ia.convert('RGB'), ib.convert('RGB')
            assert aa.size == bb.size and ImageChops.difference(aa, bb).getbbox() is None
            assert ImageChops.difference(bb, Image.new('RGB', bb.size, 'white')).getbbox() is not None
        (folder / (item['sheet'] + '.txt')).write_text(text, encoding='utf-8')
        pages.append({'sheet': item['sheet'], 'paper': sheet['paper'], 'strictReaderAccepted': True,
                      'sourceAndReviewPixelIdentical': True, 'image': str(images[1]),
                      'imageSHA256': sha(images[1]), 'file': str(review), 'sha256': sha(review)})
    assert len(pages) == len(model['sheets'])
    report['cases'].append({'mode': case['mode'], 'pages': pages})
for item in trial['protectedFiles']:
    assert sha(pathlib.Path(item['file'])) == item['sha256']
report['ok'] = True
with (root / 'independent-pdf-check.json').open('x', encoding='utf-8') as out:
    out.write(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'ok': True, 'cases': len(report['cases']), 'strictAndPixelIdenticalPages': sum(len(c['pages']) for c in report['cases']), 'visualReview': 'pending', 'professionalApproval': False}))
