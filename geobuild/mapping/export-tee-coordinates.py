"""Export auditable tee reference coordinates, never surveyed marker claims.

Run after reconcile. EPSG coordinates use full PROJ projection, not the app's
local affine approximation. --before-ref identifies the preceding review.
"""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import subprocess

from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    return hashlib.sha256(path.read_bytes().replace(b'\r\n', b'\n')).hexdigest()


def inside(p, ring):
    x, z = p
    hit = False
    for a, b in zip(ring, ring[1:] + ring[:1]):
        if (a[1] > z) != (b[1] > z) and x < (b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]:
            hit = not hit
    return hit


def edge_distance(p, ring):
    distances = []
    for a, b in zip(ring, ring[1:] + ring[:1]):
        dx, dz = b[0]-a[0], b[1]-a[1]
        t = max(0., min(1., ((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz)))
        distances.append(math.hypot(p[0]-a[0]-t*dx, p[1]-a[1]-t*dz))
    return min(distances)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before-ref', required=True)
    parser.add_argument('--model', type=Path, default=ROOT/'geobuild/course-model.json')
    parser.add_argument('--out', type=Path, default=ROOT/'geo_data/course-v2/veckefjarden/acquisition/tee-coordinate-review.json')
    args = parser.parse_args()
    before_bytes = subprocess.run(['git', 'show', args.before_ref+':geobuild/course-model.json'],
                                  cwd=ROOT, check=True, capture_output=True).stdout
    commit = subprocess.run(['git', 'rev-parse', args.before_ref], cwd=ROOT, check=True,
                            capture_output=True, text=True).stdout.strip()
    before = json.loads(before_bytes)
    model = json.loads(args.model.read_text(encoding='utf-8'))
    ledger_path = ROOT/'geobuild/mapping/lm-ortho-review.json'
    ledger = json.loads(ledger_path.read_text(encoding='utf-8'))
    frame = {key: model[key] for key in ['origin', 'mPerLat', 'mPerLon']}
    assert frame == ledger['frame'] == {key: before[key] for key in frame}, 'Coordinate frames differ'
    project = Transformer.from_crs(4326, 3006, always_xy=True)
    inverse = Transformer.from_crs(3006, 4326, always_xy=True)
    rows = []
    labels = ['65', '61', '58', '55', '48', '40']
    for hole in model['holes']:
        previous = next(h for h in before['holes'] if h['n'] == hole['n'])
        assert hole['t'] == previous['t'], 'Scorecard changed'
        decision = next((f for f in ledger['features'] if f['hole'] == hole['n'] and f['kind'] == 'tee-set'), None)
        for index, mark in enumerate(hole['tees']['marks']):
            old = previous['tees']['marks'][index]
            x, z = mark['c']
            lon = frame['origin']['lon'] + x/frame['mPerLon']
            lat = frame['origin']['lat'] - z/frame['mPerLat']
            e, n = project.transform(lon, lat)
            inverse_lon, inverse_lat = inverse.transform(e, n)
            roundtrip = math.hypot((inverse_lon-lon)*frame['mPerLon'], (inverse_lat-lat)*frame['mPerLat'])
            assert roundtrip < 0.00001, 'Projection roundtrip exceeds numerical tolerance'
            pad_index = decision.get('referencePads', [None]*6)[index] if decision else None
            pad = hole['tees']['pads'][pad_index] if pad_index is not None else None
            if pad:
                assert inside(mark['c'], pad['ring']), 'Associated reference lies outside its reviewed deck'
                assert mark['sourceReviewId'] == decision['id'] and mark['sourcePadId'] == pad['id'], 'Association provenance mismatch'
            else:
                assert mark['c'] == old['c'], 'Unresolved reference moved without an association'
            containing = [p for p in hole['tees']['pads'] if inside(mark['c'], p['ring'])]
            rows.append(dict(hole=hole['n'], tee=labels[index], teeIndex=index,
                             cardMetres=mark['m'], localX=x, localZ=z,
                             longitude=lon, latitude=lat, eastingEPSG3006=e, northingEPSG3006=n,
                             previousLocalX=old['c'][0], previousLocalZ=old['c'][1],
                             changeMetres=math.hypot(x-old['c'][0], z-old['c'][1]),
                             association='provisional-platform' if pad else 'unresolved',
                             sourceReviewId=mark.get('sourceReviewId'), sourcePadId=mark.get('sourcePadId'),
                             associatedPadBoundaryProvenance=pad.get('prov') if pad else None,
                             associatedPadRetainedHistorical=bool(pad and pad.get('retainedHistorical')),
                             associatedPadBoundaryClearanceMetres=edge_distance(mark['c'], pad['ring']) if pad else None,
                             containingPadIds=[p.get('id') for p in containing],
                             insideSourceTracedPad=any(p.get('prov') == 'reviewed-lm-orthophoto' for p in containing),
                             projectionRoundtripMetres=roundtrip, dailyMarkerVerified=False))
    assert len(rows) == 108, 'Expected 18 holes with six references each'
    report = dict(schemaVersion=1, groundId='veckefjarden', state='passed',
                  inputs=dict(modelPath=args.model.resolve().relative_to(ROOT).as_posix(), modelSha256=digest(args.model),
                              reviewPath=ledger_path.relative_to(ROOT).as_posix(), reviewSha256=digest(ledger_path),
                              beforeCommit=commit, beforeModelSha256=hashlib.sha256(before_bytes).hexdigest()),
                  frame=frame,
                  methodology='Exact legacy inverse to WGS84 and full PROJ EPSG:4326 to EPSG:3006. Validate explicit pad identity and reference containment. Coordinate display is not evidence of daily marker location.',
                  limitations=['Platform associations remain provisional; photography does not establish tee number or daily marker position.',
                               'Unresolved coordinates are retained historical references. Do not present them as surveyed tee locations.',
                               'Native pixel spacing is 0.16 m; absolute horizontal source accuracy is not established.',
                               'The runtime uses a local affine terrain bridge; its separate audit measures that approximation.'],
                  summary=dict(references=len(rows), provisionalAssociations=sum(r['association']=='provisional-platform' for r in rows),
                               unresolved=sum(r['association']=='unresolved' for r in rows),
                               historicalPlatformAssociations=sum(r['associatedPadRetainedHistorical'] for r in rows),
                               changed=sum(r['changeMetres'] > 1e-8 for r in rows),
                               maximumChangeMetres=max(r['changeMetres'] for r in rows),
                               maximumProjectionRoundtripMetres=max(r['projectionRoundtripMetres'] for r in rows)),
                  references=rows)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False)+'\n', encoding='utf-8', newline='\n')
    with args.out.with_suffix('.csv').open('w', encoding='utf-8', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]), lineterminator='\n')
        writer.writeheader()
        for row in rows:
            writer.writerow({key: json.dumps(value) if isinstance(value, list) else value for key, value in row.items()})
    print(json.dumps(report['summary']))


if __name__ == '__main__':
    main()
