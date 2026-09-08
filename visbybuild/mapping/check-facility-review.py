"""Check adopted image geometry against water, buildings and the committed model.

Python dependencies: Shapely and Pillow (the existing mapping toolchain).
Use --write to refresh the evidence JSON; --overlay also draws ignored source QA
images after acquire-facility-windows.py has restored the retained image grids.
"""
import hashlib
import json
import sys
from pathlib import Path
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
read = lambda p: json.loads((ROOT / p).read_text())
model = read('visbybuild/course-model.json')
geometry = read('visbybuild/mapping/geometry.json')
tees = read('visbybuild/mapping/tee-platform-review.json')
environment = read('visbybuild/mapping/environment-surfaces-review.json')
water = unary_union([Polygon(w['ring']) for w in model['water']])
buildings = unary_union([Polygon(b['ring']) for b in model['infra']['buildings']])
played_greens = unary_union([Polygon(h['green']['ring']) for h in model['holes']])
bunkers = unary_union([Polygon(b['ring']) for h in model['holes'] for b in h['bunkers']]
                      + [Polygon(b.get('ring') if isinstance(b, dict) else b) for b in model['scenery']['bunkers']])
records = []

def check(source, record, adopted, window):
    xmin, ymin, xmax, ymax = source['extentEpsg3006']
    width, height = source['imageSize']
    projected = [[xmin + u * (xmax-xmin) / width - 687748.5,
                  6370951.5 - ymax + v * (ymax-ymin) / height] for u, v in record['ringPixels']]
    assert all(abs(a-b) < 1e-8 for p, q in zip(projected, adopted) for a, b in zip(p, q))
    assert len(projected) == len(adopted)
    polygon = Polygon(projected)
    assert polygon.is_valid and polygon.area > 25, record['id']
    overlaps = {key: polygon.intersection(shape).area for key, shape in
                [('water', water), ('buildings', buildings), ('mainGreens', played_greens), ('bunkers', bunkers)]}
    assert all(area < .001 for area in overlaps.values()), (record['id'], overlaps)
    records.append({'id': record['id'], 'areaSquareMetres': round(polygon.area, 3),
                    'waterClearanceMetres': round(polygon.distance(water), 3),
                    'buildingClearanceMetres': round(polygon.distance(buildings), 3),
                    'overlapSquareMetres': overlaps})
    if '--overlay' in sys.argv:
        from PIL import Image, ImageDraw
        cache = ROOT / 'visbybuild/cache/facility-windows-2022'
        raw = cache / f'{window}.png'
        assert hashlib.sha256(raw.read_bytes()).hexdigest() == source['sha256']
        image = images.setdefault(window, Image.open(raw).convert('RGB'))
        draw = ImageDraw.Draw(image)
        draw.line([tuple(p) for p in record['ringPixels']], fill='#ffe45e', width=2)

images = {}
for entry in tees['holes']:
    source = tees['sources'][entry['sourceKey']]
    for pad in entry['additionalPads']:
        authoring = next(p for p in geometry['holes'][entry['n']-1]['tees']['pads'] if p.get('reviewId') == pad['id'])
        local = [[e-687748.5, 6370951.5-n] for e, n in authoring['ring']]
        check(source, pad, local, entry['sourceKey'])
        assert any(p['ring'] == local for p in model['holes'][entry['n']-1]['tees']['pads'])
for green in environment['greens']:
    slot = geometry['scenery']['reviewedEnvironmentGreenIndices'][green['id']]
    check(environment['source'], green, model['scenery']['greens'][slot], 'practice')
for window, image in images.items():
    import io
    buffer = io.BytesIO()
    image.save(buffer, format='PNG')
    target = ROOT / f'visbybuild/cache/facility-windows-2022/{window}-reviewed.png'
    target.write_bytes(buffer.getvalue())
all_pads = [Polygon(p['ring']) for h in model['holes'] for p in h['tees']['pads']]
assert all(a.intersection(b).area < .001 for i, a in enumerate(all_pads) for b in all_pads[i+1:])
on_turf = sum(any(Point(m['c']).within(Polygon(p['ring'])) for p in h['tees']['pads']) for h in model['holes'] for m in h['tees']['marks'])
report = {'schemaVersion': 1, 'groundId': 'visby', 'reviewedAt': '2026-09-08',
          'kind': 'source-image-geometry-check-not-rendered-acceptance',
          'newPlatforms': tees['summary']['newPlatforms'], 'totalPlatforms': len(all_pads),
          'newSceneryGreens': len(environment['greens']), 'totalSceneryGreens': len(model['scenery']['greens']),
          'cameraStartsOnObservedPlatforms': on_turf, 'totalCameraStarts': 108,
          'changedVirtualReferences': tees['summary']['movedReferences'],
          'maxCameraMoveMetres': max(tees['summary']['movesMetres']),
          'allAdoptedPolygonsValid': True, 'teePlatformsMutuallyDisjoint': True,
          'records': records,
          'limitations': ['Image interpretation and software geometry checks do not establish surveyed accuracy or current marker positions.',
                          'In-app 3D camera acceptance remains unavailable: the cloud browser could not create its WebGPU/WebGL2 context.']}
if '--write' in sys.argv:
    (ROOT / 'visbybuild/mapping/facility-validation.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({k: v for k, v in report.items() if k != 'records'}, indent=2))
