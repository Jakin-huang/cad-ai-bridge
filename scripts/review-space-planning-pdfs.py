"""Merge and render actual CAD PDFs; visual sign-off remains a separate step."""
import hashlib, json, pathlib, subprocess, sys
from pypdf import PdfReader, PdfWriter
folder = pathlib.Path(sys.argv[1])
poppler = pathlib.Path(sys.argv[2])
journal = json.loads((folder / 'journal.json').read_text(encoding='utf-8'))
assert journal['ok']
out = folder / '待审图册'
out.mkdir()
report = {'schemaVersion': 1, 'pages': [], 'visualReview': 'pending', 'professionalApproval': False}
for revision in (0, 1):
    delivery = journal[f'delivered{revision}']['current']['delivery']
    writer = PdfWriter()
    files = [f for f in delivery['files'] if f['kind'] == 'pdf']
    assert len(files) == 5
    for index, item in enumerate(files):
        source = pathlib.Path(item['file'])
        assert hashlib.sha256(source.read_bytes()).hexdigest() == item['sha256']
        reader = PdfReader(source)
        assert len(reader.pages) == 1
        page = reader.pages[0]
        size_mm = [float(page.mediabox.width)*25.4/72, float(page.mediabox.height)*25.4/72]
        expected = [594, 420] if index in (1, 2) else [420, 297]
        assert all(abs(a-b) < .2 for a,b in zip(size_mm, expected)), (source, size_mm)
        assert len(page.extract_text().strip()) > 10
        writer.add_page(page)
        report['pages'].append({'revision': revision, 'sheet': source.stem, 'source': str(source), 'sha256': item['sha256'], 'sizeMm': size_mm, 'textCharacters': len(page.extract_text())})
    target = out / f'R{revision}-办公空间方案-待人工审核.pdf'
    writer.write(target)
    assert len(PdfReader(target).pages) == 5
    subprocess.run([str(poppler), '-r', '100', '-png', str(target), str(out / f'R{revision}')], check=True)
    report[f'booklet{revision}'] = {'file': str(target), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'pages': 5}
(folder / 'pdf-review.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps({'ok': True, 'pages': len(report['pages']), 'rendered': len(list(out.glob('*.png')))}, ensure_ascii=False))
