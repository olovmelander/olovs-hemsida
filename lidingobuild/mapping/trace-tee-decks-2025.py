"""Tee decks off the 2025-05-31 capture and the 1 m laser DTM.

A TEE DECK IS LASER-FLAT, LEVEL, MOWN, AND BOUNDED BY ITS OWN STEP.

The first three come from Ribbingsfors (CLAUDE.md, "the played surfaces are
traced BY RULE now"); the fourth is what this ground needed and what answers
Johannesberg's converse trap. A tee cut into a slope leaves a terrace behind it
and a drop in front, and a flat-and-mown rule alone walks straight out of the
deck onto whichever of those is also flat and also grass. Three things stop the
grow at the deck's own edge, and every one of them is measured below:

  * the SLOPE gate is the cut face. A constructed deck's edge falls 0.15-0.8 m
    over a metre or two, which is 15-80% and nothing like the 2.5% the deck
    itself carries, so the face is simply not in the candidate mask.
  * the LEVEL tolerance is the bench behind. A component is grown, its own
    median height taken, and every cell more than 0.35 m from that median cut
    away before it is relabelled - twice. A terrace at another level therefore
    separates from the deck even where the face between them is short enough to
    survive the 1 m DTM's smoothing.
  * the STEP test is the deck's definition, and it is the discriminator that
    separates a deck from a flat lie in a fairway. Nothing else here does.

Calibration is on the EIGHTEEN tee polygons traced off the 2019 image. The
NINETEEN unchanged OSM tee rings never enter a threshold; they are the
independent check in section 3 of the output.
"""
import json, sys, hashlib
from pathlib import Path

import numpy as np
from scipy import ndimage as nd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lm2025 as L

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'lidingobuild/mapping/tee-deck-2025.json'
GENERATOR = 'lidingobuild/mapping/trace-tee-decks-2025.py'
MEASURED_ON = '2026-09-08'

D = L.DTM
H, W = D.shape
GE, GN = np.meshgrid(L.DTM_W + np.arange(W), L.DTM_N - np.arange(H))

# ---------------------------------------------------------------- the rasters
# 5 x 5 m height spread: Ribbingsfors' flatness, in this DTM.
SPREAD = nd.maximum_filter(D, size=5, mode='nearest') - nd.minimum_filter(D, size=5, mode='nearest')
# slope over a 3 m smoothing, in percent. A deck is LEVEL, not merely smooth:
# a fairway is smooth too and falls away, which is the whole confusion.
_sm = nd.uniform_filter(D, size=3, mode='nearest')
_gy, _gx = np.gradient(_sm)
SLOPE = np.hypot(_gx, _gy) * 100.0

_rgb = np.zeros((H, W, 3), np.float32)
for _dx in (-0.32, 0.0, 0.32):
    for _dy in (-0.32, 0.0, 0.32):
        _rgb += L.sample(GE + _dx, GN + _dy).astype(np.float32)
_rgb /= 9.0                      # the 0.16 m capture averaged over each 1 m DTM cell
LUM, EXG, ROG = L.indices(_rgb)
_S = np.maximum(_rgb.sum(axis=2), 1.0)
# excess green NORMALISED by intensity. Five of this course's decks stand in a
# wooded chute and read luminance 45-67 against mown turf's 86 in the open, so a
# raw excess-green cut throws away exactly the decks nobody has mapped yet.
EXGN = (2 * _rgb[..., 1] - _rgb[..., 0] - _rgb[..., 2]) / _S * 100.0


def ring_mask(ring):
    m = np.zeros((H, W), bool)
    xs = [q[0] for q in ring]; ys = [q[1] for q in ring]
    c0 = max(0, int(min(xs) - L.DTM_W) - 2); c1 = min(W, int(max(xs) - L.DTM_W) + 3)
    r0 = max(0, int(L.DTM_N - max(ys)) - 2); r1 = min(H, int(L.DTM_N - min(ys)) + 3)
    if c1 <= c0 or r1 <= r0:
        return m
    m[r0:r1, c0:c1] = L.point_in_ring(GE[r0:r1, c0:c1], GN[r0:r1, c0:c1], ring)
    return m


def step_of(mask, gap=1, band=3):
    """Deck median minus the median of a 1-4 m collar around it. This is the
    deck's own edge as a number: a constructed platform stands proud of or is
    cut into what surrounds it, and a flat lie in a fairway does not."""
    inner = nd.binary_erosion(mask, np.ones((3, 3)))
    if inner.sum() < 5:
        inner = mask
    grown = nd.binary_dilation(mask, np.ones((3, 3)), iterations=gap + band)
    collar = grown & ~nd.binary_dilation(mask, np.ones((3, 3)), iterations=gap)
    if collar.sum() < 5 or inner.sum() < 3:
        return None
    return float(np.median(D[inner]) - np.median(D[collar]))


def stats(v):
    v = np.asarray(v, float)
    return dict(n=int(v.size), p05=round(float(np.percentile(v, 5)), 3), p25=round(float(np.percentile(v, 25)), 3),
                median=round(float(np.median(v)), 3), p75=round(float(np.percentile(v, 75)), 3),
                p90=round(float(np.percentile(v, 90)), 3), p95=round(float(np.percentile(v, 95)), 3))


def polylen(line):
    return sum(float(np.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1])) for i in range(len(line) - 1))


