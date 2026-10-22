"""Independent persisted CSV and source-leg reconciliation for a native delivery."""
import csv
import hashlib
import json
import pathlib
import re
import sys
from decimal import Decimal

root = pathlib.Path(sys.argv[1]).resolve()
read = lambda p: json.loads(pathlib.Path(p).read_text(encoding='utf-8-sig'))
sha = lambda p: hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
trial = read(root / 'native-report.json')
assert trial['ok']
model = read(trial['modelPath'])
schedule = model['routeSchedule']
matches = [f for f in trial['files'] if f['file'].endswith('-route-segments.csv')]
assert len(matches) == 1
item = matches[0]
assert sha(item['file']) == item['sha256']
with open(item['file'], encoding='utf-8-sig', newline='') as stream:
    rows = list(csv.DictReader(stream))
assert len(rows) == len(schedule['segments'])
lengths = {}
for route in model['routes']:
    total = Decimal(0)
    for a, b in zip(route['vertices'], route['vertices'][1:]):
        assert a[0] == b[0] or a[1] == b[1]
        total += sum(abs(Decimal(str(x))-Decimal(str(y))) for x, y in zip(a, b))/1000
    lengths[route['circuitId']] = lengths.get(route['circuitId'], Decimal(0)) + total
csv_lengths = {c: Decimal(0) for c in lengths}
def coordinate(value):
    # Existing CSV export protects leading minus with an apostrophe. Decode only
    # a complete numeric literal, never arbitrary spreadsheet expressions.
    assert re.fullmatch(r"'?-?\d+(?:\.\d+)?", value)
    if value.startswith("'"):
        assert value.startswith("'-")
        value = value[1:]
    return Decimal(value)

for row, segment in zip(rows, schedule['segments']):
    assert row['segment'] == segment['label']
    coords = [coordinate(row[k]) for k in ['startXmm','startYmm','endXmm','endYmm']]
    assert coords == [Decimal(str(n)) for n in segment['start'] + segment['end']]
    exact = (abs(coords[2]-coords[0])+abs(coords[3]-coords[1]))/1000
    assert abs(exact-Decimal(row['planarLengthM'])) <= Decimal('0.0000005')
    assert int(row['traversals']) == segment['traversals']
    expected = {c['circuitId']: c['passes'] for c in segment['circuits']}
    parsed = {part.rsplit(' x', 1)[0]: int(part.rsplit(' x', 1)[1]) for part in row['circuitsAndPasses'].split('; ')}
    assert parsed == expected and sum(parsed.values()) == int(row['traversals'])
    assert row['baseSectionsMm2'] == '; '.join(c['circuitId']+':'+str(c['wireSectionMm2']) for c in segment['circuits'])
    assert row['scope'] == schedule['scope']
    for circuit, passes in parsed.items():
        csv_lengths[circuit] += exact * passes
for circuit in lengths:
    assert abs(lengths[circuit]-csv_lengths[circuit]) < Decimal('0.000001')
for material in schedule['materials']:
    relevant = [c for c in model['circuits'] if c['wireSectionMm2'] == material['wireSectionMm2']]
    planar = sum(lengths[c['id']] * 3 for c in relevant)
    extra = sum((Decimal(str(c['estimatedLengthM']))-Decimal(str(c['routeLengthM'])))*3 for c in relevant)
    assert abs(planar-Decimal(str(material['planarConductorLengthM']))) < Decimal('0.000001')
    assert abs(extra-Decimal(str(material['extraConductorLengthM']))) < Decimal('0.000001')
report = {'ok': True, 'csvRows': len(rows), 'csvSHA256': item['sha256'],
          'allCircuitSourceLengthsReconciled': True, 'baseMaterialLengthsReconciled': True,
          'professionalApproval': False, 'scope': 'Persisted CSV, planar source legs and declared three-conductor estimates only.'}
with (root / 'independent-csv-check.json').open('x', encoding='utf-8') as out:
    out.write(json.dumps(report, indent=2)+'\n')
print(json.dumps(report))
