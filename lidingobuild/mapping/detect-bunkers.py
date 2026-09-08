"""Find bunkers as SAND IN A HOLLOW, and let the two captures compete.

Two independent records must agree before anything is accepted: the imagery has
to read sand, and the published 1 m laser DTM has to read a hollow under it.
Sand alone finds gravel paths, winter wear and dry rough; a hollow alone finds
every ditch and tee terrace.

The SAME rule runs on both captures, with each capture's own thresholds
measured on that capture, and the score is how many of the 40 already-mapped
bunkers it recovers. A newer or higher-resolution picture is not automatically
a better instrument: make it reproduce something nobody read off it.

  python3 lidingobuild/mapping/detect-bunkers.py [--capture esri-2026|ortho-2019]
  python3 lidingobuild/mapping/detect-bunkers.py --compare

Refusals are written down with their numbers. A measurement taken and then
ignored is worse than one never made.
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image
from pyproj import Transformer
from scipy import ndimage as nd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'lidingobuild/mapping'))
Image.MAX_IMAGE_PIXELS = None
CACHE = ROOT / 'lidingobuild/cache'

# --- the shape record: the published 1 m laser DTM ---------------------------
dtm_meta = json.loads((CACHE / 'terrain-review/review-dtm-1m.json').read_text())
dtm = np.fromfile(CACHE / 'terrain-review/review-dtm-1m.f32', dtype='<f4').reshape(dtm_meta['height'], dtm_meta['width'])
DTM_W = dtm_meta['northwestSampleCentre']['easting']
DTM_N = dtm_meta['northwestSampleCentre']['northing']
WINDOW = dtm_meta['window']

# 15 m, not 9: a bunker is ~7 m across, so a 9 m window partly follows the
# bunker itself. Measured on the 40 mapped bunkers, the interior median
# residual is -0.254 m at 9 m and -0.324 m at 15 m; past 21 m it falls away.
LOCAL_WINDOW_METRES = 15
RESIDUAL = dtm - nd.median_filter(np.nan_to_num(dtm, nan=0.0), size=LOCAL_WINDOW_METRES, mode='nearest')

# --- the two captures --------------------------------------------------------
# Each capture's thresholds are measured on that capture by calibrate-ortho.py
# and its Esri equivalent, and sit in the gap the measurement leaves.
CAPTURES = {
    'ortho-2019': {
        'label': 'Lidingö stad 2019 orthophoto (CC0), 0.5 m, leaf-off spring',
        'step': 0.5, 'sandLuminance': 118.0, 'sandExcessGreen': 29.0, 'sandRedOverGreen': None,
    },
    'esri-2026': {
        'label': 'Esri World Imagery z18, 0.30 m, leaf-on',
        'step': 0.30, 'sandLuminance': 110.0, 'sandExcessGreen': 70.0, 'sandRedOverGreen': 0.90,
    },
}
MIN_AREA, MAX_AREA = 8.0, 150.0     # the mapped rings measure 8-75 m^2
HOLLOW_CELL = 0.12                  # m below the local median, per cell
HOLLOW_MEDIAN = 0.20                # m, the component's own median
MIN_COMPACTNESS = 0.35              # 4*pi*N/E^2 over cells; a path is long and thin
MIN_LUMINANCE_MEDIAN = 110.0

_to3011 = Transformer.from_crs(3006, 3011, always_xy=True)


def read_ortho2019(EE, NN):
    img = np.asarray(Image.open(CACHE / 'municipal-ortho-2019/lidingo-2019-0p5m.png').convert('RGB')).astype(np.float32)
    w = [float(x) for x in (CACHE / 'municipal-ortho-2019/lidingo-2019-0p5m.pgw').read_text().split()]
    X, Y = _to3011.transform(EE, NN)
    c = np.clip(np.round((X - w[4]) / w[0]).astype(int), 0, img.shape[1] - 1)
    r = np.clip(np.round((Y - w[5]) / w[3]).astype(int), 0, img.shape[0] - 1)
    return img[r, c]


def read_esri(EE, NN):
    from esri_mosaic import EsriMosaic
    return EsriMosaic().sample(EE, NN)


READERS = {'ortho-2019': read_ortho2019, 'esri-2026': read_esri}


def rings_of(g):
    return [g['coordinates'][0]] if g['type'] == 'Polygon' else [p[0] for p in g['coordinates']]


def mapped_bunkers(surfaces):
    out = []
    for f in surfaces['features']:
        if f['properties']['kind'] != 'bunker':
            continue
        r = rings_of(f['geometry'])[0]
        a = cx = cy = 0.0
        for i in range(len(r) - 1):
            x0, y0 = r[i][:2]; x1, y1 = r[i + 1][:2]
            cr = x0 * y1 - x1 * y0; a += cr; cx += (x0 + x1) * cr; cy += (y0 + y1) * cr
        # 29 of the 40 are image traces and carry NO sourceFeatureId. Keying a
        # recovery score on that id collapses all 29 into one entry and reports
        # 2 of 40 while the rule is in fact finding them: the score agreed with
        # a bug, not with the data. Identity is the index.
        out.append({'index': len(out), 'id': f['properties'].get('sourceFeatureId'),
                    'hole': f['properties'].get('hole'), 'easting': cx / (3 * a),
                    'northing': cy / (3 * a), 'area': abs(a) / 2})
    return out


def run(capture):
    spec = CAPTURES[capture]
    step = spec['step']
    easts = np.arange(WINDOW['minEasting'], WINDOW['maxEasting'] + step / 2, step)
    norths = np.arange(WINDOW['maxNorthing'], WINDOW['minNorthing'] - step / 2, -step)
    EE, NN = np.meshgrid(easts, norths)
    rgb = READERS[capture](EE, NN)
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    LUM = 0.299 * R + 0.587 * G + 0.114 * B
    EXG = 2 * G - R - B
    RG = R / np.maximum(G, 1)

    row = np.clip(np.round(DTM_N - NN).astype(int), 0, dtm.shape[0] - 1)
    col = np.clip(np.round(EE - DTM_W).astype(int), 0, dtm.shape[1] - 1)
    HOLLOW = RESIDUAL[row, col]

    sand = (LUM >= spec['sandLuminance']) & (EXG <= spec['sandExcessGreen'])
    if spec['sandRedOverGreen'] is not None:
        sand &= RG >= spec['sandRedOverGreen']
    sand &= HOLLOW <= -HOLLOW_CELL
    sand = nd.binary_closing(sand, np.ones((3, 3), bool))

    surfaces = json.loads((ROOT / 'lidingobuild/mapping/playing-surfaces.geojson').read_text(encoding='utf8'))
    from scipy.spatial import cKDTree
    pts = np.array([[p[0], p[1]] for f in surfaces['features'] for r in rings_of(f['geometry']) for p in r])
    tree = cKDTree(pts)
    ys, xs = np.nonzero(sand)
    near = np.zeros(sand.shape, bool)
    if len(xs):
        d, _ = tree.query(np.stack([easts[xs], norths[ys]], axis=1), k=1)
        keep = d <= 60
        near[ys[keep], xs[keep]] = True
    sand = near

    labels, count = nd.label(sand, structure=np.ones((3, 3), bool))
    slices = nd.find_objects(labels)
    mapped = mapped_bunkers(surfaces)
    cell = step * step
    candidates = []
    for c in range(1, count + 1):
        sl = slices[c - 1]
        if sl is None:
            continue
        sub = labels[sl] == c
        sy, sx = np.nonzero(sub)
        area = len(sx) * cell
        if area < MIN_AREA or area > MAX_AREA:
            continue
        gy = sy + sl[0].start; gx = sx + sl[1].start
        ce, cn = easts[gx], norths[gy]
        centre = (float(ce.mean()), float(cn.mean()))
        edge = len(sx) - float(nd.binary_erosion(sub, np.ones((3, 3), bool)).sum())
        compactness = 4 * np.pi * len(sx) / max(edge * edge, 1e-9)
        nearest = min(((np.hypot(centre[0] - m['easting'], centre[1] - m['northing']), m['index'], m) for m in mapped))
        candidates.append({
            'centreEasting': round(centre[0], 2), 'centreNorthing': round(centre[1], 2),
            'areaSquareMetres': round(area, 1),
            'medianHollowMetres': round(float(np.median(HOLLOW[gy, gx])), 3),
            'compactness': round(float(compactness), 3),
            'medianLuminance': round(float(np.median(LUM[gy, gx])), 1),
            'medianExcessGreen': round(float(np.median(EXG[gy, gx])), 1),
            'medianRedOverGreen': round(float(np.median(RG[gy, gx])), 3),
            'nearestMappedBunkerMetres': round(float(nearest[0]), 1),
            'nearestMappedBunkerIndex': nearest[2]['index'],
            'nearestMappedBunkerHole': nearest[2]['hole'],
            'nearestMappedBunkerId': nearest[2]['id'],
        })

    def keeps(c):
        return (c['medianHollowMetres'] <= -HOLLOW_MEDIAN and c['compactness'] >= MIN_COMPACTNESS
                and c['medianLuminance'] >= MIN_LUMINANCE_MEDIAN)

    accepted = [c for c in candidates if keeps(c)]
    recovered = {}
    for c in accepted:
        if c['nearestMappedBunkerMetres'] <= 12:
            i = c['nearestMappedBunkerIndex']
            if i not in recovered or c['nearestMappedBunkerMetres'] < recovered[i]:
                recovered[i] = c['nearestMappedBunkerMetres']
    missed = [m for m in mapped if m['index'] not in recovered]
    new = sorted([c for c in accepted if c['nearestMappedBunkerMetres'] > 12], key=lambda c: -c['areaSquareMetres'])
    return {
        'capture': capture, 'captureLabel': spec['label'], 'rule': {
            'sandLuminanceMinimum': spec['sandLuminance'], 'sandExcessGreenMaximum': spec['sandExcessGreen'],
            'sandRedOverGreenMinimum': spec['sandRedOverGreen'], 'localMedianWindowMetres': LOCAL_WINDOW_METRES,
            'perCellHollowMetres': HOLLOW_CELL, 'componentMedianHollowMetres': HOLLOW_MEDIAN,
            'minimumAreaSquareMetres': MIN_AREA, 'maximumAreaSquareMetres': MAX_AREA,
            'minimumCompactness': MIN_COMPACTNESS, 'minimumMedianLuminance': MIN_LUMINANCE_MEDIAN},
        'mappedBunkers': len(mapped), 'candidates': len(candidates), 'accepted': len(accepted),
        'recoveredMappedBunkers': len(recovered),
        'recoveredMedianMetres': round(float(np.median(list(recovered.values()))), 1) if recovered else None,
        'unrecoveredMappedBunkers': [{'index': m['index'], 'hole': m['hole'],
                                      'areaSquareMetres': round(m['area'], 1)} for m in missed],
        'acceptedAwayFromMapped': new,
        'allCandidates': sorted(candidates, key=lambda c: -c['areaSquareMetres']),
    }


if __name__ == '__main__':
    argv = sys.argv[1:]
    which = list(CAPTURES) if '--compare' in argv or not argv else [argv[argv.index('--capture') + 1]]
    results = []
    for capture in which:
        r = run(capture)
        results.append(r)
        print(f"{capture:11} {r['captureLabel']}")
        print(f"            candidates {r['candidates']:4d}  accepted {r['accepted']:4d}  "
              f"recovers {r['recoveredMappedBunkers']:2d}/{r['mappedBunkers']} mapped bunkers"
              + (f" at a median {r['recoveredMedianMetres']} m" if r['recoveredMedianMetres'] else '')
              + f", {len(r['acceptedAwayFromMapped'])} accepted away from any mapped one")
    best = max(results, key=lambda r: r['recoveredMappedBunkers'])
    out = {'schemaVersion': 2, 'measuredOn': '2026-09-08', 'state': 'measurement-evidence-only',
           'generator': 'lidingobuild/mapping/detect-bunkers.py',
           'method': 'sand in the imagery over a hollow in the published 1 m laser DTM; the score is recovery of the 40 already-mapped bunkers, which never entered either rule',
           'chosenCapture': best['capture'] if len(results) > 1 else results[0]['capture'],
           'captures': results}
    (ROOT / 'lidingobuild/mapping/bunker-detection.json').write_text(json.dumps(out, indent=2) + '\n', encoding='utf8')
    print('wrote lidingobuild/mapping/bunker-detection.json')
