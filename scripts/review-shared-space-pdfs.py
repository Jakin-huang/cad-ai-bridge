"""Inspect actual CAD paper sizes, merge by frozen model sheet order and render."""
import hashlib, json, pathlib, subprocess, sys
from pypdf import PdfReader, PdfWriter
folder, runs, poppler = map(pathlib.Path, sys.argv[1:])
journal = json.loads((folder/'journal.json').read_text(encoding='utf-8'))
assert journal['ok']
out = folder/'待审图册'
out.mkdir()
sizes = {'A3':[420,297], 'A2':[594,420], 'A1':[841,594], 'A0':[1189,841]}
report = {'schemaVersion':1, 'visualReview':'pending', 'professionalApproval':False, 'booklets':[], 'pages':[]}
for discipline, label in [('space','空间方案'), ('lighting','联动照明')]:
    for revision in [0,1]:
        result = journal[f'{discipline}Deliver{revision}']['current']
        model = json.loads((runs/result['jobId']/f'model-{revision}.json').read_text(encoding='utf-8'))
        files = {pathlib.Path(f['file']).stem:f for f in result['delivery']['files'] if f['kind']=='pdf'}
        assert len(files)==len(model['sheets'])
        writer = PdfWriter()
        for sheet in model['sheets']:
            item = files[sheet['id']]
            source = pathlib.Path(item['file'])
            assert hashlib.sha256(source.read_bytes()).hexdigest()==item['sha256']
            reader = PdfReader(source)
            assert len(reader.pages)==1
            page = reader.pages[0]
            size = [float(page.mediabox.width)*25.4/72,float(page.mediabox.height)*25.4/72]
            assert all(abs(a-b)<.2 for a,b in zip(size,sizes[sheet.get('paper','A3')])), (source,size)
            assert len(page.extract_text().strip())>10
            writer.add_page(page)
            report['pages'].append({'discipline':discipline,'revision':revision,'sheet':sheet['id'],'file':str(source),'sha256':item['sha256'],'paper':sheet.get('paper','A3'),'sizeMm':size})
        target = out/f'R{revision}-{label}-待人工审核.pdf'
        writer.write(target)
        assert len(PdfReader(target).pages)==len(model['sheets'])
        prefix = out/f'{discipline}-r{revision}'
        subprocess.run([str(poppler),'-r','100','-png',str(target),str(prefix)],check=True)
        report['booklets'].append({'discipline':discipline,'revision':revision,'file':str(target),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'pages':len(model['sheets'])})
(folder/'pdf-review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'ok':True,'pages':len(report['pages']),'renders':len(list(out.glob('*.png')))}))
