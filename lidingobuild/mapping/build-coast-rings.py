"""One sea, one ring: unite the traced plates into the geometry the model draws.

trace-coast.py measures the Baltic as five laser-flat plates - two in the 1 m
window and three in the 2 m context window - all at the same measured 0.100 m
RH 2000. The model today draws 9.90 ha of it, three fragments clipped to the
2,048 m terrain window with a straight chord where the clip cut open water, and
the model's own record says so (clipBoundaryIsShore: false).

Handing all five plates to the model would be worse, not better. Ribbingsfors
wrote the rule down: TWO WATER RINGS AT ONE LEVEL OVER THE SAME WATER ARE A
Z-FIGHT, NOT A BELT AND BRACES - the engine draws a sheet per ring and two
sheets a centimetre apart fight at any distance. So the plates are united here,
in the data, and the finer record wins where the two overlap.

Islands are NOT subtracted, and that is a measured decision rather than a
shortcut. The v2 bed carve skips any sample more than 0.5 m above the water
(`legacyHeight > level + surfaceToleranceMetres`), so an island that stands
clear of the sea stands in the render. Eight of the ten traced islands have a
median 0.76-2.75 m and a maximum 3.24-13.27 m above the level and are safe; two
islets of 612 and 700 m2, median 0.20 and 0.41 m, sit inside that tolerance and
will be flattened. They are named below rather than left to be discovered.

  python3 lidingobuild/mapping/build-coast-rings.py [--check]
"""
import json
import sys
from pathlib import Path

from shapely.geometry import Polygon, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
MAP = ROOT / 'lidingobuild/mapping'
OUT = MAP / 'coast-rings.geojson'
CHECK = '--check' in sys.argv

coast = json.loads((MAP / 'coast-2025.json').read_text(encoding='utf8'))
plates = coast['tracedShoreline']['fine1m'] + coast['tracedShoreline']['context2m']
levels = {p['measuredLevelRH2000'] for p in plates}
assert len(levels) == 1, f'the plates do not share one level: {levels}'
LEVEL = levels.pop()

# the finer record wins where two plates overlap: union in order, finest last,
# so its boundary is the one that survives the merge
polygons = []
for plate in sorted(plates, key=lambda p: -p['sampleSpacingMetres']):
    ring = Polygon(plate['ringEpsg3006'])
    if not ring.is_valid:
        ring = ring.buffer(0)
    polygons.append((plate, ring))
united = unary_union([r for _, r in polygons])
parts = sorted(getattr(united, 'geoms', [united]), key=lambda g: -g.area)

islands = coast['islands']['fine1m'] + coast['islands']['context2m']
CARVE_TOLERANCE = 0.5      # v2-water-bed.mjs surfaceToleranceMetres
at_risk = [i for i in islands if i['maximumHeightRH2000'] <= LEVEL + CARVE_TOLERANCE
           or i['medianHeightRH2000'] <= LEVEL + CARVE_TOLERANCE]

features = []
for index, part in enumerate(parts):
    if part.area < 1000:
        continue
    exterior = [[round(x, 3), round(y, 3)] for x, y in part.exterior.coords]
    contributing = [p['id'] for p, r in polygons if r.intersects(part.buffer(-1))]
    features.append({
        'type': 'Feature',
        'id': f'lidingo-sea-united-{index + 1}',
        'properties': {
            'waterKind': 'sea', 'heightRH2000': LEVEL,
            'sourceId': 'coast-2025-laser-plate',
            'unitedFromPlates': contributing,
            'areaSquareMetres': round(part.area, 1),
            'interiorRingsDiscarded': len(part.interiors),
            'clipBoundaryIsShore': False,
            'method': ('laser-flat plates at one measured level, united so the engine draws ONE sheet over one '
                       'body; the finer 1 m trace wins where it overlaps the 2 m context trace'),
            'reviewStatus': 'machine-measured; no independent human survey',
            'notSurveyed': True,
            'licence': coast['shapeRecord']['licence'],
            'attribution': coast['shapeRecord']['attribution'],
        },
        'geometry': mapping(Polygon(exterior)),
    })

doc = {
    'type': 'FeatureCollection',
    'name': 'Lidingo united sea rings from the laser plates',
    'crs': {'type': 'name', 'properties': {'name': 'EPSG:3006'}},
    'coordinateOrder': ['easting', 'northing'],
    'verticalCrs': 'EPSG:5613',
    'measuredOn': '2026-09-08',
    'generator': 'lidingobuild/mapping/build-coast-rings.py',
    'measuredLevelRH2000': LEVEL,
    'supersedes': {
        'sourceFid': 14,
        'statement': ('the three coastal-water fragments the model builds from the break geometry are the SAME '
                      'water at the same level, clipped to the 2,048 m terrain window. They are replaced, not '
                      'joined: one body, one ring.'),
        'areaBeforeSquareMetres': 99000,
    },
    'isSeaFlag': {
        'value': False,
        'reason': ("isSea is not a description of a lake, it is an instruction about the WHOLE WORLD: the "
                   "engine answers it by laying one plane across the entire heightfield, on the assumption - "
                   "true only of an unbounded ocean - that everything below that line is water. At Angso that "
                   "drowned the mainland. This ring is real sea but it STOPS at the 4,096 m acquisition edge, "
                   "so the assumption does not hold for it. Each ring draws its own sheet regardless, which is "
                   "what actually makes water visible; the whole-world flag stays off until someone can look "
                   "at it on a real GPU."),
    },
    'islandsNotSubtracted': {
        'count': len(islands),
        'reason': ('the v2 bed carve skips any sample more than surfaceToleranceMetres (0.5 m) above the water '
                   'level, so an island that stands clear of the sea stands in the render'),
        'atRiskOfBeingFlattened': [{'areaSquareMetres': i['areaSquareMetres'],
                                    'medianHeightRH2000': i['medianHeightRH2000'],
                                    'maximumHeightRH2000': i['maximumHeightRH2000'],
                                    'bboxEpsg3006': i['bboxEpsg3006']} for i in at_risk],
    },
    'features': features,
}

print(f'united {len(plates)} plates at {LEVEL} m RH 2000 -> {len(features)} ring(s)')
for f in features:
    print(f"  {f['id']:26} {f['properties']['areaSquareMetres'] / 10000:8.2f} ha  "
          f"{len(f['geometry']['coordinates'][0])} vertices  from {f['properties']['unitedFromPlates']}"
          + (f"  ({f['properties']['interiorRingsDiscarded']} interior ring(s) discarded)"
             if f['properties']['interiorRingsDiscarded'] else ''))
print(f'  islands at risk of the carve: {len(at_risk)} of {len(islands)}'
      + (f" ({', '.join(str(i['areaSquareMetres']) + ' m2' for i in at_risk)})" if at_risk else ''))

if not CHECK:
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print('wrote', OUT.relative_to(ROOT))
