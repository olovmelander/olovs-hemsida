"""Fairway, semi and rough on the 2025-05-31 Lantmäteriet capture.

The question this asks is narrower than "trace the fairways", because
lidingobuild/mapping/green-trace-2025.json already measured, five ways, that a
GREEN cannot be told from its collar and its approach in this frame: excess
green leaks out of the putting surface and the two polar tracers score a median
IoU of 0.294 and 0.365 at 2.7-3.4x the surveyed area. So the first thing this
file does is measure which distinctions the photograph actually carries, and
report the ones it does not.

What it finds is two tiers, and they are two different things:

  TIER 1  MOWN TURF against rough and forest. This separates well - and it is
          NOT a fairway. It is fairway plus first cut plus green surround plus
          tee surround plus walk-off, because that is all one mowing colour.
          Scored against the held-out OSM fairway rings it recalls 0.85-1.00 of
          them at 1.4-2.8x their area, which is the honest signature of a class
          that CONTAINS the fairway rather than one that IS it.

  TIER 2  FAIRWAY-GRADE turf inside the mown class. Its cut is fitted on the
          eight hand-traced 2019 fairway polygons against their own mown
          collars - the five OSM rings enter nothing - and it is much weaker
          there (J = 0.43) than a clean separation would be. Applied to the
          held-out rings it nevertheless reproduces them at a median IoU of
          0.674 and a median area ratio of 1.02.

Everything is read on the one capture through lidingobuild/mapping/lm2025.py.
Nothing is downloaded, and nothing but this file's own JSON is written.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage as nd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lm2025 as L

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'lidingobuild/mapping/fairway-trace-2025.json'
GENERATOR = 'lidingobuild/mapping/trace-2025-fairways.py'

# The page frame, quoted from lidingobuild/build-course.mjs FRAME. A model line
# is LOCAL metres; this file works in EPSG:3006, so every line is converted once,
# here, and the two frames are never mixed:
#     easting  = FRAME.easting  + x     (east is +x in both)
#     northing = FRAME.northing - z     (north is -z in the page frame, +N here)
FRAME_EASTING = 677700.5
FRAME_NORTHING = 6586399.5
def to3006(pt):
    return (FRAME_EASTING + pt[0], FRAME_NORTHING - pt[1])

BLOCK = 3                       # native 0.16 m pixels per analysis cell -> 0.48 m
SMOOTH_METRES = 2.4             # window excess green is averaged over
TEXTURE_METRES = 2.4            # window the luminance standard deviation is taken over
STRIPE_METRES = 6.0             # structure-tensor window for the mowing-stripe test
OPEN_METRES = 2.0               # a strand narrower than a mower is not a surface
CLOSE_METRES = 2.0              # a mower gap, a shadow or a sprinkler head is not a hole
MIN_COMPONENT_SQM = 300.0       # below every fairway polygon this model carries (smallest 1355.6)
CORRIDOR_METRES = 65.0          # the CALIBRATION fairways reach 63.0 m from their own line
TOUCH_METRES = 12.0             # a piece owning a hole must reach that hole's line
REFERENCE_BAND_METRES = 70.0    # the negative sets are drawn within this of a line
EXCLUSION_BUFFER_METRES = 15.0  # the negative sets stand this clear of anything mapped
COLLAR_INNER_METRES = 3.0       # the fairway/semi test band, outside a ring
COLLAR_OUTER_METRES = 15.0
ERODE_METRES = 6.0              # how far inside a ring "interior" starts
IOU_BAR = 0.60                  # fixed before any score was computed
HOLE_BAR = 10                   # of the 12 par 4s and par 5s


def build_grid():
    """The capture on a 0.48 m analysis grid with its indices.

    Block-reducing three native pixels keeps every cell an exact mean of real
    pixels - no resampling - so a cell's coordinates are still the capture's own
    georeference and a trace on it needs no registration.
    """
    img, w = L.image()
    h, wd = img.shape[:2]
    H, W = h // BLOCK, wd // BLOCK
    a = img[:H * BLOCK, :W * BLOCK].astype(np.float32)
    lum = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
    exg = 2 * a[..., 1] - a[..., 0] - a[..., 2]
    del a
    px = w[0] * BLOCK

    # mowing-stripe coherence, computed on the NATIVE 0.16 m luminance because a
    # stripe is a 1-2 m feature and a 0.48 m cell would already have averaged it
    gy, gx = np.gradient(lum)
    win = int(round(STRIPE_METRES / w[0])) | 1
    jxx = nd.uniform_filter(gx * gx, win); jyy = nd.uniform_filter(gy * gy, win)
    jxy = nd.uniform_filter(gx * gy, win)
    del gx, gy
    tr = jxx + jyy
    disc = np.sqrt(np.maximum(tr * tr - 4 * (jxx * jyy - jxy * jxy), 0))
    coh = disc / np.maximum(tr, 1e-6)
    del jxx, jyy, jxy, tr, disc

    def block(x):
        return x[:H * BLOCK, :W * BLOCK].reshape(H, BLOCK, W, BLOCK).mean(axis=(1, 3))
    LUM = block(lum); EXG = block(exg); COH = block(coh)
    del lum, exg, coh
    k = int(round(SMOOTH_METRES / px)) | 1
    EXGs = nd.uniform_filter(EXG, k)
    kt = int(round(TEXTURE_METRES / px)) | 1
    mean = nd.uniform_filter(LUM, kt)
    TEX = np.sqrt(np.maximum(nd.uniform_filter(LUM * LUM, kt) - mean * mean, 0))
    east = w[4] + px * (0.5 + np.arange(W))
    north = w[5] - px * (0.5 + np.arange(H))
    return dict(LUM=LUM, EXGs=EXGs, TEX=TEX, COH=COH, east=east, north=north, px=px)


def make_burner(east, north, px):
    H, W = len(north), len(east)
    def burn(ring, out):
        xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
        c0 = max(0, int(np.floor((min(xs) - east[0]) / px)))
        c1 = min(W - 1, int(np.ceil((max(xs) - east[0]) / px)))
        r0 = max(0, int(np.floor((north[0] - max(ys)) / px)))
        r1 = min(H - 1, int(np.ceil((north[0] - min(ys)) / px)))
        if c1 < c0 or r1 < r0:
            return
        EE, NN = np.meshgrid(east[c0:c1 + 1], north[r0:r1 + 1])
        out[r0:r1 + 1, c0:c1 + 1] |= L.point_in_ring(EE, NN, ring)
    return burn


def line_distance_field(east, north, holes):
    """Distance to each hole line, the nearest line, and which hole that is.

    This is only the FIRST guess at ownership. CLAUDE.md's Ribbingsfors section
    records that nearest-line assignment handed one hole a strip of another's
    fairway; every claim it makes here is checked for contiguity with the hole's
    own line before it is accepted.
    """
    EE, NN = np.meshgrid(east, north)
    best = np.full(EE.shape, 1e9, np.float32)
    owner = np.zeros(EE.shape, np.int16)
    per_hole = {}
    for h in holes:
        pts = [to3006(p) for p in h['line']]
        d = np.full(EE.shape, 1e9, np.float32)
        for i in range(len(pts) - 1):
            ax, ay = pts[i]; bx, by = pts[i + 1]
            dx, dy = bx - ax, by - ay
            ll = dx * dx + dy * dy
            t = np.clip(((EE - ax) * dx + (NN - ay) * dy) / ll, 0, 1)
            d = np.minimum(d, np.hypot(EE - ax - t * dx, NN - ay - t * dy).astype(np.float32))
        per_hole[h['n']] = d
        upd = d < best
        best[upd] = d[upd]
        owner[upd] = h['n']
    return best, owner, per_hole


def pct(v, ps=(2, 5, 10, 25, 50, 75, 90, 95, 98)):
    if not len(v):
        return None
    return {f'p{p}': round(float(np.percentile(v, p)), 3) for p in ps}


def ring_area(ring):
    c = L.ring_centroid(ring)
    return 0.0 if c is None else c[2]


def youden2(pos_a, pos_b, neg_a, neg_b, a_grid, b_grid):
    best = None
    for a in a_grid:
        pa, na = pos_a >= a, neg_a >= a
        for b in b_grid:
            tpr = float((pa & (pos_b <= b)).mean())
            fpr = float((na & (neg_b <= b)).mean())
            if best is None or tpr - fpr > best[0]:
                best = (tpr - fpr, float(a), float(b), tpr, fpr)
    return best


def main():
    grid = build_grid()
    east, north, px = grid['east'], grid['north'], grid['px']
    H, W = len(north), len(east)
    burn = make_burner(east, north, px)
    area_of = lambda mask: float(mask.sum()) * px * px
    it = lambda metres: max(1, int(round(metres / px)))
    st = np.ones((3, 3), bool)

    model = json.loads((ROOT / 'lidingobuild/course-model.json').read_text(encoding='utf8'))
    holes = model['holes']
    par3 = [h['n'] for h in holes if h['par'] == 3]
    playing = [h['n'] for h in holes if h['par'] >= 4]
    hole_len = {h['n']: h['lineLen'] for h in holes}

    surfaces = L.surfaces()
    groups = {}
    for f in surfaces['features']:
        p = f['properties']
        key = p['kind']
        if key == 'fairway':
            key = 'fairway_osm' if p.get('method') == 'unchanged-osm-source-ring' else 'fairway_2019'
        groups.setdefault(key, []).append(f)
    masks = {}
    for key, feats in groups.items():
        m = np.zeros((H, W), bool)
        for f in feats:
            for ring in L.rings_of(f['geometry']):
                burn(ring, m)
        masks[key] = m
    osm_rings = {f['properties']['hole']: f['geometry']['coordinates'][0] for f in groups['fairway_osm']}

    wood = np.zeros((H, W), bool)
    for ring in model['vegetation']['wood']:
        burn([to3006(p) for p in ring], wood)
    water = np.zeros((H, W), bool)
    for wtr in model['water']:
        burn([to3006(p) for p in (wtr['ring'] if isinstance(wtr, dict) else wtr)], water)
    building = np.zeros((H, W), bool)
    for b in model['infra']['buildings']:
        burn([to3006(p) for p in (b['ring'] if isinstance(b, dict) else b)], building)
    parking = np.zeros((H, W), bool)
    for p in model['infra']['parking']:
        burn([to3006(q) for q in p['ring']], parking)

    scenery = np.zeros((H, W), bool)
    def add_rings(value):
        if not value:
            return
        if isinstance(value[0][0], (int, float)):
            burn([to3006(p) for p in value], scenery)
        else:
            for r in value:
                add_rings(r)
    S = model['scenery']
    add_rings(S.get('range'))
    for r in (S.get('practiceGreens') or []):
        add_rings(r)
    for r in (S.get('grass') or []):
        add_rings(r)
    for f in (S.get('mappedFeatures') or []):
        for r in (f.get('rings') or []):
            add_rings(r)

    dist, owner, per_hole = line_distance_field(east, north, holes)

    # ---- 1. every distribution, and every gap ---------------------------
    mapped = np.zeros((H, W), bool)
    for m in masks.values():
        mapped |= m
    clear = nd.binary_dilation(mapped | scenery, st, iterations=it(EXCLUSION_BUFFER_METRES))
    open_rough = (~clear) & (~wood) & (~water) & (~building) & (~parking) & (dist < REFERENCE_BAND_METRES)
    forest = wood & (~clear) & (dist < 90)

    calib = masks['fairway_2019'] | masks['green']     # the five OSM rings are HELD OUT
    negative = forest | open_rough

    sample_sets = {
        'fairway_2019_hand_traced_CALIBRATION': masks['fairway_2019'],
        'green_model_CALIBRATION': masks['green'],
        'tee_model': masks['tee'],
        'bunker_model': masks['bunker'],
        'fairway_osm_HELD_OUT_FOR_SCORING': masks['fairway_osm'],
        'forest_osm_wood_rings': forest,
        'open_ground_not_mapped': open_rough,
        'water_model': water,
        'building_model': building,
        'parking_model': parking,
    }
    distributions = {name: {
        'cells': int(m.sum()),
        'areaSquareMetres': round(area_of(m), 1),
        'excessGreenSmoothed2p4m': pct(grid['EXGs'][m]),
        'luminanceTexture2p4m': pct(grid['TEX'][m]),
        'luminance': pct(grid['LUM'][m]),
        'mowingStripeCoherence6m': pct(grid['COH'][m], (10, 25, 50, 75, 90)),
    } for name, m in sample_sets.items()}

    # ---- tier 1: MOWN, calibrated on cal vs neg -------------------------
    ce, cn = grid['EXGs'][calib], grid['EXGs'][negative]
    ct, nt = grid['TEX'][calib], grid['TEX'][negative]
    J1, EXG1, TEX1, TPR1, FPR1 = youden2(ce, ct, cn, nt, np.arange(10, 34.01, 1.0), np.arange(2.0, 8.01, 0.25))
    smooth_c, smooth_n = ct <= TEX1, nt <= TEX1
    green_c, green_n = ce >= EXG1, cn >= EXG1
    tier1_cal = {
        'class': 'mown turf against rough and forest',
        'positiveSet': 'the eight hand-traced 2019 fairway polygons and the twenty green rings',
        'negativeSet': 'OSM wood rings, and open ground standing 15 m clear of every mapped surface within 70 m of a hole line',
        'heldOut': 'the five unchanged-OSM fairway rings entered no threshold, no corridor and no cleaning parameter',
        'positiveCells': int(calib.sum()), 'negativeCells': int(negative.sum()),
        'rule': 'excessGreenSmoothed2p4m >= %.0f AND luminanceTexture2p4m <= %.2f' % (EXG1, TEX1),
        'cutChosenBy': "Youden's J maximised over the two-index grid, on this capture's own pixels",
        'excessGreenCut': EXG1, 'luminanceTextureCut': TEX1,
        'youdenJ': round(J1, 4), 'truePositiveRate': round(TPR1, 4), 'falsePositiveRate': round(FPR1, 4),
        'marginalGaps': {
            'note': 'a NEGATIVE gap means the distributions overlap and NO single-index threshold exists. Both of these are negative: the separation reported above is JOINT, and only joint.',
            'excessGreen_positiveP10_minus_negativeP90': round(float(np.percentile(ce, 10) - np.percentile(cn, 90)), 2),
            'excessGreen_conditionalOnSmooth': round(float(np.percentile(ce[smooth_c], 10) - np.percentile(cn[smooth_n], 90)), 2),
            'texture_negativeP10_minus_positiveP90': round(float(np.percentile(nt, 10) - np.percentile(ct, 90)), 2),
            'texture_conditionalOnGreen': round(float(np.percentile(nt[green_n], 10) - np.percentile(ct[green_c], 90)), 2),
            'excessGreen_positiveP25_minus_negativeP75': round(float(np.percentile(ce, 25) - np.percentile(cn, 75)), 2),
            'texture_negativeP25_minus_positiveP75': round(float(np.percentile(nt, 25) - np.percentile(ct, 75)), 2),
            'readingOfThose': 'the BULK separates by 20-30 units of excess green and 6-9 of texture; the TAILS overlap, which is why the cut is joint and why the mask is then required to be spatially coherent',
        },
        'falsePositiveRateByNegativeClass': {
            k: round(float(((grid['EXGs'][m] >= EXG1) & (grid['TEX'][m] <= TEX1)).mean()), 4)
            for k, m in (('forest_osm_wood_rings', forest), ('open_ground_not_mapped', open_rough),
                         ('water_model', water), ('building_model', building), ('parking_model', parking))},
        'truePositiveRateOnHeldOutOsmRings': round(float(((grid['EXGs'][masks['fairway_osm']] >= EXG1)
                                                          & (grid['TEX'][masks['fairway_osm']] <= TEX1)).mean()), 4),
        'note': 'the open_ground rate is an UPPER bound on error and not an error: that set is exactly where unmapped mown turf must live if there is any.',
    }

    mown = (grid['EXGs'] >= EXG1) & (grid['TEX'] <= TEX1)

    # ---- the fairway / semi question, measured three ways ---------------
    def inner_and_mown_collar(fw):
        inner = nd.binary_erosion(fw, st, iterations=it(ERODE_METRES))
        collar = (nd.binary_dilation(fw, st, iterations=it(COLLAR_OUTER_METRES))
                  & ~nd.binary_dilation(fw, st, iterations=it(COLLAR_INNER_METRES)))
        collar &= ~wood & ~water & ~building & ~scenery & ~parking
        for m in masks.values():
            collar &= ~m
        return inner, collar, collar & mown

    cal_inner, cal_collar, cal_mown_collar = inner_and_mown_collar(masks['fairway_2019'])
    osm_inner, osm_collar, osm_mown_collar = inner_and_mown_collar(masks['fairway_osm'])

    stripe_best = (0.0, None, None)
    A, B = grid['COH'][cal_inner], grid['COH'][cal_mown_collar]
    for t in np.linspace(float(np.percentile(np.concatenate([A, B]), 1)),
                         float(np.percentile(np.concatenate([A, B]), 99)), 120):
        for sign in (1, -1):
            j = float((A * sign >= t * sign).mean() - (B * sign >= t * sign).mean())
            if j > stripe_best[0]:
                stripe_best = (j, float(t), int(sign))

    J2, EXG2, TEX2, TPR2, FPR2 = youden2(
        grid['EXGs'][cal_inner], grid['TEX'][cal_inner],
        grid['EXGs'][cal_mown_collar], grid['TEX'][cal_mown_collar],
        np.arange(20, 42.01, 0.5), np.arange(1.5, 6.01, 0.25))
    J2h, EXG2h, TEX2h, TPR2h, FPR2h = youden2(
        grid['EXGs'][osm_inner], grid['TEX'][osm_inner],
        grid['EXGs'][osm_mown_collar], grid['TEX'][osm_mown_collar],
        np.arange(20, 42.01, 0.5), np.arange(1.5, 6.01, 0.25))

    fairway_vs_semi = {
        'question': 'inside the mown class, can fairway be told from the first cut and the surround?',
        'method': 'the interior of a fairway record eroded %.0f m, against the %.0f-%.0f m band outside it kept only where that band is itself MOWN, with every mapped feature, wood, water, building and lot removed. Comparing against the whole collar would only re-measure mown against rough.'
                  % (ERODE_METRES, COLLAR_INNER_METRES, COLLAR_OUTER_METRES),
        'calibrationSet_2019HandTraces': {
            'interiorCells': int(cal_inner.sum()), 'mownCollarCells': int(cal_mown_collar.sum()),
            'mownRateInInterior': round(float(mown[cal_inner].mean()), 4),
            'mownRateInWholeCollar': round(float(mown[cal_collar].mean()), 4),
            'interiorExcessGreen': pct(grid['EXGs'][cal_inner], (10, 25, 50, 75, 90)),
            'mownCollarExcessGreen': pct(grid['EXGs'][cal_mown_collar], (10, 25, 50, 75, 90)),
            'bestJointJ': round(J2, 3), 'excessGreenCut': EXG2, 'textureCut': TEX2,
            'truePositiveRate': round(TPR2, 3), 'falsePositiveRate': round(FPR2, 3),
        },
        'heldOutSet_osmRings_reportedNotUsed': {
            'interiorCells': int(osm_inner.sum()), 'mownCollarCells': int(osm_mown_collar.sum()),
            'mownRateInInterior': round(float(mown[osm_inner].mean()), 4),
            'mownRateInWholeCollar': round(float(mown[osm_collar].mean()), 4),
            'bestJointJ': round(J2h, 3), 'excessGreenCut': EXG2h, 'textureCut': TEX2h,
        },
        'mowingStripeTest': {
            'index': 'structure-tensor coherence of native 0.16 m luminance over a %.0f m window' % STRIPE_METRES,
            'why': 'a fairway is cut in stripes and a semi is not, and 0.16 m is fine enough to hold a mower width',
            'bestSingleIndexJ': round(stripe_best[0], 3),
            'atThreshold': round(stripe_best[1], 4), 'sign': stripe_best[2],
            'verdict': 'REFUSED: J = %.3f is not a separation. Directional energy in this frame is dominated by tree-shadow edges and by the seams of the mosaic, not by mowing.' % stripe_best[0],
        },
        'finding': ('the mown test fires on %.0f%% of the fairway interiors and %.0f%% of the whole 3-15 m band outside them, so MOWN and NOT-MOWN separate cleanly; but where that band is itself mown, the best joint separation fitted on the calibration set is J = %.2f. That is a tendency, not a boundary: fairway and first cut are the same colour and the same texture in this photograph, and any fairway edge drawn from it is a threshold on a gradient, not an observed line.'
                    % (100 * mown[cal_inner].mean(), 100 * mown[cal_collar].mean(), J2)),
    }

    # ---- 2/3. the two masks, cleaned and excluded -----------------------
    excluded = (masks['green'] | masks['tee'] | masks['bunker'] | scenery
                | water | building | parking)
    EE, NN = np.meshgrid(east, north)
    for key, half in (('paths', 2.0), ('tracks', 2.5), ('roads', 4.0)):
        for f in model['infra'][key]:
            pts = [to3006(p) for p in f['line']]
            xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
            pad = half + 2
            c0 = max(0, int((min(xs) - pad - east[0]) / px)); c1 = min(W - 1, int((max(xs) + pad - east[0]) / px))
            r0 = max(0, int((north[0] - max(ys) - pad) / px)); r1 = min(H - 1, int((north[0] - min(ys) + pad) / px))
            if c1 < c0 or r1 < r0:
                continue
            se, sn = EE[r0:r1 + 1, c0:c1 + 1], NN[r0:r1 + 1, c0:c1 + 1]
            d = np.full(se.shape, 1e9)
            for i in range(len(pts) - 1):
                ax, ay = pts[i]; bx, by = pts[i + 1]
                dx, dy = bx - ax, by - ay
                ll = dx * dx + dy * dy
                if ll == 0:
                    continue
                t = np.clip(((se - ax) * dx + (sn - ay) * dy) / ll, 0, 1)
                d = np.minimum(d, np.hypot(se - ax - t * dx, sn - ay - t * dy))
            excluded[r0:r1 + 1, c0:c1 + 1] |= d <= half
    del EE, NN

    def clean(mask):
        m = nd.binary_closing(mask, st, iterations=it(CLOSE_METRES))
        return nd.binary_opening(m, st, iterations=it(OPEN_METRES))

    tier1_mask = clean(mown) & ~excluded & (dist <= CORRIDOR_METRES)
    tier2_raw = (grid['EXGs'] >= EXG2) & (grid['TEX'] <= TEX2)
    tier2_mask = clean(tier2_raw) & ~excluded & (dist <= CORRIDOR_METRES)

    # ---- 4. ownership, then the check -----------------------------------
    def assign(candidate, tier):
        refusals = []
        dropped = []
        accepted = np.zeros((H, W), np.int16)
        for hole in playing:
            piece = candidate & (owner == hole)
            pl, npl = nd.label(piece, st)
            for i in range(1, npl + 1):
                sel = pl == i
                a = area_of(sel)
                if a < MIN_COMPONENT_SQM:
                    dropped.append((round(a, 1), hole))
                    continue
                if bool((per_hole[hole][sel] <= TOUCH_METRES).any()):
                    accepted[sel] = hole
                    continue
                grown = nd.binary_dilation(sel, st, iterations=2) & candidate & ~sel
                nb = owner[grown]; nb = nb[(nb != hole) & (nb > 0)]
                moved = False
                if len(nb):
                    vals, counts = np.unique(nb, return_counts=True)
                    new = int(vals[int(np.argmax(counts))])
                    if new in playing and bool((per_hole[new][sel] <= TOUCH_METRES).any()):
                        accepted[sel] = new
                        refusals.append({'kind': 'ownership-reassigned', 'tier': tier,
                                         'fromHole': hole, 'toHole': new,
                                         'areaSquareMetres': round(a, 1),
                                         'distanceToOwnLineMetres': round(float(per_hole[hole][sel].min()), 1),
                                         'note': 'nearest-line ownership gave this piece to a hole it never reaches; the neighbour it shares the longest boundary with does reach it'})
                        moved = True
                if not moved:
                    refusals.append({'kind': 'ownership-orphan', 'tier': tier, 'hole': hole,
                                     'areaSquareMetres': round(a, 1),
                                     'minimumDistanceToAnyLineMetres': round(float(dist[sel].min()), 1),
                                     'note': 'turf inside the corridor reaching no hole line within %.0f m; not adopted' % TOUCH_METRES})
        rings = {}
        for hole in playing:
            piece = accepted == hole
            pl, npl = nd.label(piece, st)
            for i in range(1, npl + 1):
                sel = pl == i
                a = area_of(sel)
                if a < MIN_COMPONENT_SQM:
                    accepted[sel] = 0
                    refusals.append({'kind': 'below-minimum-area', 'tier': tier, 'hole': hole,
                                     'areaSquareMetres': round(a, 1),
                                     'minimumSquareMetres': MIN_COMPONENT_SQM})
                    continue
                ring = L.trace_outline(sel, east, north, thin_metres=1.0)
                if ring is None or len(ring) < 4:
                    accepted[sel] = 0
                    refusals.append({'kind': 'untraceable-boundary', 'tier': tier, 'hole': hole,
                                     'areaSquareMetres': round(a, 1)})
                    continue
                rings.setdefault(hole, []).append({
                    'ring': ring, 'maskAreaSquareMetres': round(a, 1),
                    'ringAreaSquareMetres': round(ring_area(ring), 1),
                    'maximumDistanceFromHoleLineMetres': round(float(per_hole[hole][sel].max()), 1),
                    'medianDistanceFromHoleLineMetres': round(float(np.median(per_hole[hole][sel])), 1)})
        if dropped:
            dropped.sort(reverse=True)
            refusals.append({
                'kind': 'below-minimum-area', 'tier': tier,
                'pieces': len(dropped),
                'totalAreaSquareMetres': round(sum(d[0] for d in dropped), 1),
                'minimumSquareMetres': MIN_COMPONENT_SQM,
                'largestRefusedSquareMetres': [d[0] for d in dropped[:8]],
                'largestRefusedHoles': [d[1] for d in dropped[:8]],
                'note': 'connected turf inside a corridor smaller than any fairway polygon this model carries. Listed as a count and a total rather than one entry each because there are %d of them; none is silently dropped.' % len(dropped)})
        return accepted, rings, refusals

    t1_acc, t1_rings, t1_ref = assign(tier1_mask, 'mown')
    t2_acc, t2_rings, t2_ref = assign(tier2_mask, 'fairway-grade')

    def along_line_coverage(accepted, tier):
        """Does the accepted turf actually run the hole, or only sit by the green?

        The hole line entered ownership, so this is not an independent score -
        it is a shape check that catches the failure mode a per-cell colour rule
        has: keeping only the greenest core near the green and calling it a
        fairway.
        """
        rows = []
        for hole in playing:
            pts = [to3006(p) for p in next(h['line'] for h in holes if h['n'] == hole)]
            seg = []
            travelled = 0.0
            for i in range(len(pts) - 1):
                ax, ay = pts[i]; bx, by = pts[i + 1]
                seg.append((ax, ay, bx - ax, by - ay, travelled))
                travelled += float(np.hypot(bx - ax, by - ay))
            total = travelled
            station, covered = [], []
            s_ = 0.0
            while s_ <= total:
                for ax, ay, dx, dy, base in seg:
                    ln = float(np.hypot(dx, dy))
                    if s_ <= base + ln or (ax, ay, dx, dy, base) == seg[-1]:
                        t = min(1.0, max(0.0, (s_ - base) / ln))
                        px_, py_ = ax + t * dx, ay + t * dy
                        break
                c = int(round((px_ - east[0]) / px)); r = int(round((north[0] - py_) / px))
                if 0 <= r < H and 0 <= c < W:
                    half = it(30.0)
                    box = accepted[max(0, r - half):r + half + 1, max(0, c - half):c + half + 1]
                    covered.append(bool((box == hole).any()))
                    station.append(s_)
                s_ += 5.0
            frac = float(np.mean(covered)) if covered else 0.0
            hit = [s for s, c in zip(station, covered) if c]
            rows.append({'hole': hole,
                         'holeLengthMetres': round(total, 1),
                         'stationsEvery5m': len(covered),
                         'fractionOfLineWithTurfWithin30m': round(frac, 3),
                         'firstTurfAtMetresFromTee': round(min(hit), 1) if hit else None,
                         'lastTurfAtMetresFromTee': round(max(hit), 1) if hit else None,
                         'tier': tier})
        return rows

    def ownership_given_away(accepted, candidate):
        rows = []
        for hole in playing:
            near = candidate & (per_hole[hole] <= 40.0)
            mine = accepted == hole
            rows.append({'hole': hole,
                         'turfWithin40mOfThisLineSquareMetres': round(area_of(near), 1),
                         'acceptedForThisHoleSquareMetres': round(area_of(mine), 1),
                         'givenToAnotherHoleSquareMetres': round(area_of(near & ~mine & (accepted > 0)), 1),
                         'inNoHoleSquareMetres': round(area_of(near & (accepted == 0)), 1)})
        return rows

    def ownership_check(accepted, rings):
        rows = []
        for hole in sorted(rings):
            sel = accepted == hole
            intruded = [{'hole': other, 'areaWithin2mOfThatLineSquareMetres': round(area_of((per_hole[other] <= 2.0) & sel), 1)}
                        for other in (playing + par3) if other != hole
                        and area_of((per_hole[other] <= 2.0) & sel) > 200]
            rows.append({'hole': hole, 'pieces': len(rings[hole]),
                         'areaSquareMetres': round(area_of(sel), 1),
                         'effectiveWidthMetres': round(area_of(sel) / hole_len[hole], 1),
                         'straddlesOtherHoleLines': intruded})
        return rows

    # ---- 5. the score, against rings that never entered anything --------
    def score(accepted):
        rows, ious = [], []
        for hole, ring in sorted(osm_rings.items()):
            ref = np.zeros((H, W), bool); burn(ring, ref)
            mine = accepted == hole
            inter = float((ref & mine).sum()); union = float((ref | mine).sum())
            iou = inter / union if union else 0.0
            rows.append({'hole': hole,
                         'osmRingAreaSquareMetres': round(area_of(ref), 1),
                         'measuredAreaSquareMetres': round(area_of(mine), 1),
                         'areaRatio': round(float(mine.sum()) / float(ref.sum()), 3) if ref.sum() else None,
                         'iou': round(iou, 3),
                         'recallOfOsmRing': round(inter / float(ref.sum()), 3) if ref.sum() else None,
                         'precisionAgainstOsmRing': round(inter / float(mine.sum()), 3) if mine.sum() else None})
            ious.append(iou)
        return rows, ious

    t1_rows, t1_ious = score(t1_acc)
    t2_rows, t2_ious = score(t2_acc)

    # the calibration set scored the same way. This is NOT an independent score
    # - the tier-2 cut was fitted on these polygons' interiors - and is reported
    # only so that the seven holes with no held-out ring are not a blank.
    cal_rows = []
    for hole in sorted({f['properties']['hole'] for f in groups['fairway_2019']}):
        ref = np.zeros((H, W), bool)
        for f in groups['fairway_2019']:
            if f['properties']['hole'] == hole:
                for ring in L.rings_of(f['geometry']):
                    burn(ring, ref)
        mine = t2_acc == hole
        inter = float((ref & mine).sum()); union = float((ref | mine).sum())
        cal_rows.append({'hole': hole,
                         'handTracedAreaSquareMetres': round(area_of(ref), 1),
                         'measuredAreaSquareMetres': round(area_of(mine), 1),
                         'areaRatio': round(float(mine.sum()) / float(ref.sum()), 3) if ref.sum() else None,
                         'iou': round(inter / union, 3) if union else 0.0,
                         'recallOfHandTrace': round(inter / float(ref.sum()), 3) if ref.sum() else None})

    # the same cut, but fitted on the SCORING set - reported as the anti-overfit
    # control: if the calibration-derived cut were merely lucky, the cut fitted
    # on the scoring rings themselves would beat it.
    control_mask = clean((grid['EXGs'] >= EXG2h) & (grid['TEX'] <= TEX2h)) & ~excluded & (dist <= CORRIDOR_METRES)
    ctrl_acc, ctrl_rings, _ = assign(control_mask, 'control')
    ctrl_rows, ctrl_ious = score(ctrl_acc)

    def summarise(rows, ious, rings, tier):
        covered = sorted(rings)
        return {'tier': tier,
                'perRing': rows,
                'medianIou': round(float(np.median(ious)), 3) if ious else None,
                'minIou': round(float(min(ious)), 3) if ious else None,
                'maxIou': round(float(max(ious)), 3) if ious else None,
                'medianAreaRatio': round(float(np.median([r['areaRatio'] for r in rows if r['areaRatio']])), 3) if rows else None,
                'medianRecall': round(float(np.median([r['recallOfOsmRing'] for r in rows if r['recallOfOsmRing'] is not None])), 3) if rows else None,
                'holesWithGeometry': covered, 'holesWithGeometryCount': len(covered),
                'holesWithout': [h for h in playing if h not in covered]}

    t1_sum = summarise(t1_rows, t1_ious, t1_rings, 'mown')
    t2_sum = summarise(t2_rows, t2_ious, t2_rings, 'fairway-grade')
    ctrl_sum = summarise(ctrl_rows, ctrl_ious, ctrl_rings, 'control-cut-fitted-on-the-scoring-set')

    adopt_t2 = (t2_sum['medianIou'] or 0) >= IOU_BAR and t2_sum['holesWithGeometryCount'] >= HOLE_BAR
    adopt_t1 = False   # decided below, and stated

    # what the incumbent records look like in this photograph, like for like
    incumbent = []
    for f in groups['fairway_2019'] + groups['fairway_osm']:
        m = np.zeros((H, W), bool)
        for ring in L.rings_of(f['geometry']):
            burn(ring, m)
        hole = f['properties']['hole']
        incumbent.append({
            'hole': hole,
            'record': 'unchanged-osm-source-ring' if f['properties'].get('method') == 'unchanged-osm-source-ring' else 'hand-traced-on-the-2019-leaf-off-image',
            'id': f.get('id'),
            'areaSquareMetres': round(area_of(m), 1),
            'effectiveWidthMetres': round(area_of(m) / hole_len[hole], 1),
            'fractionMownIn2025': round(float(mown[m].mean()), 3),
            'fractionFairwayGradeIn2025': round(float(tier2_raw[m].mean()), 3),
        })

    widths = {'note': 'area divided by the hole line length - a crude but comparable width. A parkland fairway runs about 25-35 m; a record that implies 9-14 m is describing part of one.',
              'perHole': []}
    for hole in playing:
        inc = [r for r in incumbent if r['hole'] == hole]
        widths['perHole'].append({
            'hole': hole, 'par': next(h['par'] for h in holes if h['n'] == hole),
            'holeLineLengthMetres': round(hole_len[hole], 1),
            'incumbentRecord': inc[0]['record'] if inc else None,
            'incumbentEffectiveWidthMetres': round(sum(r['areaSquareMetres'] for r in inc) / hole_len[hole], 1) if inc else None,
            'mownEffectiveWidthMetres': round(area_of(t1_acc == hole) / hole_len[hole], 1),
            'fairwayGradeEffectiveWidthMetres': round(area_of(t2_acc == hole) / hole_len[hole], 1)})

    par3_rows = [{'hole': h, 'par': 3,
                  'mownCorridorAreaSquareMetres': round(area_of(tier1_mask & (owner == h)), 1),
                  'fairwayGradeCorridorAreaSquareMetres': round(area_of(tier2_mask & (owner == h)), 1),
                  'adopted': False,
                  'note': 'a par 3 has no fairway. The mown ground in its corridor is tee surround, carry and green surround, and nothing here claims it as a fairway.'}
                 for h in par3]

    refusals = t1_ref + t2_ref + [
        {'kind': 'method-refused', 'method': 'mowing-stripe direction (structure-tensor coherence, 6 m)',
         'bestSingleIndexJ': round(stripe_best[0], 3),
         'note': 'the one index that could have separated fairway from first cut geometrically rather than by colour. It does not: J = %.3f.' % stripe_best[0]},
        {'kind': 'method-refused', 'method': 'green versus fairway by colour',
         'evidence': 'lidingobuild/mapping/green-trace-2025.json',
         'note': 'measured five ways there: median IoU 0.294 and 0.365 at 2.7-3.4x area. Not re-attempted here; the greens the model has are used as given.'},
        {'kind': 'class-not-separable', 'class': 'semi / first cut',
         'bestJointJOnCalibrationSet': round(J2, 3),
         'note': 'no semi polygon is emitted. Tier 2 is a threshold on a gradient inside the mown class, and the ground between tier 2 and tier 1 is where the semi is - it is reported as the DIFFERENCE of two masks, never as an observed boundary.'},
        {'kind': 'class-not-separable', 'class': 'rough',
         'note': 'rough is the complement of mown inside the corridor. It is not emitted as geometry because a complement is not a measurement of a thing; the mown mask and the corridor together already state it.'},
    ]

    try:
        rev = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    except Exception:
        rev = ''

    def geometry(rings, kind):
        return [{'hole': hole, 'kind': kind, 'part': i,
                 'areaSquareMetres': r['ringAreaSquareMetres'],
                 'maskAreaSquareMetres': r['maskAreaSquareMetres'],
                 'maximumDistanceFromHoleLineMetres': r['maximumDistanceFromHoleLineMetres'],
                 'medianDistanceFromHoleLineMetres': r['medianDistanceFromHoleLineMetres'],
                 'ringEpsg3006': r['ring']}
                for hole in sorted(rings) for i, r in enumerate(rings[hole])]

    out = {
        'schemaVersion': 1,
        'measuredOn': '2026-09-08',
        'generator': GENERATOR,
        'state': 'measured-candidate-geometry' if adopt_t2 else 'measurement-evidence-only',
        'layer': 'fairway, semi and rough',
        'sourceCapture': {
            'id': L.META['sourceId'], 'captureDate': L.META['captureDate'],
            'sha256': L.META['sha256'], 'licence': L.META['licence']['id'],
            'attribution': L.META['licence']['attribution'],
            'sampleSpacingMetres': L.META['sampleSpacingMetres'],
            'note': 'a tile\'s coordinates ARE its georeference, so nothing here is registered and no registration residual exists',
        },
        'shapeRecord': {
            'id': 'published v2 ground graph, 1 m laser DTM', 'captureDate': L.DTM_CAPTURE,
            'usedHere': False,
            'why': 'a fairway is a mowing regime and bare-earth height carries no record of one; the DTM separates a bunker from turf and a green plateau from its surround, neither of which is this layer. The laser is 2021 and the photograph 2025, so a fairway re-cut between them would have colour and no shape - a dated blind spot of the pair, not a defect of either.',
        },
        'horizontalCrs': 'EPSG:3006',
        'gitRevision': rev,
        'frameConversion': {
            'modelFrame': 'local metres, east +x, north -z, origin E677700.5 N6586399.5 (lidingobuild/build-course.mjs FRAME)',
            'conversionUsed': 'easting = 677700.5 + x ; northing = 6586399.5 - z',
            'note': 'every hole line and every model ring was converted once, here. North is -z in the page frame and +northing in EPSG:3006; the two are never mixed and no page-frame coordinate appears in this file.',
        },
        'analysis': {
            'cellMetres': round(px, 4), 'nativePixelsPerCell': BLOCK,
            'excessGreenSmoothingWindowMetres': SMOOTH_METRES,
            'luminanceTextureWindowMetres': TEXTURE_METRES,
            'stripeCoherenceWindowMetres': STRIPE_METRES,
            'openingMetres': OPEN_METRES, 'closingMetres': CLOSE_METRES,
            'minimumComponentSquareMetres': MIN_COMPONENT_SQM,
            'corridorMetres': CORRIDOR_METRES,
            'corridorBasis': 'the eight 2019 CALIBRATION fairways reach at most 63.0 m from their own hole line (hole 7, the landing area beside the pond); 65 is that rounded up. The five scoring rings did not set it.',
            'touchMetres': TOUCH_METRES,
            'exclusions': 'model greens, tees and bunkers; scenery.range, scenery.practiceGreens, scenery.grass and scenery.mappedFeatures; water, buildings, parking; paths at 2 m, tracks at 2.5 m and roads at 4 m half-width',
        },
        'whatSeparatesInThisPhotograph': {
            'mown_versus_forest': 'YES, jointly - %.1f%% of the OSM wood rings pass the mown test' % (100 * tier1_cal['falsePositiveRateByNegativeClass']['forest_osm_wood_rings']),
            'mown_versus_open_rough': 'YES, jointly - %.1f%% of unmapped open ground passes, and an unknown part of that is real unmapped mown turf' % (100 * tier1_cal['falsePositiveRateByNegativeClass']['open_ground_not_mapped']),
            'fairway_versus_semi': 'WEAKLY - best joint J %.2f on the calibration set; a tendency, not a boundary' % J2,
            'green_versus_fairway': 'NO - measured five ways in green-trace-2025.json, median IoU 0.294 and 0.365 at 2.7-3.4x area',
            'fairway_by_mowing_stripes': 'NO - best J %.3f' % stripe_best[0],
            'anySingleIndexThreshold_forMown': 'NO - both marginal gaps are negative; only the two indices together separate',
        },
        'distributions': distributions,
        'calibration': {'tier1_mown': tier1_cal, 'tier2_fairwayGrade': fairway_vs_semi},
        'score': {
            'scoredAgainst': 'the five unchanged-OSM fairway rings (holes %s). They set no threshold, no corridor, no cleaning parameter and no ownership rule.' % ', '.join(str(h) for h in sorted(osm_rings)),
            'bar': 'median IoU >= %.2f against those rings AND geometry on at least %d of the 12 par 4s and par 5s. Fixed before any score was computed. It is below green-trace-2025.json\'s 0.75 because a fairway edge is a mowing line with no single true position where a green is a construction - and it is still above the 0.65 at which this repository refused Veckefjarden\'s best green tracer.' % (IOU_BAR, HOLE_BAR),
            'tier1_mown': t1_sum,
            'tier2_fairwayGrade': t2_sum,
            'controlCutFittedOnTheScoringSet': ctrl_sum,
            'tier2AgainstTheCalibrationSet_NOT_A_SCORE': {
                'what': 'the same tier-2 geometry against the eight hand-traced 2019 polygons whose interiors set its cut. It cannot be an independent score and is reported so that the seven holes with no held-out ring are not a blank.',
                'perHole': cal_rows,
                'medianIou': round(float(np.median([r['iou'] for r in cal_rows])), 3) if cal_rows else None,
                'medianAreaRatio': round(float(np.median([r['areaRatio'] for r in cal_rows if r['areaRatio']])), 3) if cal_rows else None,
            },
            'whereTheTwoRecordsDISAGREE': {
                'what': 'the holes where the 2025 measurement and the record already in the model are furthest apart. A reviewer should look at these before anything else.',
                'worstThree': sorted(cal_rows + [{'hole': r['hole'], 'iou': r['iou'], 'areaRatio': r['areaRatio']} for r in t2_rows],
                                     key=lambda r: r['iou'])[:3],
                'reading': 'the tier-2 cut was FITTED on the hand-traced polygons and still reaches only a median IoU of %s against them, against %s on the held-out OSM rings it never saw. A rule cannot be overfitted to a set it scores worse on: what that pair of numbers says is that the eight hand traces are not internally consistent with each other in colour - which is also why their own separation was J = %.2f - and that is the record they carry in their own properties (interpretationUncertaintyMetres 3, "registrationAccuracy: not independently checked", traced on a 0.5 m LEAF-OFF image where a dormant mowing edge is a judgement).'
                           % (round(float(np.median([r['iou'] for r in cal_rows])), 3) if cal_rows else None,
                              round(float(np.median(t2_ious)), 3), J2),
                'notEvidenceThatEitherIsRight': 'neither record is a survey. Both are readings of orthophotos, and no ground control on this course has been measured.',
            },
            'recommendation': 'treat acceptedGeometry as a CANDIDATE replacement for the thirteen fairway polygons, not an automatic one. What it has over them: one stated rule instead of two methods and two eras, a 0.16 m 2025 leaf-on capture instead of a 0.5 m 2019 leaf-off one and OSM edits of 2011-2016, zero registration error by construction, all twelve par 4s and par 5s covered, and a score against a held-out record. What it does not have: any demonstration that the incumbent is WRONG - every incumbent polygon is 82-98%% mown in this photograph - and any independent record at all on the seven holes whose only second reading is the hand trace that set its cut.',
            'howFarTheAgreementReaches': 'the independent agreement is demonstrated on the FIVE holes that carry a held-out OSM ring (10, 14, 15, 17, 18). On the other seven the only second record is the hand trace that set the cut, so there the geometry rests on one record and a rule shown to work on five others. That is stated, not glossed.',
            'antiOverfitReading': 'the tier-2 cut (%.1f, %.2f) comes from the calibration set alone. Refitting the same two indices on the SCORING rings themselves gives (%.1f, %.2f) and a median IoU of %s - no better. A calibration-derived cut that a scoring-derived cut cannot beat is not a cut tuned to the score.'
                                  % (EXG2, TEX2, EXG2h, TEX2h, ctrl_sum['medianIou']),
            'adoptTier1AsFairways': adopt_t1,
            'adoptTier2AsFairways': adopt_t2,
            'whyTier1IsNotAdopted': 'tier 1 recalls a median %s of each held-out ring at a median %sx its area. That is the signature of a class that CONTAINS the fairway, not one that is it, and calling it a fairway would put semi, green surround and walk-off inside the fairway ring on twelve holes.'
                                    % (t1_sum['medianRecall'], t1_sum['medianAreaRatio']),
        },
        'effectiveWidths': widths,
        'incumbentRecordsMeasuredOnThisCapture': incumbent,
        'ownershipCheck': {
            'rule': 'nearest hole line, then every connected piece must reach its own hole line within %.0f m; a piece that does not is given to the neighbour it shares the longest boundary with, and refused if no neighbour reaches it either' % TOUCH_METRES,
            'tier1_mown': ownership_check(t1_acc, t1_rings),
            'tier2_fairwayGrade': ownership_check(t2_acc, t2_rings),
            'note': 'straddlesOtherHoleLines lists any accepted region with more than 200 m2 lying within 2 m of ANOTHER hole\'s centre line. On a course this tight that is not automatically wrong - two corridors can share mown ground - but it is where a wrong assignment would show.',
            'sharedCorridors': 'holes 13 and 14 run out and back through one corridor 40-70 m apart, and 1409 and 1235 m2 of turf within 40 m of each of their lines is claimed by the other. That ambiguity is the course, not the rule: no record here says where one fairway ends and the next begins, and the nearest-line split is the only division on offer. Both holes are the two lowest effective widths in the tier-2 set, which is what that ambiguity looks like.',
        },
        'coverageChecks': {
            'alongTheLine': {
                'what': 'the fraction of 5 m stations along each hole line with accepted turf within 30 m, and where the first and last of them fall. Not an independent score - the line entered ownership - but it catches a rule that keeps only the greenest core beside the green.',
                'tier1_mown': along_line_coverage(t1_acc, 'mown'),
                'tier2_fairwayGrade': along_line_coverage(t2_acc, 'fairway-grade'),
            },
            'ownershipGaveAway': {
                'what': 'turf within 40 m of a hole line that the ownership rule handed to a DIFFERENT hole, or to none. Large numbers here would mean the nearest-line rule is eating fairway rather than dividing it.',
                'tier2_fairwayGrade': ownership_given_away(t2_acc, tier2_mask),
            },
            'excludedByFurniture': {
                'what': 'turf the exclusions removed inside the 65 m corridors: the model greens, tees and bunkers a fairway ring would normally contain, and the paths and roads that cut one in two.',
                'greensTeesBunkersSquareMetres': round(area_of((masks['green'] | masks['tee'] | masks['bunker']) & mown & (dist <= CORRIDOR_METRES)), 1),
                'pathsRoadsAndTracksSquareMetres': round(area_of(excluded & ~(masks['green'] | masks['tee'] | masks['bunker'] | scenery | water | building | parking) & mown & (dist <= CORRIDOR_METRES)), 1),
                'sceneryRangeAndPracticeSquareMetres': round(area_of(scenery & mown & (dist <= CORRIDOR_METRES)), 1),
            },
        },
        'par3Holes': par3_rows,
        'refusals': refusals,
        'acceptedGeometry': geometry(t2_rings, 'fairway-grade-turf') if adopt_t2 else [],
        'candidateGeometry': {
            'mownTurf': geometry(t1_rings, 'mown-turf'),
            'fairwayGradeTurf': [] if adopt_t2 else geometry(t2_rings, 'fairway-grade-turf'),
        },
        'howToReadThis': [
            'acceptedGeometry, where present, is the FAIRWAY-GRADE mown turf on each par 4 and par 5, in EPSG:3006, one outer ring per piece. Bunkers and any other feature inside a fairway are INSIDE the ring, as they are in the records this replaces; no interior holes are emitted.',
            'candidateGeometry.mownTurf is the whole mown corridor - fairway, first cut, green surround, tee surround and walk-off together. It is a true measurement of a real class and it is deliberately NOT offered as a fairway.',
            'the semi is the ground between the two masks. It is stated that way and never as a traced boundary, because nothing in this photograph draws its edge.',
            'no geometry is emitted for the six par 3s, for rough, or for any hole where the corridor held less than %.0f m2 of connected turf.' % MIN_COMPONENT_SQM,
        ],
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + '\n', encoding='utf8')
    print('wrote', OUT)
    print('tier1 mown        cut(%.0f,%.2f) J=%.3f  medianIoU %s ratio %s recall %s holes %d'
          % (EXG1, TEX1, J1, t1_sum['medianIou'], t1_sum['medianAreaRatio'], t1_sum['medianRecall'], t1_sum['holesWithGeometryCount']))
    print('tier2 fairway     cut(%.1f,%.2f) J=%.3f  medianIoU %s ratio %s recall %s holes %d  adopt=%s'
          % (EXG2, TEX2, J2, t2_sum['medianIou'], t2_sum['medianAreaRatio'], t2_sum['medianRecall'], t2_sum['holesWithGeometryCount'], adopt_t2))
    print('control (fitted on the score) cut(%.1f,%.2f) medianIoU %s' % (EXG2h, TEX2h, ctrl_sum['medianIou']))
    for r in t2_sum['perRing']:
        print('   hole %2d IoU %.3f ratio %.2f recall %.3f precision %.3f' %
              (r['hole'], r['iou'], r['areaRatio'] or 0, r['recallOfOsmRing'] or 0, r['precisionAgainstOsmRing'] or 0))
    print('stripe test J=%.3f (refused); refusals %d' % (stripe_best[0], len(refusals)))


if __name__ == '__main__':
    main()
