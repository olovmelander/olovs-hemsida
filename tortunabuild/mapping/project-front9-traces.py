"""Convert retained pixel observations via the exact private review grids."""
import hashlib
import json
from pathlib import Path
from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parents[2]


def read(path):
    return json.loads((ROOT / path).read_text(encoding='utf8'))


def main():
    traces = read('tortunabuild/mapping/traces-front9.json')
    indices = {kind: {v['hole']: v for v in read(f'tortunabuild/cache/mapping-review/{kind}-index.json')}
               for kind in ['green', 'tee', 'hole']}
    report = read('geo_data/course-v2/tortuna/acquisition/orthophoto-review.json')
    windows = {w['id']: w for w in report['windows']}
    features = []
    counts = {}
    for trace in traces['traces']:
        grid = indices[trace['crop']][trace['hole']]
        image = ROOT / grid['file']
        if hashlib.sha256(image.read_bytes()).hexdigest() != grid['sha256']:
            raise ValueError('Review image changed')
        west, south, east, north = grid['boundsEpsg3006']
        ring = [[round(west+x/grid['width']*(east-west), 3), round(north-y/grid['height']*(north-south), 3)]
                for x, y in trace['pixels']]
        ring.append(ring[0])
        if not Polygon(ring).is_valid or Polygon(ring).area < 5:
            raise ValueError(f"Invalid trace {trace['hole']} {trace['kind']}")
        key = (trace['hole'], trace['kind'])
        counts[key] = counts.get(key, 0) + 1
        features.append({'type': 'Feature', 'id': f'tortuna-h{key[0]:02}-{key[1]}-{counts[key]}',
                         'properties': {'kind': trace['kind'], 'hole': trace['hole'],
                                        'sourceId': 'imagery-lm-ortho', 'sourceCollection': 'orto-n2-2026',
                                        'observedYear': 2026, 'reviewedOn': '2026-09-09',
                                        'reviewer': 'assistant-visual-interpretation',
                                        'reviewStatus': 'provisional-not-human-accepted', 'notSurveyed': True,
                                        'sourceWindows': [{'id': n, 'sha256': windows[n]['sha256']} for n in grid['sourceWindows']],
                                        'reviewGrid': grid, 'tracePixels': trace['pixels'],
                                        'boundaryInterpretationUncertaintyMetres': 4 if trace.get('occlusion') else 1.5,
                                        'uncertaintyStatus': 'interpretation allowance, not measured positional accuracy',
                                        'occlusion': trace.get('occlusion'), 'terrainModified': False},
                         'geometry': {'type': 'Polygon', 'coordinates': [ring]}})
    output = {'type': 'FeatureCollection', 'crs': {'type': 'name', 'properties': {'name': 'EPSG:3006'}},
              'axisOrder': ['easting', 'northing'], 'features': features, 'limitations': traces['gaps']}
    (ROOT / 'tortunabuild/mapping/surfaces-front9.geojson').write_text(json.dumps(output, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(json.dumps({'features': len(features), 'greens': sum(f['properties']['kind']=='green' for f in features)}))


if __name__ == '__main__':
    main()
