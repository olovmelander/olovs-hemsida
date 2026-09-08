"""Find bunkers as SAND IN A HOLLOW, and let the two captures compete.

Two independent records must agree before anything is accepted: the imagery has
to read sand, and the published 1 m laser DTM has to read a hollow under it.
Sand alone finds gravel paths, winter wear and dry rough; a hollow alone finds
every ditch and tee terrace.

THE RULE HAS A BLIND SPOT AND IT IS A DATED ONE. The imagery is 2025-05-31 and
the laser is 2021-03-23, so a bunker BUILT BETWEEN THEM has sand and no hollow,
and this rule cannot see it by construction. Hole 13 is the proof: the club's
course council reports building a left green bunker there, the model carries no
bunker on the hole at all, the 2025 capture plainly shows one below the green -
and this detector does not flag it, because in 2021 the ground was still flat.
So sand that fails only the hollow test is REPORTED, not dropped, as
`sandWithoutHollow`. It is a candidate list, not an adoption: what would make
one of those two records is the club's own dated statement that a bunker was
built there, and that has to be read hole by hole.

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
    'lm-2025': {'label': 'Lantmäteriet Ortofoto 0.16 m, captured 2025-05-31, leaf-on (CC BY 4.0, Min karta)'},
    'municipal-2018': {'label': 'Lidingö stad 2018 orthophoto, 0.16 m native, LEAF-ON summer (CC0)'},
    'municipal-2019': {'label': 'Lidingö stad 2019 orthophoto, 0.16 m native, leaf-off spring (CC0)'},
    'ortho-2019': {'label': 'Lidingö stad 2019 orthophoto resampled to 0.5 m, leaf-off spring (CC0)'},
    'esri-2026': {'label': 'Esri World Imagery z18, 0.30 m, leaf-on, capture 2025-05-19'},
}
# ONE analysis grid for every capture, so what the comparison measures is the
# capture's own separation of sand from turf and not the grid it was resampled
# onto. 0.25 m is finer than the 0.5 m frame and coarser than the 0.16 m one;
# a bunker is metres across, so nothing is lost, and a 0.16 m grid over this
# window is 64 million cells and does not fit in memory as float.
ANALYSIS_STEP = 0.25
BLOCK_ROWS = 512                    # the window is read a band at a time
# Every one of these comes from the 40 mapped bunkers' own measured spread, and
# the loose ones are loose on purpose: the per-cell test already required BOTH
# sand colour and a hollow, so a component gate that also re-litigates them
# just throws away bunkers. Measured per mapped bunker on the 2025 capture,
# 35 of 40 read sand over half their interior, 33 of 40 sit in a hollow over
# half of it, and 31 of 40 do both - and the first cut of these gates, tuned on
# a capture where sand and turf barely separated at all, then reduced that 31
# to 8. The score below is what says whether a gate is earning its place.
MIN_AREA, MAX_AREA = 8.0, 250.0     # the mapped rings measure 16-75 m^2
HOLLOW_CELL = 0.12                  # m below the local 15 m median, per cell
HOLLOW_MEDIAN = 0.12                # the component's own median, same rule
MIN_COMPACTNESS = 0.25              # 4*pi*N/E^2 over cells; a path is long and thin
MIN_LUMINANCE_MEDIAN = 110.0        # the mapped bunkers that read sand run 146-200

_to3011 = Transformer.from_crs(3006, 3011, always_xy=True)


_sources = {}


def read_ortho2019(EE, NN):
    if 'ortho2019' not in _sources:
        _sources['ortho2019'] = (
            np.asarray(Image.open(CACHE / 'municipal-ortho-2019/lidingo-2019-0p5m.png').convert('RGB')),
            [float(x) for x in (CACHE / 'municipal-ortho-2019/lidingo-2019-0p5m.pgw').read_text().split()])
    img, w = _sources['ortho2019']
    X, Y = _to3011.transform(EE, NN)
    c = np.clip(np.round((X - w[4]) / w[0]).astype(np.int32), 0, img.shape[1] - 1)
    r = np.clip(np.round((Y - w[5]) / w[3]).astype(np.int32), 0, img.shape[0] - 1)
    return img[r, c]


def read_esri(EE, NN):
    if 'esri' not in _sources:
        from esri_mosaic import EsriMosaic
        _sources['esri'] = EsriMosaic()
    return _sources['esri'].sample(EE, NN)


def read_lm2025(EE, NN):
    if 'lm2025' not in _sources:
        meta = json.loads((ROOT / 'geo_data/course-v2/lidingo/discovery/lm-ortofoto-0p16.json').read_text())
        _sources['lm2025'] = (np.asarray(Image.open(ROOT / meta['path']).convert('RGB')),
                              [float(x) for x in (ROOT / meta['worldfilePath']).read_text().split()])
    img, w = _sources['lm2025']
    # already EPSG:3006, so pixel <-> world is the worldfile alone
    c = np.clip(np.round((EE - w[4]) / w[0]).astype(np.int32), 0, img.shape[1] - 1)
    r = np.clip(np.round((NN - w[5]) / w[3]).astype(np.int32), 0, img.shape[0] - 1)
    return img[r, c]


def _municipal(year):
    """A Lidingö stad capture at its NATIVE 0.16 m, requested in EPSG:3011.

    The 0.5 m snapshot this build has always used is a request parameter and
    not the source: the service's native spacing measures about 0.16 m, so
    every conclusion drawn from the 0.5 m export understated it. And 2018
    exists, which nothing here knew: same service, same CC0 dedication, and
    LEAF-ON summer where 2019 is dormant spring."""
    key = f'municipal{year}'
    def read(EE, NN):
        if key not in _sources:
            meta = json.loads((ROOT / f'geo_data/course-v2/lidingo/discovery/municipal-ortho-{year}-native.json').read_text())
            _sources[key] = (np.asarray(Image.open(ROOT / meta['path']).convert('RGB')),
                             [float(x) for x in (ROOT / meta['worldfilePath']).read_text().split()])
        img, w = _sources[key]
        X, Y = _to3011.transform(EE, NN)
        c = np.clip(np.round((X - w[4]) / w[0]).astype(np.int32), 0, img.shape[1] - 1)
        r = np.clip(np.round((Y - w[5]) / w[3]).astype(np.int32), 0, img.shape[0] - 1)
        return img[r, c]
    return read


READERS = {'lm-2025': read_lm2025, 'municipal-2018': _municipal(2018), 'municipal-2019': _municipal(2019),
           'ortho-2019': read_ortho2019, 'esri-2026': read_esri}


def calibrate(sample, mapped_rings, turf_rings):
    """Put each threshold in the gap this capture's OWN pixels leave.

    A threshold copied between captures is a threshold calibrated on another
    day's light, and the three captures here differ by more than resolution:
    one is dormant spring, two are high summer. So sand and mown turf are
    sampled inside rings that were mapped without reference to any of them, and
    the cut goes midway between sand's low tail and turf's high tail. The gap
    itself is reported, because a NEGATIVE gap means the distributions overlap
    and no threshold exists - which is the honest answer for one of the three."""
    sand = np.concatenate([sample(e, n).astype(np.float32) for e, n in mapped_rings if len(e)])
    turf = np.concatenate([sample(e, n).astype(np.float32) for e, n in turf_rings if len(e)])
    def idx(a):
        R, G, B = a[..., 0], a[..., 1], a[..., 2]
        return 0.299 * R + 0.587 * G + 0.114 * B, 2 * G - R - B, R / np.maximum(G, 1)
    s_lum, s_exg, s_rg = idx(sand)
    t_lum, t_exg, t_rg = idx(turf)
    lum_gap = float(np.percentile(s_lum, 20) - np.percentile(t_lum, 90))
    exg_gap = float(np.percentile(t_exg, 10) - np.percentile(s_exg, 80))
    return {
        'sandLuminance': float((np.percentile(s_lum, 20) + np.percentile(t_lum, 90)) / 2),
        'sandExcessGreen': float((np.percentile(s_exg, 80) + np.percentile(t_exg, 10)) / 2),
        'sandRedOverGreen': float((np.percentile(s_rg, 20) + np.percentile(t_rg, 90)) / 2),
        'luminanceGap': round(lum_gap, 1), 'excessGreenGap': round(exg_gap, 1),
        'sandPixels': int(len(sand)), 'turfPixels': int(len(turf)),
        'sandLuminancePercentiles': [round(float(np.percentile(s_lum, q)), 1) for q in (20, 50, 80)],
        'turfLuminancePercentiles': [round(float(np.percentile(t_lum, q)), 1) for q in (10, 50, 90)],
    }


def rings_of(g):
    return [g['coordinates'][0]] if g['type'] == 'Polygon' else [p[0] for p in g['coordinates']]


def mapped_bunkers(surfaces):
    out = []
    for f in surfaces['features']:
        if f['properties']['kind'] != 'bunker':
            continue
        r = rings_of(f['geometry'])[0]
        # about the FIRST VERTEX, never about the EPSG:3006 origin: a bunker's
        # raw cross products are ~4.6e12 and sum to ~-90, so the centroid is the
        # ninth significant figure of a double. Measured before this line, the
        # 40 bunker centroids were out by a median 20.6 m and 36 of them fell
        # outside their own bounding box - which is what made this detector look
        # like it could not find bunkers it was in fact sitting on top of.
        ox, oy = r[0][0], r[0][1]
        a = cx = cy = 0.0
        for i in range(len(r) - 1):
            x0, y0 = r[i][0] - ox, r[i][1] - oy
            x1, y1 = r[i + 1][0] - ox, r[i + 1][1] - oy
            cr = x0 * y1 - x1 * y0; a += cr; cx += (x0 + x1) * cr; cy += (y0 + y1) * cr
        # 29 of the 40 are image traces and carry NO sourceFeatureId. Keying a
        # recovery score on that id collapses all 29 into one entry and reports
        # 2 of 40 while the rule is in fact finding them: the score agreed with
        # a bug, not with the data. Identity is the index.
        out.append({'index': len(out), 'id': f['properties'].get('sourceFeatureId'),
                    'hole': f['properties'].get('hole'), 'easting': ox + cx / (3 * a),
                    'northing': oy + cy / (3 * a), 'area': abs(a) / 2})
    return out


def ring_interior(ring, shrink=0.75, step=0.25):
    xs = np.array([p[0] for p in ring]); ys = np.array([p[1] for p in ring])
    cx, cy = xs.mean(), ys.mean()
    xs = cx + (xs - cx) * shrink; ys = cy + (ys - cy) * shrink
    if xs.max() - xs.min() < 1 or ys.max() - ys.min() < 1:
        return np.array([]), np.array([])
    ge, gn = np.meshgrid(np.arange(xs.min(), xs.max(), step), np.arange(ys.min(), ys.max(), step))
    inside = np.zeros(ge.shape, bool)
    for i in range(len(xs) - 1):
        ax, ay, bx, by = xs[i], ys[i], xs[i + 1], ys[i + 1]
        with np.errstate(divide='ignore', invalid='ignore'):
            inside ^= ((ay > gn) != (by > gn)) & (ge < ax + (gn - ay) * (bx - ax) / np.where(by == ay, 1e-9, by - ay))
    return ge[inside], gn[inside]


def run(capture):
    spec = CAPTURES[capture]
    step = ANALYSIS_STEP
    easts = np.arange(WINDOW['minEasting'], WINDOW['maxEasting'] + step / 2, step)
    norths = np.arange(WINDOW['maxNorthing'], WINDOW['minNorthing'] - step / 2, -step)
    reader = READERS[capture]

    surfaces = json.loads((ROOT / 'lidingobuild/mapping/playing-surfaces.geojson').read_text(encoding='utf8'))
    cal = calibrate(
        reader,
        [ring_interior(rings_of(f['geometry'])[0]) for f in surfaces['features'] if f['properties']['kind'] == 'bunker'],
        [ring_interior(r) for f in surfaces['features'] if f['properties']['kind'] in ('green', 'fairway', 'tee')
         for r in rings_of(f['geometry'])])

    from scipy.spatial import cKDTree
    tree = cKDTree(np.array([[p[0], p[1]] for f in surfaces['features']
                             for r in rings_of(f['geometry']) for p in r]))

    sand = np.zeros((len(norths), len(easts)), bool)
    lum_all = np.zeros(sand.shape, np.float32)
    exg_all = np.zeros(sand.shape, np.float32)
    rg_all = np.zeros(sand.shape, np.float32)
    hollow_all = np.zeros(sand.shape, np.float32)
    for y0 in range(0, len(norths), BLOCK_ROWS):
        y1 = min(y0 + BLOCK_ROWS, len(norths))
        EE, NN = np.meshgrid(easts, norths[y0:y1])
        rgb = reader(EE, NN).astype(np.float32)
        R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        lum = 0.299 * R + 0.587 * G + 0.114 * B
        exg = 2 * G - R - B
        rg = R / np.maximum(G, 1)
        row = np.clip(np.round(DTM_N - NN).astype(np.int32), 0, dtm.shape[0] - 1)
        col = np.clip(np.round(EE - DTM_W).astype(np.int32), 0, dtm.shape[1] - 1)
        hollow = RESIDUAL[row, col]
        block = ((lum >= cal['sandLuminance']) & (exg <= cal['sandExcessGreen'])
                 & (rg >= cal['sandRedOverGreen']) & (hollow <= -HOLLOW_CELL))
        # keep it on the course: within 60 m of a mapped playing surface
        ys, xs = np.nonzero(block)
        if len(xs):
            d, _ = tree.query(np.stack([easts[xs], norths[y0 + ys]], axis=1), k=1)
            block[:] = False
            keep = d <= 60
            block[ys[keep], xs[keep]] = True
        sand[y0:y1] = block
        lum_all[y0:y1] = lum; exg_all[y0:y1] = exg; rg_all[y0:y1] = rg; hollow_all[y0:y1] = hollow
        del EE, NN, rgb, R, G, B, lum, exg, rg, hollow, row, col

    sand = nd.binary_closing(sand, np.ones((3, 3), bool))
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
        centre = (float(easts[gx].mean()), float(norths[gy].mean()))
        edge = len(sx) - float(nd.binary_erosion(sub, np.ones((3, 3), bool)).sum())
        compactness = 4 * np.pi * len(sx) / max(edge * edge, 1e-9)
        nearest = min(((np.hypot(centre[0] - m['easting'], centre[1] - m['northing']), m['index'], m) for m in mapped))
        candidates.append({
            'centreEasting': round(centre[0], 2), 'centreNorthing': round(centre[1], 2),
            'areaSquareMetres': round(area, 1),
            'medianHollowMetres': round(float(np.median(hollow_all[gy, gx])), 3),
            'compactness': round(float(compactness), 3),
            'medianLuminance': round(float(np.median(lum_all[gy, gx])), 1),
            'medianExcessGreen': round(float(np.median(exg_all[gy, gx])), 1),
            'medianRedOverGreen': round(float(np.median(rg_all[gy, gx])), 3),
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
    # THE DATED BLIND SPOT: sand with no hollow under it. Same colour rule, same
    # size and shape gates, but the terrain test dropped. A bunker built after
    # the 2021 laser lives here and nowhere else.
    colour_only = np.zeros(sand.shape, bool)
    for y0 in range(0, len(norths), BLOCK_ROWS):
        y1 = min(y0 + BLOCK_ROWS, len(norths))
        EE, NN = np.meshgrid(easts, norths[y0:y1])
        rgb = reader(EE, NN).astype(np.float32)
        R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        lum = 0.299 * R + 0.587 * G + 0.114 * B
        exg = 2 * G - R - B
        rg = R / np.maximum(G, 1)
        blk = (lum >= cal['sandLuminance']) & (exg <= cal['sandExcessGreen']) & (rg >= cal['sandRedOverGreen'])
        ys2, xs2 = np.nonzero(blk)
        if len(xs2):
            d2, _ = tree.query(np.stack([easts[xs2], norths[y0 + ys2]], axis=1), k=1)
            blk[:] = False
            k2 = d2 <= 60
            blk[ys2[k2], xs2[k2]] = True
        colour_only[y0:y1] = blk
        del EE, NN, rgb, R, G, B, lum, exg, rg, blk
    colour_only = nd.binary_closing(colour_only, np.ones((3, 3), bool))
    lab2, n2 = nd.label(colour_only, structure=np.ones((3, 3), bool))
    sl2 = nd.find_objects(lab2)
    dry = []
    for c in range(1, n2 + 1):
        sub = sl2[c - 1]
        if sub is None:
            continue
        piece = lab2[sub] == c
        sy, sx = np.nonzero(piece)
        area = len(sx) * cell
        if area < MIN_AREA or area > MAX_AREA:
            continue
        gy = sy + sub[0].start; gx = sx + sub[1].start
        hollow = float(np.median(hollow_all[gy, gx]))
        if hollow <= -HOLLOW_MEDIAN:
            continue                      # already in `accepted`
        edge = len(sx) - float(nd.binary_erosion(piece, np.ones((3, 3), bool)).sum())
        if 4 * np.pi * len(sx) / max(edge * edge, 1e-9) < MIN_COMPACTNESS:
            continue
        if float(np.median(lum_all[gy, gx])) < MIN_LUMINANCE_MEDIAN:
            continue
        ce, cn = float(easts[gx].mean()), float(norths[gy].mean())
        nearest = min(((np.hypot(ce - m['easting'], cn - m['northing']), m['index'], m) for m in mapped))
        if nearest[0] <= 12:
            continue                      # it is a mapped bunker the laser simply missed
        dry.append({'centreEasting': round(ce, 2), 'centreNorthing': round(cn, 2),
                    'areaSquareMetres': round(area, 1), 'medianHollowMetres': round(hollow, 3),
                    'medianLuminance': round(float(np.median(lum_all[gy, gx])), 1),
                    'nearestMappedBunkerMetres': round(float(nearest[0]), 1),
                    'nearestMappedBunkerHole': nearest[2]['hole']})
    dry.sort(key=lambda c: -c['areaSquareMetres'])

    return {
        'capture': capture, 'captureLabel': spec['label'], 'analysisStepMetres': step, 'calibration': cal,
        'sandWithoutHollow': {
            'why': ('the imagery is newer than the laser, so a bunker built between them has sand and no dish. '
                    'Reported, never adopted: what would make the second record is the club\'s own dated '
                    'statement that a bunker was built there.'),
            'count': len(dry), 'candidates': dry[:60]},
        'rule': {
            'sandLuminanceMinimum': round(cal['sandLuminance'], 1),
            'sandExcessGreenMaximum': round(cal['sandExcessGreen'], 1),
            'sandRedOverGreenMinimum': round(cal['sandRedOverGreen'], 3),
            'localMedianWindowMetres': LOCAL_WINDOW_METRES,
            'perCellHollowMetres': HOLLOW_CELL, 'componentMedianHollowMetres': HOLLOW_MEDIAN,
            'minimumAreaSquareMetres': MIN_AREA, 'maximumAreaSquareMetres': MAX_AREA,
            'minimumCompactness': MIN_COMPACTNESS, 'minimumMedianLuminance': MIN_LUMINANCE_MEDIAN,
            'note': 'every colour threshold is measured on THIS capture and sits midway in the gap its own sand and turf pixels leave'},
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
        c = r['calibration']
        print(f"            calibration  sand/turf luminance gap {c['luminanceGap']:+6.1f}, excess-green gap {c['excessGreenGap']:+6.1f}"
              f"  (sand lum p20/50/80 {c['sandLuminancePercentiles']}, turf p10/50/90 {c['turfLuminancePercentiles']})")
        print(f"            sand with NO hollow under it (newer than the 2021 laser): {r['sandWithoutHollow']['count']}")
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