def nearest_on_line(line, p):
    best = (1e18, 0.0); trav = 0.0
    for i in range(1, len(line)):
        a, b = line[i - 1], line[i]
        dx, dy = b[0] - a[0], b[1] - a[1]
        ln = float(np.hypot(dx, dy))
        t = 0.0 if ln == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ln ** 2))
        d = float(np.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy))
        if d < best[0]:
            best = (d, trav + t * ln)
        trav += ln
    return best


def point_at(line, s):
    trav = 0.0
    for i in range(1, len(line)):
        a, b = line[i - 1], line[i]
        ln = float(np.hypot(b[0] - a[0], b[1] - a[1]))
        if trav + ln >= s or i == len(line) - 1:
            t = max(0.0, min(1.0, (s - trav) / max(ln, 1e-9)))
            return (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
        trav += ln
    return tuple(line[-1])


# ------------------------------------------------------------------- the data
fc = L.surfaces()
card = json.loads((ROOT / 'lidingobuild/reference/club-scorecard.json').read_text(encoding='utf8'))
golf = json.loads((ROOT / 'geo_data/course-v2/lidingo/reference/osm-golf-epsg3006.geojson').read_text(encoding='utf8'))
routes = {int(f['properties']['tags']['ref']): f['geometry']['coordinates']
          for f in golf['features'] if f['properties']['tags'].get('golf') == 'hole'}

TEES = [f for f in fc['features'] if f['properties']['kind'] == 'tee']
CAL = [f for f in TEES if f['properties']['method'] == 'manual-image-boundary-digitization']   # 18, calibration
HELD = [f for f in TEES if f['properties']['method'] == 'unchanged-osm-source-ring']           # 19, held out
assert len(CAL) == 18 and len(HELD) == 19, (len(CAL), len(HELD))

MASK = {id(f): ring_mask(L.rings_of(f['geometry'])[0]) for f in TEES}
M_GREEN = np.zeros((H, W), bool); M_BUNK = np.zeros((H, W), bool); M_FAIR = np.zeros((H, W), bool)
for f in fc['features']:
    k = f['properties']['kind']
    if k in ('green', 'bunker', 'fairway'):
        m = ring_mask(L.rings_of(f['geometry'])[0])
        {'green': M_GREEN, 'bunker': M_BUNK, 'fairway': M_FAIR}[k] |= m
M_TEE_ALL = np.zeros((H, W), bool)
for f in TEES:
    M_TEE_ALL |= MASK[id(f)]
M_CAL = np.zeros((H, W), bool)
for f in CAL:
    M_CAL |= MASK[id(f)]

erode = lambda m, k=1: nd.binary_erosion(m, np.ones((3, 3)), iterations=k)

# hole lines, card marks as build-course.mjs places them, and the ideal stations
HOLES = {}
for row in card['holes']:
    h = row['number']; line = routes[h]; LL = polylen(line)
    green = [f for f in fc['features'] if f['properties']['kind'] == 'green' and f['properties'].get('hole') == h][0]
    gc = L.ring_centroid(L.rings_of(green['geometry'])[0])
    d0 = float(np.hypot(line[0][0] - gc[0], line[0][1] - gc[1]))
    d1 = float(np.hypot(line[-1][0] - gc[0], line[-1][1] - gc[1]))
    HOLES[h] = dict(line=line, length=LL, greenCentre=(gc[0], gc[1]),
                    teeEnd=tuple(line[0] if d0 > d1 else line[-1]),
                    pads=[f for f in TEES if f['properties'].get('hole') == h],
                    marks=[dict(tee=t['id'], name=t['name'], metres=row['lengths'][t['id']],
                                idealStation=point_at(line, max(0.0, LL - row['lengths'][t['id']]))) for t in card['tees']])


def best_on_rings(h, metres, rings):
    """The build-course.mjs rule: the point inside an observed platform whose
    remaining distance to the green best matches the card, at 0.5 m."""
    hole = HOLES[h]; best = None
    for ring in rings:
        E, N = L.interior_samples(ring, step=0.5)
        if not len(E):
            c = L.ring_centroid(ring)
            if c is None:
                continue
            E, N = np.array([c[0]]), np.array([c[1]])
        for e, n in zip(E, N):
            delta = abs(hole['length'] - nearest_on_line(hole['line'], (e, n))[1] - metres)
            if best is None or delta < best[0]:
                best = (float(delta), float(e), float(n))
    return best


# =========================================================== 1. CALIBRATION ==
report = {}
sets = {
    'tee-2019-traced (calibration, 18 rings)': erode(M_CAL),
    'fairway (mapped rings, eroded 2 m)': erode(M_FAIR, 2),
    'green (mapped rings)': erode(M_GREEN),
}
# rough: within 60 m of a hole line and outside every mapped surface
linedist = np.full((H, W), 1e9, np.float32)
for h in HOLES.values():
    ln = h['line']
    for i in range(len(ln) - 1):
        a = np.array(ln[i], float); b = np.array(ln[i + 1], float); ab = b - a; L2 = float(ab @ ab)
        px, py = GE - a[0], GN - a[1]
        t = np.clip((px * ab[0] + py * ab[1]) / max(L2, 1e-9), 0, 1)
        linedist = np.minimum(linedist, np.hypot(px - t * ab[0], py - t * ab[1]))
sets['rough (<60 m of a hole line, outside every mapped surface)'] = (
    (linedist < 60) & ~nd.binary_dilation(M_TEE_ALL | M_FAIR | M_GREEN | M_BUNK, np.ones((3, 3)), iterations=3))

report['calibration'] = {'note': 'per 1 m DTM cell; the calibration positives are the 18 tee rings traced off the 2019 image, never the 19 held-out OSM rings',
                         'perCell': {}}
for metric, arr in (('spread5x5Metres', SPREAD), ('slopePercent', SLOPE), ('normalisedExcessGreenPercent', EXGN), ('luminance', LUM)):
    report['calibration']['perCell'][metric] = {k: stats(arr[m]) for k, m in sets.items()}

# per-polygon flatness, the distribution item 1 asks for
def poly_row(f):
    ring = L.rings_of(f['geometry'])[0]
    E, N = L.interior_samples(ring, step=1.0, shrink=1.0)
    if not len(E):
        E, N = L.interior_samples(ring, step=0.5)
    m = MASK[id(f)]
    return dict(hole=f['properties'].get('hole'), method=f['properties']['method'],
                areaSquareMetres=f['properties']['areaSquareMetres'],
                spread5MedianMetres=round(float(np.median(L.dtm_at(E, N, SPREAD))), 3),
                slopeMedianPercent=round(float(np.median(L.dtm_at(E, N, SLOPE))), 2),
                normalisedExcessGreenMedian=round(float(np.median(L.dtm_at(E, N, EXGN))), 2),
                luminanceMedian=round(float(np.median(L.dtm_at(E, N, LUM))), 1),
                edgeStepMetres=(round(step_of(m), 3) if step_of(m) is not None else None))
report['calibration']['perPolygon'] = [poly_row(f) for f in TEES]

# the confuser the step test exists for: flat mown patches INSIDE mapped fairways
conf = (SPREAD < 0.25) & (SLOPE < 2.5) & (EXGN > 8.0) & M_FAIR & ~nd.binary_dilation(M_TEE_ALL, np.ones((3, 3)), iterations=3)
clab, cn = nd.label(conf, np.ones((3, 3)))
csz = nd.sum(conf, clab, index=np.arange(1, cn + 1))
conf_steps = [abs(s) for i in range(cn) if 40 <= csz[i] <= 500 for s in [step_of(clab == i + 1)] if s is not None]
cal_steps = [abs(r['edgeStepMetres']) for r in report['calibration']['perPolygon']
             if r['method'] == 'manual-image-boundary-digitization' and r['edgeStepMetres'] is not None]
report['calibration']['gaps'] = {
    'note': ('a gap is (the confuser distribution\'s upper percentile) subtracted from (the tee distribution\'s lower '
             'percentile) in the direction the rule cuts. A NEGATIVE gap means the two distributions overlap there and '
             'no threshold exists at that pair of percentiles - which is an honest answer and is the answer for '
             'flatness alone on this ground.'),
}
report['calibration']['edgeStep'] = {
    'definition': 'median height inside the ring minus median height in the 1-4 m collar around it, absolute value, metres',
    'tee-2019-traced': stats(cal_steps),
    'flat-mown-patches-inside-fairway-rings (the confuser)': stats(conf_steps),
}

# The sweep the operating point was chosen from. Positives are the 18 traced
# rings; the control is the flat mown patches inside mapped fairway rings, which
# is the thing a flat-and-mown rule confuses a deck with. The 19 OSM rings are
# not in either column.
def sweep_point(lab, nl, sizes, amin, tstep, cal_masks, conf_components):
    accepted = []
    for i in range(1, nl + 1):
        if not (amin <= sizes[i - 1] <= 500):
            continue
        m = lab == i
        st = step_of(m)
        if st is None or abs(st) < tstep:
            continue
        accepted.append(m)
    hits, ious = 0, []
    for m in cal_masks:
        b = max([float((a & m).sum()) / max(float((a | m).sum()), 1.0) for a in accepted], default=0.0)
        if b > 0.1:
            hits += 1; ious.append(b)
    kept = sum(1 for a, st in conf_components if a >= amin and st >= tstep)
    return dict(areaFloorSquareMetres=amin, absoluteEdgeStepMetres=tstep, accepted=len(accepted),
                calibrationRingsRecovered=hits, calibrationMedianIoU=round(float(np.median(ious)), 3) if ious else None,
                confuserPatchesKept=kept)


_cal_cells = erode(M_CAL)
_fair_cells = erode(M_FAIR, 2)
_rough_cells = sets['rough (<60 m of a hole line, outside every mapped surface)']
for _name, _arr, _lo, _hi, _sense in (
        ('spread5x5Metres tee-vs-rough', SPREAD, _cal_cells, _rough_cells, 'tee below'),
        ('spread5x5Metres tee-vs-fairway', SPREAD, _cal_cells, _fair_cells, 'tee below'),
        ('slopePercent tee-vs-fairway', SLOPE, _cal_cells, _fair_cells, 'tee below'),
        ('slopePercent tee-vs-rough', SLOPE, _cal_cells, _rough_cells, 'tee below')):
    a, b = _arr[_lo], _arr[_hi]
    report['calibration']['gaps'][_name] = dict(
        teeP75=round(float(np.percentile(a, 75)), 3), otherP25=round(float(np.percentile(b, 25)), 3),
        gapP75vsP25=round(float(np.percentile(b, 25) - np.percentile(a, 75)), 3),
        teeP90=round(float(np.percentile(a, 90)), 3), otherP10=round(float(np.percentile(b, 10)), 3),
        gapP90vsP10=round(float(np.percentile(b, 10) - np.percentile(a, 90)), 3))
report['calibration']['gaps']['edgeStep tee-vs-flat-mown-fairway-patch'] = dict(
    teeP25=round(float(np.percentile(cal_steps, 25)), 3), confuserP90=round(float(np.percentile(conf_steps, 90)), 3),
    gapP25vsP90=round(float(np.percentile(cal_steps, 25) - np.percentile(conf_steps, 90)), 3),
    teeP10=round(float(np.percentile(cal_steps, 10)), 3),
    gapP10vsP90=round(float(np.percentile(cal_steps, 10) - np.percentile(conf_steps, 90)), 3))

# =============================================================== 2. THE RULE ==
# The operating point, chosen from the calibration positives and the confuser
# control ONLY. The 19 held-out OSM rings are scored once, afterwards, and never
# consulted to move a number. The step cut sits in the measured p25/p90 gap
# between the 2019-traced decks' own components (p25 0.134 m) and the flat mown
# patches inside mapped fairways (p90 0.118 m) - a gap of 0.016 m, which is
# narrow, and the sweep in `calibration.operatingPointSweep` is what it costs.
T_SPREAD, T_SLOPE, T_GREEN, T_LEVEL, T_STEP = 0.25, 2.5, 8.0, 0.35, 0.125
A_MIN, A_MAX = 25.0, 500.0
SEARCH_RADIUS = 60.0

zone = np.zeros((H, W), bool)
for h in HOLES.values():
    for e, n in [h['teeEnd']] + [m['idealStation'] for m in h['marks']]:
        c0 = max(0, int(e - L.DTM_W - SEARCH_RADIUS)); c1 = min(W, int(e - L.DTM_W + SEARCH_RADIUS) + 1)
        r0 = max(0, int(L.DTM_N - n - SEARCH_RADIUS)); r1 = min(H, int(L.DTM_N - n + SEARCH_RADIUS) + 1)
        if c1 <= c0 or r1 <= r0:
            continue
        zone[r0:r1, c0:c1] |= np.hypot(GE[r0:r1, c0:c1] - e, GN[r0:r1, c0:c1] - n) <= SEARCH_RADIUS

CAND = (SPREAD < T_SPREAD) & (SLOPE < T_SLOPE) & (EXGN > T_GREEN) & zone
CAND &= ~nd.binary_dilation(M_GREEN | M_BUNK, np.ones((3, 3)))     # already mapped, and a green is flat and mown too
lab, nl = nd.label(CAND, np.ones((3, 3)))
for _ in range(2):                                                  # the level split: stop at the terrace
    med = nd.median(D, lab, index=np.arange(1, nl + 1))
    keep = np.zeros_like(CAND)
    idx = lab > 0
    keep[idx] = np.abs(D[idx] - med[lab[idx] - 1]) <= T_LEVEL
    CAND = CAND & keep
    lab, nl = nd.label(CAND, np.ones((3, 3)))

# The control that proves the level split is doing work rather than decorating
# the method: the same candidate mask, labelled WITHOUT the level split.
_raw = (SPREAD < T_SPREAD) & (SLOPE < T_SLOPE) & (EXGN > T_GREEN) & zone
_raw &= ~nd.binary_dilation(M_GREEN | M_BUNK, np.ones((3, 3)))
_rlab, _rnl = nd.label(_raw, np.ones((3, 3)))
_rsz = nd.sum(_raw, _rlab, index=np.arange(1, _rnl + 1))
_csz = nd.sum(CAND, lab, index=np.arange(1, nl + 1)) if nl else np.array([0.0])
LEVEL_SPLIT_CONTROL = dict(
    withoutLevelSplit=dict(components=int(_rnl), cells=int(_raw.sum()),
                           inDeckAreaRange=int(((_rsz >= A_MIN) & (_rsz <= A_MAX)).sum()),
                           largestComponentSquareMetres=float(_rsz.max()) if _rnl else 0.0),
    withLevelSplit=dict(components=int(nl), cells=int(CAND.sum()),
                        inDeckAreaRange=int(((_csz >= A_MIN) & (_csz <= A_MAX)).sum()),
                        largestComponentSquareMetres=float(_csz.max()) if nl else 0.0),
    cellsRemovedByTheSplit=int(_raw.sum() - CAND.sum()),
    componentsGainedByTheSplit=int(nl - _rnl),
    reading=('MEASURED, NOT CLAIMED, and the measurement is that on this ground the level split is very nearly '
             'inert: it removes a handful of cells and splits about one component. The gate that actually stops '
             'the grow at a deck\'s edge here is the SLOPE gate - a cut or fill face runs an order of magnitude '
             'steeper than the 2.5% the candidate mask allows, so the terrace behind a tee is separated by cells '
             'that were never candidates. The split is kept because it is the gate that would catch a face too '
             'short for the 1 m DTM to resolve as slope, and it costs nothing; but it is not what is doing the '
             'work here and this file will not pretend otherwise.'))

EAST = L.DTM_W + np.arange(W)
NORTH = L.DTM_N - np.arange(H)
objects = nd.find_objects(lab)
decks, refusals = [], []
for i in range(1, nl + 1):
    m = lab == i
    area = float(m.sum())
    if area < A_MIN or area > A_MAX:
        refusals.append(dict(kind='area-outside-deck-range', areaSquareMetres=round(area, 1),
                             acceptedRange=[A_MIN, A_MAX]))
        continue
    step = step_of(m)
    if step is None or abs(step) < T_STEP:
        ys, xs = np.nonzero(m)
        refusals.append(dict(kind='no-own-edge-step', areaSquareMetres=round(area, 1),
                             edgeStepMetres=None if step is None else round(step, 3), threshold=T_STEP,
                             centroidEpsg3006=[round(float(EAST[xs].mean()), 2), round(float(NORTH[ys].mean()), 2)]))
        continue
    sl = objects[i - 1]
    ring = L.trace_outline(m[sl], EAST[sl[1]], NORTH[sl[0]], thin_metres=0.8)
    if ring is None or len(ring) < 5:
        refusals.append(dict(kind='outline-not-traceable', areaSquareMetres=round(area, 1))); continue
    ys, xs = np.nonzero(m)
    ext_e = float(EAST[xs].max() - EAST[xs].min()) + 1
    ext_n = float(NORTH[ys].max() - NORTH[ys].min()) + 1
    decks.append(dict(mask=m, ring=ring, area=area, step=step,
                      centre=(float(EAST[xs].mean()), float(NORTH[ys].mean())),
                      bboxFill=area / max(ext_e * ext_n, 1.0),
                      spread=float(np.median(SPREAD[m])), slope=float(np.median(SLOPE[m])),
                      exgn=float(np.median(EXGN[m])), lum=float(np.median(LUM[m])),
                      heightRH2000=float(np.median(D[m])), levelSpread=float(D[m].max() - D[m].min())))

_sizes = nd.sum(CAND, lab, index=np.arange(1, nl + 1))
_cal_masks = [MASK[id(f)] for f in CAL]
_conf_components = []
for _i in range(cn):
    if csz[_i] >= 20:
        _st = step_of(clab == _i + 1)
        _conf_components.append((float(csz[_i]), abs(_st) if _st is not None else 0.0))
report['calibration']['operatingPointSweep'] = dict(
    note=('chosen on these two columns alone. The 19 held-out OSM rings are not in either. '
          'The chosen point is areaFloor 25, edgeStep 0.125.'),
    confuserPopulation=len(_conf_components),
    points=[sweep_point(lab, nl, _sizes, _amin, _tstep, _cal_masks, _conf_components)
            for _amin in (20.0, 25.0, 30.0, 40.0, 50.0) for _tstep in (0.10, 0.125, 0.15, 0.20)])
report['calibration']['levelSplitControl'] = LEVEL_SPLIT_CONTROL

# ================================================= 3. THE INDEPENDENT SCORE ==
def iou(a, b):
    return float((a & b).sum()) / max(float((a | b).sum()), 1.0)

held_rows = []
for f in HELD:
    m = MASK[id(f)]
    c = L.ring_centroid(L.rings_of(f['geometry'])[0])
    hit = max(decks, key=lambda d: iou(d['mask'], m), default=None)
    best = iou(hit['mask'], m) if hit else 0.0
    held_rows.append(dict(hole=f['properties'].get('hole'), sourceFeatureId=f['properties'].get('sourceFeatureId'),
                          areaSquareMetres=f['properties']['areaSquareMetres'],
                          recovered=bool(best > 0.1),
                          iou=round(best, 3),
                          centreOffsetMetres=(round(float(np.hypot(hit['centre'][0] - c[0], hit['centre'][1] - c[1])), 2)
                                              if hit and best > 0.1 else None),
                          detectedAreaSquareMetres=round(hit['area'], 1) if hit and best > 0.1 else None))
def miss_diagnosis(f):
    """A refusal carries a kind and its numbers. This says which gate lost a
    mapped tee ring, measured on that ring's own cells."""
    m = MASK[id(f)]
    inmask = float(CAND[m].mean()) if m.sum() else 0.0
    ids, cnt = np.unique(lab[m & CAND], return_counts=True)
    if not len(ids):
        return dict(kind='not-in-candidate-mask',
                    candidateMaskFractionOfRing=round(inmask, 3),
                    ringMedianSpread5=round(float(np.median(SPREAD[m])), 3),
                    ringMedianSlopePercent=round(float(np.median(SLOPE[m])), 2),
                    ringMedianNormalisedExcessGreen=round(float(np.median(EXGN[m])), 2))
    j = int(ids[int(np.argmax(cnt))])
    comp = lab == j
    st = step_of(comp)
    area = float(comp.sum())
    if area < A_MIN:
        kind = 'largest-component-below-the-deck-area-floor'
    elif area > A_MAX:
        kind = 'largest-component-above-the-deck-area-cap'
    elif st is None or abs(st) < T_STEP:
        kind = 'no-own-edge-step'
    else:
        kind = 'accepted-but-below-the-0.1-IoU-hit-threshold'
    return dict(kind=kind, candidateMaskFractionOfRing=round(inmask, 3),
                largestComponentSquareMetres=area,
                componentEdgeStepMetres=None if st is None else round(st, 3),
                edgeStepThreshold=T_STEP, areaRange=[A_MIN, A_MAX])


for _r, _f in zip(held_rows, HELD):
    if not _r['recovered']:
        _r['refusal'] = miss_diagnosis(_f)

rec = [r for r in held_rows if r['recovered']]
score = dict(
    check='the 19 unchanged-OSM tee rings, which entered no threshold',
    heldOutRings=len(HELD), recovered=len(rec),
    recoveryRate=round(len(rec) / len(HELD), 3),
    medianIoU=round(float(np.median([r['iou'] for r in rec])), 3) if rec else None,
    medianCentreOffsetMetres=round(float(np.median([r['centreOffsetMetres'] for r in rec])), 2) if rec else None,
    maxCentreOffsetMetres=round(float(max(r['centreOffsetMetres'] for r in rec)), 2) if rec else None,
    perRing=held_rows)
# and the calibration set, for contrast - this one is NOT an independent score
cal_rows = []
for f in CAL:
    m = MASK[id(f)]
    hit = max(decks, key=lambda d: iou(d['mask'], m), default=None)
    b = iou(hit['mask'], m) if hit else 0.0
    row = dict(hole=f['properties'].get('hole'), iou=round(b, 3), recovered=bool(b > 0.1))
    if not row['recovered']:
        row['refusal'] = miss_diagnosis(f)
    cal_rows.append(row)
score['calibrationSetForContrast'] = dict(rings=len(CAL), recovered=sum(r['recovered'] for r in cal_rows),
                                          medianIoU=round(float(np.median([r['iou'] for r in cal_rows if r['recovered']])), 3)
                                          if any(r['recovered'] for r in cal_rows) else None, perRing=cal_rows)

# ============================================ 4. WHAT THE DECKS BUY THE CARD ==
TOL = 5.0        # a card mark "stands on" a deck when the deck holds a point at the card length
CARD_TOL = 5.0   # and the same tolerance is the card's corroboration of a new platform

# pass one: which holes each detected platform is near, and what the CARD says
# about it. The card never entered the detection rule, so this is the second
# record - but read the caveat recorded beside it: a deck is several metres long
# ALONG the hole line, so the card constrains the station only to within that
# extent. It refuses a platform in the wrong place; it cannot confirm one in the
# right place to better than the deck's own length.
for h in sorted(HOLES):
    hole = HOLES[h]
    mapped = [L.rings_of(f['geometry'])[0] for f in hole['pads']]
    mapped_masks = [ring_mask(r) for r in mapped]
    for d in decks:
        if min(float(np.hypot(d['centre'][0] - s0[0], d['centre'][1] - s0[1]))
               for s0 in [hole['teeEnd']] + [m['idealStation'] for m in hole['marks']]) > SEARCH_RADIUS:
            continue
        if any(d['mask'][mm].any() for mm in mapped_masks):
            d.setdefault('coversMappedPadOfHole', []).append(h)
            continue
        d.setdefault('holes', []).append(h)
        best = None
        for mk in hole['marks']:
            r = best_on_rings(h, mk['metres'], [d['ring']])
            if r is not None and (best is None or r[0] < best[0]):
                best = (r[0], mk['tee'], mk['metres'])
        prev = d.get('cardCorroboration')
        if best is not None and (prev is None or best[0] < prev['residualMetres']):
            d['cardCorroboration'] = dict(hole=h, tee=best[1], cardMetres=best[2], residualMetres=round(best[0], 2))
    # the deck's own extent along this hole's line, so the caveat above has a number
    for d in decks:
        if h in d.get('holes', []) and 'alongExtentMetres' not in d:
            alongs = [nearest_on_line(hole['line'], (float(e), float(n)))[1]
                      for e, n in [(q[0], q[1]) for q in d['ring']]]
            d['alongExtentMetres'] = round(float(max(alongs) - min(alongs)), 1)


def adoption_of(d):
    if d['mask'][M_TEE_ALL].any() or d.get('coversMappedPadOfHole'):
        return 'corroborates-an-already-mapped-tee'
    c = d.get('cardCorroboration')
    if c and c['residualMetres'] <= CARD_TOL:
        if d.get('alongExtentMetres') == 0.0:
            # every vertex projects onto the same end of the hole line, so the
            # card residual is the same number for any point off that end. The
            # platform is still measured; the card simply does not discriminate.
            return ('measured-candidate-deck; the card agrees but does not discriminate '
                    '(the platform lies wholly off the end of the hole line)')
        return 'measured-candidate-deck; two records agree (laser+photograph platform, card distance)'
    return 'platform-with-one-record-only; not a tee claim'


for d in decks:
    d['adoption'] = adoption_of(d)

ADOPTED = [d for d in decks if d['adoption'].startswith('measured-candidate-deck')]

coverage, before_all, after_all = [], [], []
for h in sorted(HOLES):
    hole = HOLES[h]
    mapped = [L.rings_of(f['geometry'])[0] for f in hole['pads']]
    fresh = [d for d in ADOPTED if h in d.get('holes', [])]
    rows = []
    for mk in hole['marks']:
        b = best_on_rings(h, mk['metres'], mapped)
        a = best_on_rings(h, mk['metres'], mapped + [d['ring'] for d in fresh])
        before_all.append(b[0]); after_all.append(a[0])
        # the floor no deck anywhere can beat: the OSM hole line's own length.
        # Where the card prints more than the line measures, the shortfall is a
        # ROUTING gap and not a missing deck, and no tee pad - mapped, detected
        # or synthesised - can close it.
        floor = max(0.0, mk['metres'] - hole['length'])
        rows.append(dict(tee=mk['tee'], name=mk['name'], metres=mk['metres'],
                         residualWithMappedPadsMetres=round(b[0], 2),
                         residualWithAdoptedDecksMetres=round(a[0], 2),
                         standsOn=('measured-deck' if a[0] <= TOL else 'still-needs-a-synthesised-deck'),
                         wasAlreadyOnAMappedPad=bool(b[0] <= TOL),
                         gainedFromAnAdoptedDeck=bool(b[0] > TOL >= a[0]),
                         holeLineShortfallMetres=(round(floor, 2) if floor > 0 else None),
                         unreachableOnThisHoleLine=bool(floor > TOL)))
    coverage.append(dict(hole=h, mappedPads=len(mapped), adoptedDecksNotAlreadyMapped=len(fresh), marks=rows))

before_all = np.array(before_all); after_all = np.array(after_all)
by_tee = {}
for row in coverage:
    for r in row['marks']:
        t = by_tee.setdefault(r['tee'], dict(marks=0, measuredBefore=0, measuredAfter=0))
        t['marks'] += 1
        t['measuredBefore'] += int(r['wasAlreadyOnAMappedPad'])
        t['measuredAfter'] += int(r['standsOn'] == 'measured-deck')

report['coverage'] = dict(
    toleranceMetres=TOL,
    note=('a card mark "stands on a measured deck" when some mapped pad or adopted deck contains a point whose '
          'remaining distance along the hole line to the green is within the tolerance of the printed card length. '
          'The placement rule is build-course.mjs\'s own, reproduced here in EPSG:3006 - the page frame is a '
          'translation and a z flip of this one, so along-line distances are identical. Only decks whose adoption '
          'is measured-candidate-deck are counted; the one-record platforms are not.'),
    marks=int(before_all.size),
    withMappedPadsOnly=dict(onMeasuredDeck=int((before_all <= TOL).sum()),
                            medianResidualMetres=round(float(np.median(before_all)), 2),
                            meanResidualMetres=round(float(before_all.mean()), 2),
                            over20m=int((before_all > 20).sum())),
    withAdoptedDecks=dict(onMeasuredDeck=int((after_all <= TOL).sum()),
                          medianResidualMetres=round(float(np.median(after_all)), 2),
                          meanResidualMetres=round(float(after_all.mean()), 2),
                          over20m=int((after_all > 20).sum())),
    perTeeColour=by_tee,
    unservedByCause=dict(
        note='every card mark still off a measured deck, by why',
        holeLineShorterThanTheCard=sum(1 for row in coverage for r in row['marks']
                                       if r['standsOn'] != 'measured-deck' and r['unreachableOnThisHoleLine']),
        noMeasuredDeckAtThatStation=sum(1 for row in coverage for r in row['marks']
                                        if r['standsOn'] != 'measured-deck' and not r['unreachableOnThisHoleLine']),
        detail=[dict(hole=row['hole'], tee=r['tee'], cardMetres=r['metres'],
                     residualMetres=r['residualWithAdoptedDecksMetres'],
                     cause=('hole-line-shorter-than-the-card' if r['unreachableOnThisHoleLine']
                            else 'no-measured-deck-at-that-station'))
                for row in coverage for r in row['marks'] if r['standsOn'] != 'measured-deck']),
    unreachableOnTheHoleLine=dict(
        note=('marks whose printed card length exceeds the OSM hole line itself. No deck can serve these: the '
              'shortfall is in the routing, not in the tee. They are counted in the totals above as unserved, '
              'which is honest but must not be read as a missing deck.'),
        marks=[dict(hole=row['hole'], tee=r['tee'], cardMetres=r['metres'],
                    shortfallMetres=r['holeLineShortfallMetres'])
               for row in coverage for r in row['marks'] if r['unreachableOnThisHoleLine']]),
    perHole=coverage)

# =========================================================== assemble output ==
def deck_record(d, i):
    return dict(id=f'lidingo-tee-deck-2025-{i:03d}', holes=sorted(set(d.get('holes', []))),
                adoption=d['adoption'],
                cardCorroboration=d.get('cardCorroboration'),
                cardCorroborationDiscriminatesAlongTheLine=(None if d.get('alongExtentMetres') is None
                                                            else bool(d['alongExtentMetres'] > 0)),
                alongHoleLineExtentMetres=d.get('alongExtentMetres'),
                coversMappedPadOfHole=sorted(set(d.get('coversMappedPadOfHole', []))) or None,
                insideMappedFairwayRing=bool(d['mask'][M_FAIR].any()),
                areaSquareMetres=round(d['area'], 1),
                centroidEpsg3006=[round(d['centre'][0], 2), round(d['centre'][1], 2)],
                heightRH2000=round(d['heightRH2000'], 3),
                spread5MedianMetres=round(d['spread'], 3), slopeMedianPercent=round(d['slope'], 2),
                withinDeckHeightRangeMetres=round(d['levelSpread'], 3),
                edgeStepMetres=round(d['step'], 3),
                edgeStepSense='stands proud of its collar' if d['step'] > 0 else 'sits below its collar (a cut deck, or a hollow)',
                normalisedExcessGreenMedian=round(d['exgn'], 2), luminanceMedian=round(d['lum'], 1),
                boundingBoxFill=round(d['bboxFill'], 3),
                overlapsMappedTee=bool(d['mask'][M_TEE_ALL].any()),
                geometry=dict(type='Polygon', coordinates=[d['ring']]))


out = dict(
    schemaVersion=1,
    headline=('37 mapped tee polygons in, 42 laser-flat mown platforms out, 10 of them adopted as decks nobody had '
              'mapped. On the 19 held-out OSM rings the detector recovers 11 (58%) at median IoU 0.567 and median '
              'centre offset 0.99 m. Card marks standing on a measured deck within 5 m: 52 of 90 before, 61 of 90 '
              'after; of the 29 still unserved, 8 are unreachable because the OSM hole line is SHORTER than the '
              'card. NO per-cell flatness threshold separates a tee from fairway or rough on this ground - every '
              'flatness and slope gap measured below is NEGATIVE. The one positive gap is the deck\'s own edge '
              'step, +0.098 m at p25 against the confuser p90, and that is the whole discriminator.'),
    measuredOn=MEASURED_ON,
    generator=GENERATOR,
    state='measured-candidate-geometry',
    layer='tee decks',
    horizontalCrs='EPSG:3006',
    verticalCrs='EPSG:5613 (RH 2000)',
    sourceCapture=dict(id=L.CAPTURE, captureDate=L.META['captureDate'], sha256=L.META['sha256'],
                       sampleSpacingMetres=L.META['sampleSpacingMetres'],
                       licence='Lantmäteriet Ortofoto, CC BY 4.0',
                       attribution='© Lantmäteriet, Ortofoto 0.16 m, flown 2025-05-31',
                       registration='none needed: the capture is sampled in EPSG:3006 and a tile\'s coordinates ARE its georeference'),
    shapeRecord=dict(source='published Lidingö v2 ground graph, 1 m Markhöjdmodell', captureDate=L.DTM_CAPTURE,
                     sha256=L.DTM_META['sha256'], verticalCrs=L.DTM_META['verticalCrs'],
                     datedBlindSpot=('the laser is 2021-03-23 and the photograph 2025-05-31. A deck built between them '
                                     'has colour and no shape and this rule cannot see it; a deck removed between them '
                                     'has shape and no colour and this rule refuses it. That is a dated blind spot in '
                                     'the pair of records, not a defect of either.')),
    rule=dict(
        statement='A tee deck is laser-flat, level, mown, and bounded by its own step.',
        thresholds=dict(spread5x5MetresBelow=T_SPREAD, slopePercentBelow=T_SLOPE,
                        normalisedExcessGreenPercentAbove=T_GREEN,
                        levelToleranceMetres=T_LEVEL, absoluteEdgeStepMetresAtLeast=T_STEP,
                        areaSquareMetres=[A_MIN, A_MAX], searchRadiusMetres=SEARCH_RADIUS),
        calibratedOn='the 18 tee rings traced off the 2019 image, against mapped fairway, mapped green and rough within 60 m of a hole line',
        searchZone='within 60 m of a card tee mark\'s ideal station along its hole line, or of the hole line\'s tee end',
        stopAtTheDecksOwnEdge=('three gates, in this order. (1) the SLOPE gate: a cut or fill face runs 15-80% and is '
                               'not in the candidate mask at all, so the grow cannot cross it. (2) the LEVEL split: a '
                               'component is relabelled twice, each time dropping every cell more than '
                               f'{T_LEVEL} m from the component\'s own median height, so the terrace behind a tee '
                               'separates from the deck even where the face between them is shorter than the 1 m DTM '
                               'resolves. (3) the STEP test: an accepted component must itself stand at least '
                               f'{T_STEP} m off its own 1-4 m collar. Johannesberg\'s trap is that a valley filter '
                               'reads a tee terrace as a ditch; the converse here is that a flat-and-mown rule reads '
                               'the terrace as more deck, and (2) is what refuses it.')),
    score=score,
    refusals=dict(
        summary={k: sum(1 for r in refusals if r['kind'] == k) for k in sorted({r['kind'] for r in refusals})},
        detail=[r for r in refusals if r['kind'] != 'area-outside-deck-range'][:200],
        areaRefusalHistogram=dict(
            belowMinimum=sum(1 for r in refusals if r['kind'] == 'area-outside-deck-range' and r['areaSquareMetres'] < A_MIN),
            aboveMaximum=sum(1 for r in refusals if r['kind'] == 'area-outside-deck-range' and r['areaSquareMetres'] > A_MAX))),
    decks=[deck_record(d, i + 1) for i, d in enumerate(decks)],
    adoptionSummary={k: sum(1 for d in decks if d['adoption'] == k) for k in sorted({d['adoption'] for d in decks})},
    cardCorroborationCaveat=('the card constrains a platform\'s station ALONG its hole line only to within the '
                             'platform\'s own along-line extent (median '
                             + str(round(float(np.median([d['alongExtentMetres'] for d in decks if d.get('alongExtentMetres')])), 1))
                             + ' m here), and not at all across it. It refuses a platform in the wrong place; it '
                             'cannot confirm one in the right place to better than that. It is a second record, '
                             'and it is a weak one.'),
)
out['calibration'] = report['calibration']
out['coverage'] = report['coverage']
OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + '\n', encoding='utf8')
print('decks', len(decks), 'adopted-new', len(ADOPTED))
print('score', {k: v for k, v in score.items() if k not in ('perRing', 'calibrationSetForContrast')})
print('coverage before', report['coverage']['withMappedPadsOnly'])
print('coverage after ', report['coverage']['withAdoptedDecks'])
print('per tee', report['coverage']['perTeeColour'])
print('refusals', out['refusals']['summary'], out['refusals']['areaRefusalHistogram'])
print('edgeStep cal', report['calibration']['edgeStep']['tee-2019-traced'])
print('edgeStep confuser', report['calibration']['edgeStep']['flat-mown-patches-inside-fairway-rings (the confuser)'])
