"""Measure the outline of a bunker that only the newest capture can see.

Two bunkers on this course are newer than every record the model was built
from: date-course-changes.py brackets both to between the 2019 orthophoto and
the 2025-05-31 Lantmäteriet flight, and the club's own course council reports
building both. Hole 17's already has a mapped ring, correctly traced from the
ground it now occupies. Hole 13's has nothing at all - the hole carries zero
bunkers.

This grows the sand component from the site the dating measured and contours
it, in EPSG:3006, from the capture that can see it. It is not a hand trace: the
outline is where this capture's own sand rule stops, and the rule's thresholds
are the ones detect-bunkers measured on this same capture against the forty
bunkers already mapped.

  python3 lidingobuild/mapping/trace-2025-bunkers.py [--write]
"""
import json, sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as nd

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parents[2]
STEP = 0.1                      # finer than the capture, so the contour is not stair-stepped by the grid
HALF = 25.0                     # a bunker is metres across; this box cannot reach the next one

meta = json.loads((ROOT / 'geo_data/course-v2/lidingo/discovery/lm-ortofoto-0p16.json').read_text())
image = np.asarray(Image.open(ROOT / meta['path']).convert('RGB'))
world = [float(x) for x in (ROOT / meta['worldfilePath']).read_text().split()]
detection = json.loads((ROOT / 'lidingobuild/mapping/bunker-detection.json').read_text())
rule = next(c for c in detection['captures'] if c['capture'] == 'lm-2025')['rule']
dating = json.loads((ROOT / 'lidingobuild/mapping/change-dating.json').read_text())

SITES = [
    {'id': 'lidingo-bunker-13-green-lm2025', 'hole': 13, 'site': 'hole-13-green-bunker',
     'note': 'the left green bunker the club reports building; the hole carried no bunker at all'},
]


def contour(mask, easts, norths):
    """The boundary of the component, walked as a ring of world coordinates.

    marching squares would be neater; this takes the boundary CELLS and orders
    them by angle about the centroid, which is exact enough for a convex-ish
    bunker at a tenth of a metre and has no dependency."""
    edge = mask & ~nd.binary_erosion(mask, np.ones((3, 3), bool))
    ys, xs = np.nonzero(edge)
    e, n = easts[xs], norths[ys]
    cx, cy = e.mean(), n.mean()
    order = np.argsort(np.arctan2(n - cy, e - cx))
    ring = [[round(float(e[i]), 3), round(float(n[i]), 3)] for i in order]
    # thin to ~0.5 m so the ring is a boundary and not a pixel dump
    thinned = [ring[0]]
    for point in ring[1:]:
        if np.hypot(point[0] - thinned[-1][0], point[1] - thinned[-1][1]) >= 0.5:
            thinned.append(point)
    thinned.append(thinned[0])
    return thinned


out = {'schemaVersion': 1, 'measuredOn': '2026-09-08', 'state': 'measured-candidate-geometry',
       'generator': 'lidingobuild/mapping/trace-2025-bunkers.py',
       'sourceCapture': {'id': 'lm-ortofoto-0p16', 'captureDate': meta['captureDate'],
                         'sha256': meta['sha256'], 'licence': meta['licence']['id'],
                         'attribution': meta['licence']['attribution']},
       'horizontalCrs': 'EPSG:3006', 'rule': rule, 'features': []}

for spec in SITES:
    site = next(s for s in dating['sites'] if s['id'] == spec['site'])
    easts = np.arange(site['easting'] - HALF, site['easting'] + HALF, STEP)
    norths = np.arange(site['northing'] + HALF, site['northing'] - HALF, -STEP)
    EE, NN = np.meshgrid(easts, norths)
    c = np.clip(np.round((EE - world[4]) / world[0]).astype(np.int32), 0, image.shape[1] - 1)
    r = np.clip(np.round((NN - world[5]) / world[3]).astype(np.int32), 0, image.shape[0] - 1)
    px = image[r, c].astype(np.float32)
    R, G, B = px[..., 0], px[..., 1], px[..., 2]
    sand = ((0.299 * R + 0.587 * G + 0.114 * B >= rule['sandLuminanceMinimum'])
            & (2 * G - R - B <= rule['sandExcessGreenMaximum'])
            & (R / np.maximum(G, 1) >= rule['sandRedOverGreenMinimum']))
    sand = nd.binary_closing(sand, np.ones((5, 5), bool))
    sand = nd.binary_fill_holes(sand)
    labels, count = nd.label(sand, structure=np.ones((3, 3), bool))
    if not count:
        raise SystemExit(f"{spec['id']}: this capture reads no sand at the dated site")
    # the component containing the dated site, not the biggest one in the box
    ci = int(round((site['easting'] - easts[0]) / STEP))
    ri = int(round((norths[0] - site['northing']) / STEP))
    chosen = labels[ri, ci]
    if chosen == 0:
        sizes = nd.sum(sand, labels, range(1, count + 1))
        chosen = int(np.argmax(sizes)) + 1
    mask = labels == chosen
    ring = contour(mask, easts, norths)
    area = float(mask.sum()) * STEP * STEP
    out['features'].append({
        'id': spec['id'], 'kind': 'bunker', 'hole': spec['hole'],
        'areaSquareMetres': round(area, 1), 'vertices': len(ring) - 1, 'ring': ring,
        'method': 'measured sand component on the 2025-05-31 capture, grown from the dated site',
        'observedYear': 2025,
        'clubRecord': site['clubRecord'],
        'datingVerdict': site['verdict'],
        'datingEvidence': {name: {'luminanceAboveTurf': v['luminanceAboveTurf'],
                                  'medianExcessGreen': v['medianExcessGreen'],
                                  'readsAsSand': v['readsAsSand']}
                           for name, v in site['captures'].items()},
        'note': spec['note'],
        'reviewStatus': 'machine-measured; no independent human survey',
        'notSurveyed': True,
    })
    print(f"{spec['id']}: {area:.1f} m2, {len(ring) - 1} vertices, centre "
          f"E{np.mean([p[0] for p in ring[:-1]]):.1f} N{np.mean([p[1] for p in ring[:-1]]):.1f}")

path = ROOT / 'lidingobuild/mapping/surface-additions-2025.json'
if '--write' in sys.argv:
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(f'wrote {path.relative_to(ROOT)}')
else:
    print('(dry run; pass --write)')
