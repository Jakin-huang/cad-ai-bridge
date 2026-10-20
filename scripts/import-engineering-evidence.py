"""Import bounded, inspected GB 55024 lighting rules from a local PDF.

This recognizes source text anchors, not arbitrary regulatory compliance.
Usage: python scripts/import-engineering-evidence.py SOURCE.pdf PROFILE.json
"""
import hashlib
import json
from pathlib import Path
import re
import sys
from pypdf import PdfReader

source, destination = map(Path, sys.argv[1:3])
data = source.read_bytes()
reader = PdfReader(source)
pages = [page.extract_text() or '' for page in reader.pages]
if not any('55024' in text and '2022' in text for text in pages[:8]):
    raise ValueError('Source identity is not the inspected GB 55024-2022 edition')
rules = [
    ('4.5.1', 'terminal_protection', ['照明配电终端回路', '短路保护', '过负荷保护', '接地故障保护']),
    ('4.5.4', 'low_mount_rcd', ['正常照明灯具', '剩余电流动作保护电器']),
    ('4.5.8', 'corridor_control', ['主要走道', '区域集中控制', '手动控制功能']),
]
clauses = []
for locator, check, anchors in rules:
    for page_no, text in enumerate(pages, 1):
        compact = re.sub(r'\s+', '', text)
        start = compact.find(locator)
        if start >= 0:
            # Verify anchors only inside the clause, never elsewhere on the page.
            tail = compact[start + len(locator):]
            match = re.search(r'4\.5\.\d+', tail)
            excerpt = tail[:match.start()] if match else tail
            if all(anchor in excerpt for anchor in anchors):
                clauses.append({'locator': locator, 'check': check, 'page': page_no,
                                'textSHA256': hashlib.sha256(excerpt.encode()).hexdigest(),
                                'anchors': anchors})
                break
    else:
        raise ValueError('Expected inspected clause text not found: ' + locator)
profile = {'schemaVersion': 1, 'standards': [{
    'code': 'GB 55024-2022', 'effectiveFrom': '2022-10-01',
    'sourceFile': str(source.resolve()), 'sourceSHA256': hashlib.sha256(data).hexdigest(),
    'clauses': clauses,
    'scope': 'Three bounded model checks; not full-code, installed performance or specialist approval'}]}
destination.parent.mkdir(parents=True, exist_ok=True)
if destination.exists():
    previous = destination.with_name(destination.name + '.previous-' + hashlib.sha256(destination.read_bytes()).hexdigest()[:12])
    if not previous.exists():
        previous.write_bytes(destination.read_bytes())
destination.write_text(json.dumps(profile, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps({'ok': True, 'clauses': len(clauses), 'profile': str(destination)}, ensure_ascii=False))
