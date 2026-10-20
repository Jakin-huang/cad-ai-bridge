"""Import an operator's private Appendix A transcription after source/pixel checks.
Usage: python scripts/import-ugr-evidence.py MANIFEST.json EXPECTED-SHA256 NEW-PROFILE.json
The numeric table transcription/interpretation is not automatically certified.
"""
import datetime
import hashlib
import json
import math
import sys
from pathlib import Path
import pypdfium2 as pdfium

file, expected, out = Path(sys.argv[1]), sys.argv[2].lower(), Path(sys.argv[3])
digest = lambda f: hashlib.sha256(Path(f).read_bytes()).hexdigest()
def require(ok, reason):
    if not ok:
        raise ValueError(reason)
require(digest(file) == expected, 'UGR_MANIFEST_CHANGED')
m = json.loads(file.read_text(encoding='utf8'))
require(not out.exists(), 'UGR_PROFILE_EXISTS')
require(m['professionalApproval'] is False and m['schemaVersion'] == 1, 'UGR_SCHEMA')
require(m['source']['code'] == 'GB/T 50034-2024' and m['source']['edition'] == '2024'
        and m['source']['effectiveFrom'] == '2024-08-01', 'UGR_EDITION')
require(m['limits'] == dict(minimumEmittingAreaM2=.005, maximumEmittingAreaM2=1.5,
        referenceWorkplaneM=.75, seatedEyeM=1.2, standingEyeM=1.5,
        room='rectangular_reference_room', photometry='double_symmetric'), 'UGR_LIMITS')
require({w['pdfPage'] for w in m['witnesses']} == {80, 82, 83, 84}
        and len(m['witnesses']) == 4, 'UGR_WITNESS_COVERAGE')
require(digest(m['source']['file']) == m['source']['sha256'], 'UGR_SOURCE_CHANGED')
pdf = pdfium.PdfDocument(m['source']['file'])
for w in m['witnesses']:
    image = pdf[w['pdfPage']-1].render(scale=1.5).to_pil().convert('RGB')
    require(hashlib.sha256(image.tobytes()).hexdigest() == w['pixelSHA256'], 'UGR_PAGE_WITNESS_CHANGED')
    require(digest(w['crossCheckFile']) == w['crossCheckSHA256'], 'UGR_CROSSCHECK_CHANGED')
table = m['positionIndex']
require(table['lateralRatios'] == [round(i/10, 1) for i in range(31)]
        and table['elevationRatios'] == [round(i/10, 1) for i in range(20)], 'UGR_TABLE_AXES')
require(len(table['values']) == 31 and all(len(row) == 20 for row in table['values']), 'UGR_TABLE_DIMENSIONS')
require(all(v is None or (type(v) in (int, float) and math.isfinite(v) and 0 < v <= 100)
        for row in table['values'] for v in row), 'UGR_TABLE_VALUES')
require(table['interpretation'] == 'minimum_active_bracket_value_no_extrapolation_no_dash_substitution', 'UGR_INTERPRETATION')
profile = dict(m, createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), manifestSHA256=expected,
               sourceScope='inspected_edition_subset_not_professional_applicability')
with out.open('x', encoding='utf8') as stream:
    json.dump(profile, stream, ensure_ascii=False, indent=2, allow_nan=False)
print(json.dumps({'ok': True, 'sha256': digest(out), 'rows': len(table['values']), 'columns': len(table['elevationRatios']),
                  'scope': 'Source/pixel identity and operator transcription; no professional applicability approval'}))
