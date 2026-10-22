"""Independent nodal circuit solve + serialized CSV reconciliation. Local only."""
import csv
import hashlib
import json
import pathlib
import sys
import numpy as np

root = pathlib.Path(sys.argv[1]).resolve()
read = lambda p: json.loads(pathlib.Path(p).read_text(encoding='utf-8-sig'))
sha = lambda p: hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
native = read(root / 'native-report.json')
assert native['ok'] and not native['newAiClient']
m = read(native['modelPath'])
graph = next(f for f in native['files'] if f['file'].endswith('-installation.json'))
csv_file = next(f for f in native['files'] if f['file'].endswith('-installation-runs.csv'))
assert read(graph['file']) == m['installation'] and sha(graph['file']) == graph['sha256']
assert sha(csv_file['file']) == csv_file['sha256']
with pathlib.Path(csv_file['file']).open(encoding='utf-8-sig', newline='') as stream:
    rows = list(csv.DictReader(stream))
e = m['input']['electrical']
results = []
for circuit in m['installation']['circuits']:
    parent = {}
    def find(x):
        parent.setdefault(x, x)
        if parent[x] != x:
            parent[x] = find(parent[x])
        return parent[x]
    def join(a, b):
        parent[find(a)] = find(b)
    edges = []
    for run in circuit['runs']:
        meters = sum(sum((b[k]-a[k])**2 for k in range(3))**0.5 for a, b in zip(run['vertices'], run['vertices'][1:])) / 1000
        assert abs(meters-run['lengthM']) < 1e-6
        for wire in run['conductors']:
            a = run['from'] + ':' + wire['fromTerminal']
            b = run['to'] + ':' + wire['toTerminal']
            find(a); find(b)
            resistance = meters*e['copperOhmMm2PerM']/run['wireSectionMm2']
            if resistance < 1e-12:
                join(a, b)
            else:
                edges.append((a, b, resistance))
        row = [r for r in rows if r['circuit'] == circuit['circuitId'] and r['run'] == run['id']]
        assert len(row) == 1
        row = row[0]
        assert row['from'] == run['from'] and row['to'] == run['to']
        assert json.loads(row['verticesMm']) == run['vertices']
        assert abs(float(row['lengthM'])-meters) < 1e-6
        expected = ';'.join(w['role']+':'+run['from']+'.'+w['fromTerminal']+'->'+run['to']+'.'+w['toTerminal'] for w in run['conductors'])
        assert row['conductors'] == expected
    join('S:LINE', 'S:LOAD')  # Closed ideal contact for voltage calculation.
    edges = [(find(a), find(b), r) for a, b, r in edges if find(a) != find(b)]
    adjacency = {}
    for a, b, _ in edges:
        adjacency.setdefault(a, set()).add(b)
        adjacency.setdefault(b, set()).add(a)
    loads = [(node, next(d for d in m['devices'] if d['id'] == node['physicalId'])) for node in circuit['nodes'] if node['kind'] == 'luminaire']
    potentials = {}
    for terminal, source_v, sign in [('L', e['voltage'], -1), ('N', 0., 1)]:
        source = find('P:'+terminal)
        component, pending = {source}, [source]
        while pending:
            for target in adjacency.get(pending.pop(), set()):
                if target not in component:
                    component.add(target); pending.append(target)
        unknown = sorted(component-{source})
        index = {node: i for i, node in enumerate(unknown)}
        matrix, rhs = np.zeros((len(unknown), len(unknown))), np.zeros(len(unknown))
        for a, b, r in edges:
            if a not in component:
                continue
            for here, other in [(a, b), (b, a)]:
                if here == source:
                    continue
                i = index[here]
                matrix[i, i] += 1/r
                if other == source:
                    rhs[i] += source_v/r
                else:
                    matrix[i, index[other]] -= 1/r
        for node, device in loads:
            target = find(node['id']+':'+terminal)
            assert target in component
            if target != source:
                rhs[index[target]] += sign*device['watts']/(e['voltage']*e['powerFactor'])
        solution = np.linalg.solve(matrix, rhs)
        assert np.max(np.abs(matrix @ solution-rhs), initial=0) < 1e-6
        potentials[source] = source_v
        potentials.update(zip(unknown, solution))
    amps = sum(d['watts']/(e['voltage']*e['powerFactor']) for _, d in loads)
    allowance_v = 2*e['copperOhmMm2PerM']*e['extraLengthM']*amps/e['wireSectionMm2']
    for node, device in loads:
        drop = e['voltage']-(potentials[find(node['id']+':L')]-potentials[find(node['id']+':N')])+allowance_v
        stored = next(d for d in circuit['drops'] if d['deviceId'] == device['id'])
        assert abs(drop-stored['dropV']) < 1e-6
        assert abs(drop/e['voltage']*100-stored['dropPercent']) < 1e-6
        limit = next(r['value'] for r in m['input']['requirements'] if r['rule'] == 'max_drop' and circuit['roomId'] in r['roomIds'])
        assert drop/e['voltage']*100 <= limit
        results.append({'circuit': circuit['circuitId'], 'device': device['id'], 'nodalDropV': float(drop), 'storedDropV': stored['dropV']})
assert len(rows) == sum(len(c['runs']) for c in m['installation']['circuits'])
assert len(results) == len(m['devices'])
for f in native['files'] + native['protectedFiles']:
    assert sha(f['file']) == f['sha256']
report = {'ok': True, 'method': 'Independent NumPy nodal conductance solve with constant declared lamp currents; phase and neutral independently solved. Same declared resistance model, not external physical accuracy certification.', 'circuits': len(m['circuits']), 'loads': len(results), 'csvRuns': len(rows), 'results': results, 'numpy': np.__version__, 'professionalApproval': False, 'actualAiAcceptance': False}
with (root / 'independent-installation-check.json').open('x', encoding='utf-8') as stream:
    json.dump(report, stream, ensure_ascii=False, indent=2)
print(json.dumps({k: v for k, v in report.items() if k != 'results'}))
