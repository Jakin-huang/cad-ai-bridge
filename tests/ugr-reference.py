"""Independent scalar Appendix A arithmetic and finite-source vertical-eye integral.
Usage: python tests/ugr-reference.py MODEL.json METHOD.json UGR-DIRECTORY NEW-RESULT.json
Only downward rectangular Type C test sources in meters are supported here.
This checks the declared uniform-opening model, not actual product luminance.
"""
import bisect
import hashlib
import json
import math
import sys
from pathlib import Path
import numpy as np

model_file, method_file, folder, output = map(Path, sys.argv[1:5])
model, method = [json.loads(f.read_text(encoding='utf8')) for f in [model_file, method_file]]
report = json.loads((folder/'report.json').read_text(encoding='utf8'))
if report['profileSHA256'] != hashlib.sha256(method_file.read_bytes()).hexdigest():
    raise ValueError('Method identity mismatch')

def photometry(fixture):
    file = Path(fixture['iesFile']['file'])
    if hashlib.sha256(file.read_bytes()).hexdigest() != fixture['iesFile']['sha256']:
        raise ValueError('Source changed')
    lines = file.read_text(encoding='utf8').splitlines()
    start = next(i for i, line in enumerate(lines) if line.strip() == 'TILT=NONE')
    a = [float(s) for line in lines[start+1:] for s in line.split()]
    nv, nh = int(a[3]), int(a[4])
    if a[5:7] != [1, 2] or a[9] != 0:
        raise ValueError('Independent fixture scope requires Type C meters flat rectangle')
    return dict(area=a[7]*a[8], width=a[7], length=a[8], angles=a[13:13+nv],
                horizontal=np.array(a[13+nv:13+nv+nh]),
                intensity=np.array(a[13+nv+nh:]).reshape(nh, nv)*a[2])

def candela(p, gamma, c):
    gamma, c = np.broadcast_arrays(gamma, c)
    c = np.mod(c, 360)
    last = p['horizontal'][-1]
    if last == 0:
        return np.interp(gamma, p['angles'], p['intensity'][0], left=0, right=0)
    if last == 90:
        c = np.where(c > 180, 360-c, c)
        c = np.where(c > 90, 180-c, c)
    elif last == 180:
        c = np.where(c > 180, 360-c, c)
    hi = np.clip(np.searchsorted(p['horizontal'], c, side='right'), 1, len(p['horizontal'])-1)
    lo = hi-1
    weight = (c-p['horizontal'][lo])/(p['horizontal'][hi]-p['horizontal'][lo])
    # Interpolate each angular row independently, then select the two C rows.
    rows = np.array([np.interp(gamma, p['angles'], row, left=0, right=0) for row in p['intensity']])
    below = np.take_along_axis(rows, lo[None, ...], axis=0)[0]
    above = np.take_along_axis(rows, hi[None, ...], axis=0)[0]
    return below+(above-below)*weight

def position_index(y, z):
    table = method['positionIndex']
    def bracket(axis, v):
        if v < axis[0]-1e-9 or v > axis[-1]+1e-9:
            raise ValueError('Outside table')
        for i, a in enumerate(axis):
            if abs(v-a) < 1e-9:
                return [i]
        j = bisect.bisect_right(axis, v)
        return [j-1, j]
    cells = [table['values'][i][j] for i in bracket(table['lateralRatios'], y)
             for j in bracket(table['elevationRatios'], z)]
    if None in cells:
        raise ValueError('Unresolved dash')
    return min(cells)

