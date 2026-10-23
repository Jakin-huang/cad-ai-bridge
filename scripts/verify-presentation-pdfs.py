"""Read-only original-declaration -> each final PDF text check; no PDF edits."""
import hashlib
import json
from pathlib import Path
import re
import sys
import pypdf

root, runs, report_name = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
read = lambda p: json.loads(p.read_text(encoding='utf-8-sig'))
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
compact = lambda text: re.sub(r'\s+', '', text)
report = read(root / report_name)
assert report.get('ok') or report.get('wholeClientTrialPassed') or report.get('finalEngineeringStatePassed')
kind = report.get('kind', 'ordinary-lighting')
directory = runs / report['jobId']
state = read(directory / ('space-planning.json' if kind == 'office-space-planning' else 'engineering.json'))
model = read(directory / ('model-' + str(state['revision']) + '.json'))
presentation = model['input']['drawingPresentation']
assert presentation['schemaVersion'] == 2
spaces = model['input'].get('rooms', model['input'].get('program'))
assert sorted(presentation['spaceIds']) == sorted(s['id'] for s in spaces)
pages = read(root / 'independent-pdf-check.json')['pages']
notes_text, checked = '', []
for page in pages:
    file = Path(page['file'])
    assert sha(file) == page['sha256']
    pdf = pypdf.PdfReader(file, strict=True)
    assert len(pdf.pages) == 1
    text = pdf.pages[0].extract_text()
    sheet = next(s for s in model['sheets'] if s['id'] == page['sheet'])
    assert compact(presentation['title']['text'] + ' - ' + sheet['title']) in compact(text), page['sheet']
    if re.match(r'^(E01|SP01)(-|$)', page['sheet']):
        notes_text += text
    checked.append({'sheet': page['sheet'], 'sha256': page['sha256'], 'projectAndSheetTitlePresent': True})
assert compact('项目范围（原文）：' + presentation['scope']['text']) in compact(notes_text)
assert compact('本次设计空间：' + '；'.join(s['name'] + ' [' + s['id'] + ']' for s in spaces)) in compact(notes_text)
for index, note in enumerate(presentation['notes']):
    assert compact('项目说明 ' + str(index + 1) + '（原文）：' + note['text']) in compact(notes_text)
assert '语义完整性' in notes_text and '专业适用性仍待审' in notes_text
result = {'ok': True, 'wholeClientTrialPassed': report.get('wholeClientTrialPassed'), 'protocolErrorsRetained': len(report.get('protocolErrors', [])), 'kind': kind, 'modelSHA256': state['modelSHA256'], 'inputSHA256': state['inputSHA256'],
          'projectTitle': presentation['title']['text'], 'spaceIds': presentation['spaceIds'],
          'notes': len(presentation['notes']), 'pages': checked, 'scopeAndAllDeclaredNotesPresent': True,
          'scope': 'Declared original-supported project text, exact task-space coverage, all sheet titles and PDF text preservation only',
          'independentSemanticAcceptance': False, 'professionalApproval': False, 'visualReview': 'pending'}
with (root / 'independent-presentation-check.json').open('x', encoding='utf-8') as out:
    out.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'ok': True, 'sheets': len(checked), 'spaces': len(spaces), 'notes': result['notes'], 'professionalApproval': False}))
