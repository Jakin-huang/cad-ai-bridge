"""Verify and render the already saved actual-client native design sheets."""
import hashlib, json, pathlib, subprocess, sys
from pypdf import PdfReader, PdfWriter
folder, poppler = map(pathlib.Path, sys.argv[1:])
journal = json.loads((folder/'journal.json').read_text(encoding='utf-8'))
assert journal['ok'] and journal['actualClientDesign'] and not journal['controllerSemanticRepair']
delivery = journal['delivery']['current']['delivery']
model = json.loads((pathlib.Path(delivery['drawing']).parent/'model-1.json').read_text(encoding='utf-8'))
files = {pathlib.Path(f['file']).stem:f for f in delivery['files'] if f['kind']=='pdf'}
assert len(files)==len(model['sheets'])==5
out = folder/'output'/'pdf'
out.mkdir(parents=True)
writer = PdfWriter()
report = {'schemaVersion':1,'actualClientDesign':True,'visualReview':'pending','professionalApproval':False,'pages':[]}
sizes = {'A3':[420,297], 'A2':[594,420], 'A1':[841,594], 'A0':[1189,841]}
for sheet in model['sheets']:
    f = files[sheet['id']]
    source = pathlib.Path(f['file'])
    assert hashlib.sha256(source.read_bytes()).hexdigest()==f['sha256']
    reader = PdfReader(source)
    assert len(reader.pages)==1
    page = reader.pages[0]
    size = [float(page.mediabox.width)*25.4/72,float(page.mediabox.height)*25.4/72]
    assert all(abs(a-b)<.2 for a,b in zip(size,sizes[sheet.get('paper','A3')])), (source,size)
    text = page.extract_text()
    assert len(text.strip())>10
    (out/(sheet['id']+'.txt')).write_text(text,encoding='utf-8')
    writer.add_page(page)
    report['pages'].append({'sheet':sheet['id'],'source':str(source),'sha256':f['sha256'],'sizeMm':size,'textCharacters':len(text)})
target = out/'AI任务修订-待人工审核.pdf'
writer.write(target)
assert len(PdfReader(target).pages)==5
subprocess.run([str(poppler),'-r','120','-png',str(target),str(out/'sheet')],check=True)
report['booklet']={'file':str(target),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'pages':5}
(folder/'pdf-review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'ok':True,'pages':5,'renders':len(list(out.glob('*.png'))),'booklet':str(target)},ensure_ascii=False))