photos = {f['id']: photometry(f) for f in model['input']['luminaires']}
fixtures = {f['id']: f for f in model['input']['luminaires']}
records = []
for room_result in report['rooms']:
    room = next(r for r in model['input']['rooms'] if r['id'] == room_result['roomId'])
    devices = [d for d in model['devices'] if d['roomId'] == room['id']]
    for obs in room_result['observers']:
        if obs['issues']:
            raise ValueError('Unsupported observer retained, no numerical acceptance')
        eye = np.array(obs['observer']['positionM'])
        view = np.array(obs['observer']['direction']+[0])
        edges = dict(WALL_X_MIN=[0, 3], WALL_X_MAX=[1, 2], WALL_Y_MIN=[0, 1], WALL_Y_MAX=[3, 2])
        i, j = edges[obs['observer']['id']]
        expected_xy = (np.array(room['polygon'][i])+np.array(room['polygon'][j]))/2000
        condition = next(r for r in model['input']['glareAssessment']['rooms'] if r['roomId'] == room['id'])
        expected_z = 1.2 if condition['posture'] == 'seated' else 1.5
        towards = np.mean(np.array(room['polygon'])/1000, axis=0)-expected_xy
        towards /= np.linalg.norm(towards)
        if not np.allclose(eye, [*expected_xy, expected_z], atol=1e-10, rtol=0) or not np.allclose(view, [*towards, 0], atol=1e-10, rtol=0):
            raise ValueError('Independent wall-midpoint observer frame mismatch')
        terms, finite_direct = [], 0.
        for d in devices:
            p = photos[d['fixture']]
            center = np.array([v/1000 for v in d['position']]+[d['mountingHeightM']])
            delta = center-eye
            distance = float(np.linalg.norm(delta))
            forward = float(np.dot(delta, view))
            lateral = abs(delta[0]*view[1]-delta[1]*view[0])
            gamma = math.degrees(math.acos(delta[2]/distance))
            rotation = fixtures[d['fixture']].get('rotationDegrees', 0)
            intensity = float(candela(p, gamma, math.degrees(math.atan2(-delta[1], -delta[0]))-rotation))
            projected = p['area']*delta[2]/distance
            luminance = intensity/projected
            omega = projected/distance**2
            index = position_index(lateral/forward, delta[2]/forward)
            term = luminance**2*omega/index**2
            stored = next(s for s in obs['sources'] if s['id'] == d['id'])
            if not math.isclose(term, stored['term'], rel_tol=1e-10, abs_tol=1e-7):
                raise ValueError('Independent formula term mismatch')
            terms.append(term)
            # Midpoint area quadrature: I(theta)/(S*cos(theta)) times projected
            # source solid angle. The two source-cosine factors cancel.
            n = 160
            x = (np.arange(n)+.5)/n*p['length']-p['length']/2
            y = (np.arange(n)+.5)/n*p['width']-p['width']/2
            xx, yy = np.meshgrid(x, y)
            angle = math.radians(fixtures[d['fixture']].get('rotationDegrees', 0))
            dx = delta[0]+xx*math.cos(angle)-yy*math.sin(angle)
            dy = delta[1]+xx*math.sin(angle)+yy*math.cos(angle)
            # ies2rad's zero-height rectangle is represented by a 0.5mm slab.
            dz = delta[2]-.00025
            rr = np.sqrt(dx*dx+dy*dy+dz*dz)
            intensity_grid = candela(p, np.degrees(np.arccos(dz/rr)), np.degrees(np.arctan2(-dy, -dx))-rotation)
            eye_cos = np.maximum(0, (dx*view[0]+dy*view[1])/rr)
            finite_direct += float(np.mean(intensity_grid*eye_cos/(rr*rr)))
        ratings = []
        for setting in ['medium', 'fine']:
            indirect = obs['eyeLux'][setting]-obs['eyeLux']['direct']
            rating = 8*math.log10(.25*sum(terms)/(indirect/math.pi))
            ratings.append(rating)
        if abs(max(ratings)-obs['result']['conservativeUgr']) > 1e-9:
            raise ValueError('Independent UGR mismatch')
        measured = obs['eyeLux']['direct']
        error = abs(finite_direct-measured)
        if error > .1+.002*finite_direct:
            raise ValueError('Independent vertical illuminance integral mismatch: '+str((finite_direct, measured)))
        records.append(dict(roomId=room['id'], observer=obs['observer']['id'], ugr=max(ratings),
                            independentDirectEyeLux=finite_direct, radianceDirectEyeLux=measured,
                            absoluteDifferenceLux=error, relativeDifference=error/finite_direct))
result = dict(ok=True, observers=records, integrationSamplesPerSource=25600,
              tolerance='.1 lx + 0.2% of quadrature prediction',
              scope='Independent arithmetic and finite-opening direct vertical irradiance, not diffuse background or actual product approval')
with output.open('x', encoding='utf8') as stream:
    json.dump(result, stream, ensure_ascii=False, indent=2)
print(json.dumps(result))
