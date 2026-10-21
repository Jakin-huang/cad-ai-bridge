"""Independent strict-reader, text, fields and pixel checks of derived CAD PDFs."""
import hashlib
import json
import pathlib
import subprocess
import sys

import pypdf
from pypdf import PdfReader
from PIL import Image, ImageChops

folder, poppler = [pathlib.Path(value).resolve() for value in sys.argv[1:]]
read = lambda file: json.loads(file.read_text(encoding='utf-8'))
sha = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()
ready = read(folder / 'normalization-ready.json')
manifest = read(folder / 'case-manifest.json')
assert ready['ok'] and ready['createdPdfs'] == manifest['expectedPdfs']
assert not (folder / 'independent-pdf-check.json').exists()
render = folder / 'rendered'
render.mkdir(exist_ok=False)
report = {
    'ok': False,
    'scope': 'Same known synthetic native sheets, file-format/read/render preservation only; no new design or professional review',
    'reader': {'name': 'pypdf', 'version': pypdf.__version__},
    'rendererSHA256': sha(poppler),
    'dpi': 120,
    'pages': [],
    'visualReview': 'pending',
    'productWorkflowIntegrated': False,
    'professionalApproval': False,
}

for record in ready['files']:
    source, target = [pathlib.Path(record[key]) for key in ['source', 'file']]
    assert sha(source) == record['sourceSHA256']
    assert sha(target) == record['sha256']
    old_strict, strict_error = True, None
    try:
        assert len(PdfReader(source, strict=True).pages) == 1
    except Exception as error:
        old_strict, strict_error = False, str(error)
    old, new = PdfReader(source, strict=False), PdfReader(target, strict=True)
    assert len(old.pages) == len(new.pages) == 1
    text_before, text_after = old.pages[0].extract_text(), new.pages[0].extract_text()
    assert len(text_before.strip()) > 10 and text_before == text_after
    assert old.get_fields() == new.get_fields()
    dimensions = lambda page: [float(page.mediabox.width), float(page.mediabox.height)]
    assert all(abs(a - b) < 1e-8 for a, b in zip(dimensions(old.pages[0]), dimensions(new.pages[0])))
    images = []
    for role, file in [('source', source), ('canonical', target)]:
        prefix = render / f"{role}-{record['group']}-{record['sheet']}"
        subprocess.run([str(poppler), '-r', '120', '-singlefile', '-png', str(file), str(prefix)], check=True, capture_output=True)
        images.append(prefix.with_suffix('.png'))
    with Image.open(images[0]) as image_before, Image.open(images[1]) as image_after:
        before, after = image_before.convert('RGB'), image_after.convert('RGB')
        assert before.size == after.size
        assert ImageChops.difference(before, after).getbbox() is None, (source, target)
        assert ImageChops.difference(after, Image.new('RGB', after.size, 'white')).getbbox() is not None
        pixels_before, pixels_after = [hashlib.sha256(image.tobytes()).hexdigest() for image in [before, after]]
        assert pixels_before == pixels_after
        pixels = before.size
    report['pages'].append({
        'group': record['group'], 'sheet': record['sheet'], 'paper': record['paper'],
        'sourceSHA256': record['sourceSHA256'], 'outputSHA256': record['sha256'],
        'originalStrictReaderPassed': old_strict, 'originalStrictError': strict_error,
        'derivedStrictReaderPassed': True, 'pageSizePoints': dimensions(new.pages[0]),
        'textCharacters': len(text_after), 'textPreserved': True, 'fieldStatePreserved': True,
        'sourceRender': str(images[0]), 'derivedRender': str(images[1]),
        'sourceRenderSHA256': sha(images[0]), 'derivedRenderSHA256': sha(images[1]),
        'pixelSize': pixels, 'pixelSHA256': pixels_after, 'pixelIdentical': True,
    })
for group in manifest['groups']:
    assert sha(pathlib.Path(group['modelFile'])) == group['modelFileSHA256']
    assert sha(pathlib.Path(group['drawing'])) == group['drawingSHA256']
    assert sha(pathlib.Path(group['sourceArchive'])) == group['sourceArchiveSHA256']
    for sheet in group['sheets']:
        assert sha(pathlib.Path(sheet['file'])) == sheet['sha256']
assert len(report['pages']) == manifest['expectedPdfs']
report['ok'] = True
report['originalSourcesAndArchivesUnchanged'] = True
(folder / 'independent-pdf-check.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({
    'ok': True, 'pdfs': len(report['pages']),
    'originalStrictFailures': sum(not p['originalStrictReaderPassed'] for p in report['pages']),
    'derivedStrictPass': len(report['pages']), 'pixelIdentical': len(report['pages']),
    'visualReview': 'pending', 'productWorkflowIntegrated': False,
}))
