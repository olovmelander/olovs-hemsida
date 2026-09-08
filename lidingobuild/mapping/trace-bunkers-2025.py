"""The bunker layer read off the 2025-05-31 capture: confirm, outline, refuse, date.

detect-bunkers.py does the hard part - sand in the imagery over a hollow in the
published 1 m laser DTM, every colour threshold calibrated on this capture's own
pixels, scored by how many of the 40 already-mapped bunkers it recovers. This
runs that same pass, through the same imported code, and answers the three
questions the detector stops short of.

  1. WHICH mapped bunker does each accepted component confirm, and what is its
     outline on THIS capture? Angso's rule is the precedent: a confirmed bunker
     takes the DETECTION's outline, because that outline is measured on
     orthorectified pixels at 0.16 m while the mapped ring was digitised by hand
     off a 0.5 m frame. An unconfirmed one KEEPS ITS OWN RING and is listed as
     unconfirmed with the numbers that refused it. Never dropped.
  2. What is accepted FAR from any mapped bunker? Reported as a candidate with
     its distance to the nearest hole line, its nearest mapped bunker, and what
     the 2018 and 2019 captures show on the same ground. Adopted only where a
     second record agrees - and here, none does.
  3. What reads sand with NO hollow under it? That is a DATED blind spot and not
     a defect of either record: the laser is 2021-03-23 and the photograph
     2025-05-31, so a bunker built between them has colour and no shape BY
     CONSTRUCTION. Every one is sampled in 2018 and 2019 the way
     date-course-changes.py samples a dated site - against mown turf 12 m away in
     the SAME frame, because each capture is exposed differently and "bright"
     means nothing on its own.

The registration between the two records is measured the way Angso measured its
own: the median offset over the confirmed pairs.

  python3 lidingobuild/mapping/trace-bunkers-2025.py [--write]

Writes lidingobuild/mapping/bunker-trace-2025.json. It does not touch
playing-surfaces.geojson; adoption is somebody else's decision to make.
"""
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage as nd
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'lidingobuild/mapping'))
import lm2025                                                            # noqa: E402

# detect-bunkers.py IS the rule. Import it rather than restate it, so no
# threshold can drift between the detector and the layer that reads it.
_spec = importlib.util.spec_from_file_location('detect_bunkers', ROOT / 'lidingobuild/mapping/detect-bunkers.py')
DB = importlib.util.module_from_spec(_spec)
sys.modules['detect_bunkers'] = DB
_spec.loader.exec_module(DB)

STEP = DB.ANALYSIS_STEP          # 0.25 m, the detector's own analysis grid
OUTLINE_STEP = 0.1               # finer than the 0.16 m capture, so the contour is not stair-stepped by the grid
OUTLINE_HALF = 22.0              # a local box that cannot reach the next green complex
OUTLINE_SPAN_LIMIT = 30.0        # a bunker that measures 30 m across has walked into something else
OUTLINE_AREA_LIMIT = DB.MAX_AREA # the detector's own upper size gate
IOU_STEP = 0.1
RECOVERY_METRES = 12.0           # the detector's own recovery radius, kept so the score is comparable

# CONFIRM_METRES is the ONLY new threshold here and it is cut in a measured gap,
# not chosen: over the 40 mapped bunkers the distance to the nearest accepted
# component runs 0.31-2.23 m for 34 of them and then jumps to 10.17 m. The gap is
# 7.94 m wide and the cut goes midway through it. Reported below as
# `confirmationGap` so a future capture can be held to the same standard - a
# NEGATIVE gap would mean no threshold exists.
CONFIRM_METRES = 6.2

SELF_TRACED_SOURCE = 'lm-ortofoto-0p16'   # this build's hole-13 bunker was traced FROM this capture

DATING_CAPTURES = [
    ('municipal-2018', DB._municipal(2018)),
    ('municipal-2019', DB._municipal(2019)),
    ('lm-2025-05-31', lm2025.sample),
]


# --- the mapped record -------------------------------------------------------

def mapped_bunkers(surfaces):
    """The mapped rings, split into the reference set and this capture's own.

    The 2025 capture cannot score itself: commit 9af1df6 adopted a hole-13
    bunker traced from these very pixels, so it is held out of the calibration
    and out of the score and reported separately.
    """
    reference, self_traced = [], []
    for f in surfaces['features']:
        if f['properties']['kind'] != 'bunker':
            continue
        ring = lm2025.rings_of(f['geometry'])[0]
        centroid = lm2025.ring_centroid(ring)          # about the FIRST VERTEX
        row = {'hole': f['properties'].get('hole'),
               'sourceId': f['properties'].get('sourceId'),
               'sourceFeatureId': f['properties'].get('sourceFeatureId'),
               'method': f['properties'].get('method'),
               'easting': centroid[0], 'northing': centroid[1],
               'mappedAreaSquareMetres': centroid[2], 'ring': ring}
        (self_traced if row['sourceId'] == SELF_TRACED_SOURCE else reference).append(row)
    # identity is the INDEX: 29 of the 40 carry no sourceFeatureId, and keying on
    # one collapses them into a single entry (detect-bunkers' own note).
    for i, row in enumerate(reference):
        row['index'] = i
    for i, row in enumerate(self_traced):
        row['index'] = f'self-{i}'
    return reference, self_traced


def hole_lines():
    """Back tee -> tee target -> green centre, from the GolfTraxx GPS survey.

    The survey is EPSG:3006 through lm2025.survey() and never entered the sand
    rule, so a candidate's distance to play is an independent number.
    """
    lines = {}
    for hole, pts in lm2025.survey().items():
        seq = [p for p in (pts.get('TheTipsTee Back Reach'), pts.get('Tee Target'),
                           pts.get('Green Center')) if p]
        pruned = [seq[0]]
        for p in seq[1:]:
            if np.hypot(p[0] - pruned[-1][0], p[1] - pruned[-1][1]) > 1.0:
                pruned.append(p)
        lines[hole] = pruned
    return lines


def nearest_line(e, n, lines):
    best = (float('inf'), None)
    for hole, pts in lines.items():
        for a, b in zip(pts, pts[1:]):
            dx, dy = b[0] - a[0], b[1] - a[1]
            t = float(np.clip(((e - a[0]) * dx + (n - a[1]) * dy) / max(dx * dx + dy * dy, 1e-9), 0.0, 1.0))
            d = float(np.hypot(e - (a[0] + t * dx), n - (a[1] + t * dy)))
            if d < best[0]:
                best = (d, hole)
    return best


def classify_away(c, d_line, d_hard, d_prac, verdict, levels):
    """Name what an accepted component away from every mapped bunker is.

    Every cut here is measured on the 34 CONFIRMED bunkers - ground whose class
    two records already agree on - and the levels are carried in `levels` so the
    report can state them. Nothing is copied from another course.
    """
    if d_hard <= levels['hardSurfaceMetres']:
        return ('on a mapped path, paved path or car park, closer to one than any confirmed bunker gets: '
                'pale surfacing in a shallow cut, which is this rule\'s known false accept')
    if d_prac <= levels['practiceMetres']:
        return ('on the practice ground, closer to a mapped practice green, range tee or range field than any '
                'confirmed bunker gets: practice sand belongs to the practice ground, not to a hole')
    if (d_line <= levels['holeLineMetres'] and c['areaSquareMetres'] >= levels['areaSquareMetres']
            and c['medianHollowMetres'] <= levels['hollowMetres']):
        return ('inside the band every confirmed bunker occupies - near a hole line, large enough, deep enough, '
                'and clear of paths and practice ground. The strongest candidates on this course')
    return 'a small bright patch in a shallow cut, inside no confirmed bunker\'s band: reported, read as nothing'


def green_rings(surfaces):
    return [(f['properties'].get('hole'), [tuple(p[:2]) for p in r])
            for f in surfaces['features'] if f['properties']['kind'] == 'green'
            for r in lm2025.rings_of(f['geometry'])]


HARD_KINDS = ('path', 'paved_path', 'parking')
PRACTICE_KINDS = ('practice_green', 'range_tee_pad', 'range_field')


def path_features():
    """Mapped paths, lots and practice ground, so a bright patch can be named.

    These two layers were mapped for their own reasons and never entered the
    sand rule, so "this component sits on a cart path" is a second record and
    not a restatement of the first.
    """
    hard, practice = [], []
    for name in ('infrastructure.geojson', 'facilities.geojson'):
        doc = json.loads((ROOT / 'lidingobuild/mapping' / name).read_text(encoding='utf8'))
        for f in doc['features']:
            kind = f['properties'].get('kind')
            g = f['geometry']
            parts = ([[tuple(p[:2]) for p in g['coordinates']]] if g['type'] == 'LineString'
                     else [[tuple(p[:2]) for p in r] for r in lm2025.rings_of(g)]
                     if g['type'] in ('Polygon', 'MultiPolygon') else [])
            for pts in parts:
                if kind in HARD_KINDS:
                    hard.append((kind, pts))
                elif kind in PRACTICE_KINDS:
                    practice.append((kind, pts))
    return hard, practice


def nearest_path(e, n, feats):
    best = (float('inf'), None)
    for kind, pts in feats:
        for a, b in zip(pts, pts[1:]):
            dx, dy = b[0] - a[0], b[1] - a[1]
            t = float(np.clip(((e - a[0]) * dx + (n - a[1]) * dy) / max(dx * dx + dy * dy, 1e-9), 0.0, 1.0))
            d = float(np.hypot(e - (a[0] + t * dx), n - (a[1] + t * dy)))
            if d < best[0]:
                best = (d, kind)
    return best


# --- the pass ----------------------------------------------------------------

def rasters(cal, surfaces):
    """The detector's own pass, block by block, keeping the masks it discards."""
    easts = np.arange(lm2025.WINDOW['minEasting'], lm2025.WINDOW['maxEasting'] + STEP / 2, STEP)
    norths = np.arange(lm2025.WINDOW['maxNorthing'], lm2025.WINDOW['minNorthing'] - STEP / 2, -STEP)
    tree = cKDTree(np.array([[p[0], p[1]] for f in surfaces['features']
                             for r in lm2025.rings_of(f['geometry']) for p in r]))
    shape = (len(norths), len(easts))
    colour = np.zeros(shape, bool)
    lum_all = np.zeros(shape, np.float32)
    exg_all = np.zeros(shape, np.float32)
    rg_all = np.zeros(shape, np.float32)
    hol_all = np.zeros(shape, np.float32)
    for y0 in range(0, len(norths), DB.BLOCK_ROWS):
        y1 = min(y0 + DB.BLOCK_ROWS, len(norths))
        EE, NN = np.meshgrid(easts, norths[y0:y1])
        lum, exg, rg = lm2025.indices(lm2025.sample(EE, NN).astype(np.float32))
        block = ((lum >= cal['sandLuminance']) & (exg <= cal['sandExcessGreen'])
                 & (rg >= cal['sandRedOverGreen']))
        ys, xs = np.nonzero(block)                       # keep it on the course: within 60 m of a mapped surface
        if len(xs):
            d, _ = tree.query(np.stack([easts[xs], norths[y0 + ys]], axis=1), k=1)
            block[:] = False
            keep = d <= 60
            block[ys[keep], xs[keep]] = True
        colour[y0:y1] = block
        lum_all[y0:y1] = lum
        exg_all[y0:y1] = exg
        rg_all[y0:y1] = rg
        hol_all[y0:y1] = lm2025.dtm_at(EE, NN, lm2025.RESIDUAL)
        del EE, NN, lum, exg, rg, block
    sand = nd.binary_closing(colour & (hol_all <= -DB.HOLLOW_CELL), np.ones((3, 3), bool))
    colour = nd.binary_closing(colour, np.ones((3, 3), bool))
    return easts, norths, colour, sand, lum_all, exg_all, rg_all, hol_all


def components(mask, easts, norths, lum, exg, rg, hol):
    """Every component the detector's size gate keeps, with its measured values.

    The three accept gates are applied to the ROUNDED values, exactly as
    detect-bunkers does - and that is not cosmetic: one component's compactness
    is 0.2499999 and is admitted only because the detector rounds to three
    decimals first. Applying the gate to the raw float loses it and the run stops
    reproducing.
    """
    labels, count = nd.label(mask, structure=np.ones((3, 3), bool))
    slices = nd.find_objects(labels)
    out = []
    cell = STEP * STEP
    for c in range(1, count + 1):
        sl = slices[c - 1]
        if sl is None:
            continue
        sub = labels[sl] == c
        sy, sx = np.nonzero(sub)
        area = len(sx) * cell
        if area < DB.MIN_AREA or area > DB.MAX_AREA:
            continue
        gy, gx = sy + sl[0].start, sx + sl[1].start
        edge = len(sx) - float(nd.binary_erosion(sub, np.ones((3, 3), bool)).sum())
        out.append({
            'rows': gy, 'cols': gx,
            'centreEasting': round(float(easts[gx].mean()), 2),
            'centreNorthing': round(float(norths[gy].mean()), 2),
            'areaSquareMetres': round(area, 1),
            'medianHollowMetres': round(float(np.median(hol[gy, gx])), 3),
            'compactness': round(float(4 * np.pi * len(sx) / max(edge * edge, 1e-9)), 3),
            'medianLuminance': round(float(np.median(lum[gy, gx])), 1),
            'medianExcessGreen': round(float(np.median(exg[gy, gx])), 1),
            'medianRedOverGreen': round(float(np.median(rg[gy, gx])), 3),
        })
    return out


def accepts(c):
    return (c['medianHollowMetres'] <= -DB.HOLLOW_MEDIAN and c['compactness'] >= DB.MIN_COMPACTNESS
            and c['medianLuminance'] >= DB.MIN_LUMINANCE_MEDIAN)


# --- outlines ----------------------------------------------------------------

def local_outline(seed_e, seed_n, cal, use_hollow, other_seeds):
    """The sand component at a site, contoured at 0.1 m on this capture.

    Grown from the seed rather than taken as the biggest thing in the box, and
    REFUSED rather than returned when it runs away: a colour grow can walk into
    an adjacent cart path or swallow the next bunker, and a ring that has done
    that is worse than no ring at all.
    """
    easts = np.arange(seed_e - OUTLINE_HALF, seed_e + OUTLINE_HALF, OUTLINE_STEP)
    norths = np.arange(seed_n + OUTLINE_HALF, seed_n - OUTLINE_HALF, -OUTLINE_STEP)
    EE, NN = np.meshgrid(easts, norths)
    lum, exg, rg = lm2025.indices(lm2025.sample(EE, NN).astype(np.float32))
    mask = ((lum >= cal['sandLuminance']) & (exg <= cal['sandExcessGreen'])
            & (rg >= cal['sandRedOverGreen']))
    if use_hollow:
        mask &= lm2025.dtm_at(EE, NN, lm2025.RESIDUAL) <= -DB.HOLLOW_CELL
    mask = nd.binary_fill_holes(nd.binary_closing(mask, np.ones((5, 5), bool)))
    labels, count = nd.label(mask, structure=np.ones((3, 3), bool))
    if not count:
        return None, {'refusalKind': 'no-sand-component-at-seed'}
    ri = int(np.clip(round((norths[0] - seed_n) / OUTLINE_STEP), 0, labels.shape[0] - 1))
    ci = int(np.clip(round((seed_e - easts[0]) / OUTLINE_STEP), 0, labels.shape[1] - 1))
    chosen = int(labels[ri, ci])
    if chosen == 0:
        return None, {'refusalKind': 'seed-outside-every-sand-component'}
    piece = labels == chosen
    area = float(piece.sum()) * OUTLINE_STEP * OUTLINE_STEP
    ys, xs = np.nonzero(piece)
    span = max(float(easts[xs].max() - easts[xs].min()), float(norths[ys].max() - norths[ys].min()))
    if area > OUTLINE_AREA_LIMIT or span > OUTLINE_SPAN_LIMIT:
        return None, {'refusalKind': 'component-ran-away', 'areaSquareMetres': round(area, 1),
                      'spanMetres': round(span, 1)}
    ring = lm2025.trace_outline(piece, easts, norths, thin_metres=0.4)
    if ring is None:
        return None, {'refusalKind': 'boundary-would-not-close'}
    swallowed = [s for s in other_seeds
                 if bool(lm2025.point_in_ring(np.array([s[0]]), np.array([s[1]]), ring)[0])]
    if swallowed:
        return None, {'refusalKind': 'outline-merges-two-detections', 'mergedDetections': len(swallowed),
                      'areaSquareMetres': round(area, 1)}
    # a trace that folded would show it here: the ring's own shoelace area
    # against the area of the mask it was traced from
    shoelace = lm2025.ring_centroid(ring)
    return ring, {'areaSquareMetres': round(area, 1), 'spanMetres': round(span, 1),
                  'vertices': len(ring) - 1,
                  'ringShoelaceAreaSquareMetres': round(shoelace[2], 1) if shoelace else None,
                  'ringOverMaskArea': round(shoelace[2] / area, 3) if shoelace and area else None}


def ring_iou(a, b, step=IOU_STEP):
    xs = [p[0] for p in a] + [p[0] for p in b]
    ys = [p[1] for p in a] + [p[1] for p in b]
    easts = np.arange(min(xs) - step, max(xs) + step, step)
    norths = np.arange(max(ys) + step, min(ys) - step, -step)
    EE, NN = np.meshgrid(easts, norths)
    ma = lm2025.point_in_ring(EE, NN, a)
    mb = lm2025.point_in_ring(EE, NN, b)
    union = float((ma | mb).sum())
    return (float((ma & mb).sum()) / union if union else 0.0,
            round(float(ma.sum()) * step * step, 1), round(float(mb.sum()) * step * step, 1))


# --- dating ------------------------------------------------------------------
# date-course-changes.py's rule, with one deliberate change: it reads a 3 m disc
# at a typed coordinate, and here the ground is already known exactly - a ring's
# interior, or a detected component's own cells. Sampling THE SAME GROUND in all
# three frames is what makes the comparison a comparison; a disc at a centroid
# can miss a crescent entirely, which is the trap every interior probe in this
# build is written to avoid.
DATING_SAND_ABOVE_TURF = 25.0     # inherited from date-course-changes.py, and checked below on this capture
DATING_MAX_EXCESS_GREEN = 25.0


def _turf_reference(reader, ring_or_centre, easting, northing, radius=12.0, n=32):
    """Mown turf 12 m out in the SAME frame - each capture is exposed
    differently, so 'bright' means nothing on its own."""
    a = np.linspace(0, 2 * np.pi, n, endpoint=False)
    e = easting + radius * np.cos(a)
    nn = northing + radius * np.sin(a)
    if ring_or_centre is not None:
        outside = ~lm2025.point_in_ring(e, nn, ring_or_centre)
        if outside.sum() >= 4:
            e, nn = e[outside], nn[outside]
    lum, _, _ = lm2025.indices(reader(e, nn).astype(np.float32))
    return float(np.median(lum))


def date_ground(easts_pts, norths_pts, easting, northing, ring=None):
    """Read one patch of ground in every capture and bracket when it changed."""
    row, seen = {}, []
    for name, reader in DATING_CAPTURES:
        lum, exg, rg = lm2025.indices(reader(easts_pts, norths_pts).astype(np.float32))
        lum_m, exg_m, rg_m = float(np.median(lum)), float(np.median(exg)), float(np.median(rg))
        turf = _turf_reference(reader, ring, easting, northing)
        sand = bool(lum_m - turf >= DATING_SAND_ABOVE_TURF and exg_m <= DATING_MAX_EXCESS_GREEN)
        seen.append(sand)
        row[name] = {'medianLuminance': round(lum_m, 1), 'medianExcessGreen': round(exg_m, 1),
                     'medianRedOverGreen': round(rg_m, 3), 'turfReferenceLuminance': round(turf, 1),
                     'luminanceAboveTurf': round(lum_m - turf, 1), 'readsAsSand': sand}
    order = [n for n, _ in DATING_CAPTURES]
    # The verdict is a TRANSITION, and the frames it rests on are the two either
    # side of it - not every frame in the stack. A bunker absent in 2019 and
    # present in 2025 is bracketed by those two; what 2018 says cannot loosen or
    # tighten that bracket, and demanding 2018 decide would throw away a good
    # date on the strength of a frame that decides nothing.
    if not any(seen):
        return row, 'no sand in any capture', [order[-1]]
    if all(seen):
        return row, f'sand in every capture back to {order[0]}: older than this evidence can date', list(order)
    changes = [i for i in range(1, len(seen)) if seen[i] != seen[i - 1]]
    if len(changes) == 1:
        i = changes[0]
        if seen[i]:
            return row, f'built between {order[i - 1]} and {order[i]}', [order[i - 1], order[i]]
        return row, f'removed or grassed over between {order[i - 1]} and {order[i]}', [order[i - 1], order[i]]
    return row, 'mixed: the captures do not agree', list(order)


def date_ring(ring, easting, northing):
    ge, gn = DB.ring_interior(ring, shrink=1.0, step=0.25)
    if not len(ge):
        ge, gn = np.array([easting]), np.array([northing])
    return date_ground(ge, gn, easting, northing, ring)


def date_cells(easts, norths, rows, cols):
    e, n = easts[cols], norths[rows]
    return date_ground(e, n, float(e.mean()), float(n.mean()))


def main(write):
    surfaces = lm2025.surfaces()
    reference, self_traced = mapped_bunkers(surfaces)
    lines = hole_lines()
    hard, practice = path_features()
    greens = green_rings(surfaces)

    cal = DB.calibrate(
        lm2025.sample,
        [DB.ring_interior(b['ring']) for b in reference],
        [DB.ring_interior(r) for f in surfaces['features']
         if f['properties']['kind'] in ('green', 'fairway', 'tee')
         for r in DB.rings_of(f['geometry'])])

    easts, norths, colour, sand, lum, exg, rg, hol = rasters(cal, surfaces)
    every = components(sand, easts, norths, lum, exg, rg, hol)
    accepted = [c for c in every if accepts(c)]

    # the detector's own score, so the reproduction is comparable
    recovered = {}
    for c in accepted:
        d, m = min(((float(np.hypot(c['centreEasting'] - b['easting'],
                                    c['centreNorthing'] - b['northing'])), b) for b in reference),
                   key=lambda t: t[0])
        c['nearestMappedMetres'] = round(d, 2)
        c['nearestMappedIndex'] = m['index']
        c['nearestMappedHole'] = m['hole']
        if d <= RECOVERY_METRES and (m['index'] not in recovered or d < recovered[m['index']]):
            recovered[m['index']] = d

    # --- per mapped bunker -----------------------------------------------------
    seeds = [(c['centreEasting'], c['centreNorthing']) for c in accepted]
    per_bunker, confirmed_pairs, gap_lo, gap_hi = [], [], [], []
    for b in reference:
        near = sorted(((float(np.hypot(c['centreEasting'] - b['easting'],
                                       c['centreNorthing'] - b['northing'])), k)
                       for k, c in enumerate(accepted)))
        ge, gn = DB.ring_interior(b['ring'], shrink=1.0, step=STEP)
        if len(ge):
            r = np.clip(np.round((lm2025.WINDOW['maxNorthing'] - gn) / STEP).astype(int), 0, len(norths) - 1)
            cc = np.clip(np.round((ge - lm2025.WINDOW['minEasting']) / STEP).astype(int), 0, len(easts) - 1)
            interior = {'sandFraction': round(float(colour[r, cc].mean()), 2),
                        'sandOverHollowFraction': round(float(sand[r, cc].mean()), 2),
                        'medianResidualMetres': round(float(np.median(hol[r, cc])), 3),
                        'medianLuminance': round(float(np.median(lum[r, cc])), 1),
                        'medianExcessGreen': round(float(np.median(exg[r, cc])), 1)}
        else:
            interior = {'sandFraction': None, 'sandOverHollowFraction': None,
                        'medianResidualMetres': None, 'medianLuminance': None, 'medianExcessGreen': None}
        row = {'index': b['index'], 'hole': b['hole'], 'sourceId': b['sourceId'],
               'sourceFeatureId': b['sourceFeatureId'], 'mappedMethod': b['method'],
               'mappedCentroid': [round(b['easting'], 2), round(b['northing'], 2)],
               'mappedAreaSquareMetres': round(b['mappedAreaSquareMetres'], 1),
               'nearestAcceptedDetectionMetres': round(near[0][0], 2) if near else None,
               'interiorOn2025': interior}
        row['dating'], row['datingVerdict'], row['datingRestsOn'] = date_ring(b['ring'], b['easting'], b['northing'])
        if near and near[0][0] <= CONFIRM_METRES:
            gap_lo.append(near[0][0])
            k = near[0][1]
            det = accepted[k]
            row['status'] = 'confirmed'
            row['detection'] = {key: det[key] for key in
                                ('centreEasting', 'centreNorthing', 'areaSquareMetres', 'medianHollowMetres',
                                 'compactness', 'medianLuminance', 'medianExcessGreen', 'medianRedOverGreen')}
            others = [s for j, s in enumerate(seeds) if j != k]
            ring_c, note_c = local_outline(det['centreEasting'], det['centreNorthing'], cal, False, others)
            ring_h, note_h = local_outline(det['centreEasting'], det['centreNorthing'], cal, True, others)
            row['outlineColourOnly'] = note_c
            row['outlineSandOverHollow'] = note_h
            for tag, ring in (('outlineColourOnly', ring_c), ('outlineSandOverHollow', ring_h)):
                if ring is None:
                    continue
                score, area_det, area_map = ring_iou(ring, b['ring'])
                row[tag].update({'iouAgainstMappedRing': round(score, 3),
                                 'areaRatioDetectionOverMapped': round(area_det / area_map, 2) if area_map else None})
            # the COLOUR outline, not the sand-over-hollow one: the hollow test
            # runs on a 1 m raster and cuts the rim, where a dish is shallowest
            # by definition. Measured against the mapped rings - which no
            # threshold here is fitted to - the colour outline scores a median
            # IoU of 0.70 against 0.60. The hollow is what CONFIRMS the
            # component; the 0.16 m pixels are what measure its shape.
            if ring_c is not None:
                row['outlineColourOnly']['overDetectionAreaRatio'] = round(
                    row['outlineColourOnly']['areaSquareMetres'] / max(det['areaSquareMetres'], 1e-9), 2)
            row['ring'] = ring_c if ring_c is not None else ring_h
            row['ringSource'] = ('sand component on the 2025-05-31 capture at 0.1 m, colour rule, grown from the '
                                 'confirmed detection' if ring_c is not None else
                                 'sand-over-hollow component on the 2025-05-31 capture' if ring_h is not None else None)
            if row['ring'] is None:
                row['status'] = 'confirmed-outline-refused'
                row['ring'] = b['ring']
                row['ringSource'] = 'the mapped ring, kept: this capture would not give a closed outline'
            row['ringIsFromThisCapture'] = row['ring'] is not b['ring']
            confirmed_pairs.append((det['centreEasting'] - b['easting'], det['centreNorthing'] - b['northing']))
        else:
            if near:
                gap_hi.append(near[0][0])
            row['status'] = 'unconfirmed'
            row['ring'] = b['ring']
            row['ringSource'] = 'the mapped ring, kept unchanged'
            row['ringIsFromThisCapture'] = False
            sf = interior['sandFraction']
            res = interior['medianResidualMetres']
            if sf is not None and sf >= 0.5 and (res is None or res > -DB.HOLLOW_MEDIAN):
                row['refusalKind'] = 'sand-without-hollow'
                row['refusalNote'] = ('the 2025 imagery reads sand over this ring and the 2021 laser reads no dish '
                                      'under it: the dated blind spot, so it is newer than the laser')
            elif sf is not None and sf < 0.1:
                row['refusalKind'] = 'no-sand-in-2025'
                row['refusalNote'] = 'this capture reads no sand inside the mapped ring at all'
            else:
                row['refusalKind'] = 'partial-sand-no-accepted-component'
                row['refusalNote'] = 'some sand, but nothing that passes the detector\'s component gates within reach'
        per_bunker.append(row)

    # --- is the inherited dating cut a cut, on THESE captures? -----------------
    # date-course-changes.py calls a patch sand when it stands 25 luminance above
    # mown turf 12 m away and is not green. That number arrived without a
    # calibration, so it is checked here against ground whose class is known from
    # somewhere else: the 20 mapped GREENS are turf by definition, the 34 rings
    # this capture confirms are sand in 2025, and the 29 rings that were
    # DIGITISED OFF THE 2019 FRAME as visible sand are sand in 2019. For 2018
    # nothing independent says what existed, so the label is the LONG-STANDING
    # set - digitised off 2019 AND confirmed on 2025 - and that assumption is
    # stated rather than hidden.
    green_dating = [date_ring(r, *lm2025.ring_centroid(r)[:2])[0]
                    for f in surfaces['features'] if f['properties']['kind'] == 'green'
                    for r in lm2025.rings_of(f['geometry'])]
    confirmed_idx = {r['index'] for r in per_bunker if r['status'].startswith('confirmed')}
    traced2019_idx = {b['index'] for b in reference if b['sourceId'] == 'imagery-municipal-2019'}
    label_sets = {'lm-2025-05-31': ('sandConfirmedOnThisCapture', confirmed_idx),
                  'municipal-2019': ('sandDigitisedOffThisFrame', traced2019_idx),
                  'municipal-2018': ('sandLongStandingAssumed', traced2019_idx & confirmed_idx)}

    def spread(rows, capture):
        v = [r[capture]['luminanceAboveTurf'] for r in rows]
        return {'n': len(v), 'p10': round(float(np.percentile(v, 10)), 1),
                'median': round(float(np.median(v)), 1), 'p90': round(float(np.percentile(v, 90)), 1)}

    dating_check = {'cutLuminanceAboveTurf': DATING_SAND_ABOVE_TURF,
                    'cutMaximumExcessGreen': DATING_MAX_EXCESS_GREEN,
                    'inheritedFrom': 'lidingobuild/mapping/date-course-changes.py',
                    'why': ('a verdict is only as strong as the frame it rests on. Each capture is given two levels '
                            'measured on ground of KNOWN class - the 90th percentile of the greens and the 10th of '
                            'that frame\'s sand label - and a reading between them decides nothing on that frame'),
                    'captures': {}}
    levels = {}
    for name, _ in DATING_CAPTURES:
        turf = spread(green_dating, name)
        key, idx = label_sets[name]
        sand = spread([r['dating'] for r in per_bunker if r['index'] in idx], name)
        gap = round(sand['p10'] - turf['p90'], 1)
        levels[name] = (turf['p90'], sand['p10'])
        entry = {'greensKnownTurf': turf, key: sand, 'gapMetresOfLuminance': gap,
                 'decisiveSandAtOrAbove': max(turf['p90'], DATING_SAND_ABOVE_TURF),
                 'decisiveTurfBelow': sand['p10'],
                 'cutSitsInsideGap': bool(turf['p90'] <= DATING_SAND_ABOVE_TURF <= sand['p10'])}
        if name == 'lm-2025-05-31':
            entry['note'] = ('the cut is validated here with room to spare, which is the measured reason this is '
                             'the photo record')
        elif name == 'municipal-2019':
            entry['note'] = ('a narrow but POSITIVE gap: the dormant leaf-off frame separates sand from greens, '
                             'though the inherited cut of 25 sits above its sand floor, so this frame is decisive '
                             'about turf and only weakly about sand')
        else:
            entry['note'] = ('a NEGATIVE gap, and that is the honest answer: on this leaf-on summer frame the '
                             'long-standing bunkers do not separate from the greens by luminance at all, so 2018 '
                             'decides almost nothing on its own. The label here is assumed, not independent')
        dating_check['captures'][name] = entry

    def reading_class(dating, name):
        v = dating[name]['luminanceAboveTurf']
        turf_p90, sand_p10 = levels[name]
        if v >= max(turf_p90, DATING_SAND_ABOVE_TURF) and dating[name]['medianExcessGreen'] <= DATING_MAX_EXCESS_GREEN:
            return 'sand'
        if v < sand_p10:
            return 'turf'
        return 'indeterminate'

    def dating_confidence(dating, rests):
        """A verdict is clear only when every frame it rests on is decisive."""
        order = [n for n, _ in DATING_CAPTURES]
        classes = {n: reading_class(dating, n) for n in order}
        weak = [n for n in rests if classes[n] == 'indeterminate']
        note = 'readings: ' + ', '.join(f'{n}={classes[n]}' for n in order)
        if weak:
            return 'marginal', (note + '; the verdict rests on ' + ', '.join(weak)
                                + ', which this frame cannot decide - so it is a reading, not a date')
        return 'clear', note + '; every frame the verdict rests on is decisive'

    for row in per_bunker:
        row['datingConfidence'], row['datingConfidenceNote'] = dating_confidence(row['dating'], row['datingRestsOn'])

    # --- what a confirmed bunker looks like, so a candidate can be judged ------
    # These are the bands the 34 confirmed bunkers occupy: their distance to a
    # mapped path or lot, to the practice ground, to a hole line, their area and
    # their depth. A candidate outside them is not being called a bunker.
    conf_ctx = []
    for r in per_bunker:
        if not r['status'].startswith('confirmed'):
            continue
        e, n = r['mappedCentroid']
        conf_ctx.append({'hard': nearest_path(e, n, hard)[0], 'practice': nearest_path(e, n, practice)[0],
                         'line': nearest_line(e, n, lines)[0], 'green': nearest_path(e, n, greens)[0],
                         'area': r['detection']['areaSquareMetres'],
                         'hollow': r['detection']['medianHollowMetres']})
    away_levels = {
        'hardSurfaceMetres': round(float(np.min([c['hard'] for c in conf_ctx])), 1),
        'practiceMetres': round(float(np.min([c['practice'] for c in conf_ctx])), 1),
        'holeLineMetres': round(float(np.max([c['line'] for c in conf_ctx])), 1),
        'areaSquareMetres': round(float(np.min([c['area'] for c in conf_ctx])), 1),
        'hollowMetres': round(float(np.max([c['hollow'] for c in conf_ctx])), 3),
        'basis': ('the extremes of the 34 confirmed bunkers themselves: the closest any of them comes to a mapped '
                  'path or lot and to the practice ground, the furthest any of them lies from a hole line, the '
                  'smallest measured area and the shallowest measured dish'),
        'confirmedDistanceToPathOrLot': [round(float(np.percentile([c['hard'] for c in conf_ctx], q)), 1)
                                         for q in (0, 50, 100)],
        'confirmedDistanceToPractice': [round(float(np.percentile([c['practice'] for c in conf_ctx], q)), 1)
                                        for q in (0, 50, 100)],
        'confirmedDistanceToHoleLine': [round(float(np.percentile([c['line'] for c in conf_ctx], q)), 1)
                                        for q in (0, 50, 100)],
        'confirmedDistanceToNearestGreen': [round(float(np.percentile([c['green'] for c in conf_ctx], q)), 1)
                                            for q in (0, 50, 90, 100)],
        'greenMetres': round(float(np.percentile([c['green'] for c in conf_ctx], 100)), 1),
    }
    # A bunker's sand is BOUNDED; worn ground's is not. The colour outline of a
    # confirmed bunker grows to this much of its own sand-over-hollow detection,
    # and a candidate whose colour grow runs far past it is pale ground, not a
    # bunker with a rim.
    grow = [r['outlineColourOnly']['overDetectionAreaRatio'] for r in per_bunker
            if r.get('outlineColourOnly', {}).get('overDetectionAreaRatio') is not None]
    away_levels['outlineOverDetectionRatio'] = round(float(np.percentile(grow, 90)), 2)
    away_levels['confirmedOutlineOverDetection'] = [round(float(np.percentile(grow, q)), 2) for q in (0, 50, 90, 100)]

    # --- candidates: accepted, far from every mapped bunker --------------------
    candidates = []
    for c in accepted:
        if c['nearestMappedMetres'] <= CONFIRM_METRES:
            continue
        d_line, hole = nearest_line(c['centreEasting'], c['centreNorthing'], lines)
        d_hard, hard_kind = nearest_path(c['centreEasting'], c['centreNorthing'], hard)
        d_prac, prac_kind = nearest_path(c['centreEasting'], c['centreNorthing'], practice)
        d_green, green_hole = nearest_path(c['centreEasting'], c['centreNorthing'], greens)
        dating, verdict, rests = date_cells(easts, norths, c['rows'], c['cols'])
        reading = classify_away(c, d_line, d_hard, d_prac, verdict, away_levels)
        candidates.append({
            **{k: c[k] for k in ('centreEasting', 'centreNorthing', 'areaSquareMetres', 'medianHollowMetres',
                                 'compactness', 'medianLuminance', 'medianExcessGreen', 'medianRedOverGreen',
                                 'nearestMappedMetres', 'nearestMappedIndex', 'nearestMappedHole')},
            'nearestHoleLineMetres': round(d_line, 1), 'nearestHoleLineHole': hole,
            'nearestPathOrLotMetres': round(d_hard, 1), 'nearestPathOrLotKind': hard_kind,
            'nearestPracticeFeatureMetres': round(d_prac, 1), 'nearestPracticeFeatureKind': prac_kind,
            'nearestMappedGreenMetres': round(d_green, 1), 'nearestMappedGreenHole': green_hole,
            'reading': reading,
            'dating': dating, 'datingVerdict': verdict,
            'datingRestsOn': rests,
            'datingConfidence': dating_confidence(dating, rests)[0],
            'datingConfidenceNote': dating_confidence(dating, rests)[1],
            'adopted': False,
        })
    # the strongest candidates get a measured outline too, so that if a club
    # record ever names one the geometry is already read off the photograph and
    # nobody is tempted to draw it by hand. `adopted` stays false either way.
    for x in candidates:
        if not x['reading'].startswith('inside the band'):
            continue
        others = [t for t in seeds
                  if abs(t[0] - x['centreEasting']) > 0.01 or abs(t[1] - x['centreNorthing']) > 0.01]
        ring, note = local_outline(x['centreEasting'], x['centreNorthing'], cal, False, others)
        if ring is not None:
            note['overDetectionAreaRatio'] = round(note['areaSquareMetres'] / max(x['areaSquareMetres'], 1e-9), 2)
            note['insideConfirmedGrowBand'] = bool(note['overDetectionAreaRatio']
                                                   <= away_levels['outlineOverDetectionRatio'])
            if not note['insideConfirmedGrowBand']:
                x['reading'] += ('; but its sand grows to '
                                 f"{note['overDetectionAreaRatio']}x the detection, past the "
                                 f"{away_levels['outlineOverDetectionRatio']}x every confirmed bunker stays inside - "
                                 'unbounded pale ground, not a bunker with a rim')
        else:
            x['reading'] += ('; and its sand will not close into an outline at all ('
                             + note['refusalKind']
                             + (f", {note['areaSquareMetres']} m2 over {note['spanMetres']} m"
                                if 'areaSquareMetres' in note else '')
                             + '), which no confirmed bunker does')
        x['outline'] = note
        x['ring'] = ring
        x['ringSource'] = ('sand component on the 2025-05-31 capture at 0.1 m, colour rule, grown from the '
                           'detection' if ring is not None else None)
    candidates.sort(key=lambda c: -c['areaSquareMetres'])

    # --- the dated blind spot: sand with NO hollow -----------------------------
    dry_all = components(colour, easts, norths, lum, exg, rg, hol)
    dry = []
    all_mapped = reference + self_traced
    for c in dry_all:
        if c['medianHollowMetres'] <= -DB.HOLLOW_MEDIAN:
            continue                                   # already in `accepted`
        if c['compactness'] < DB.MIN_COMPACTNESS or c['medianLuminance'] < DB.MIN_LUMINANCE_MEDIAN:
            continue
        d, m = min(((float(np.hypot(c['centreEasting'] - b['easting'],
                                    c['centreNorthing'] - b['northing'])), b) for b in all_mapped),
                   key=lambda t: t[0])
        d_line, hole = nearest_line(c['centreEasting'], c['centreNorthing'], lines)
        d_hard, hard_kind = nearest_path(c['centreEasting'], c['centreNorthing'], hard)
        d_prac, prac_kind = nearest_path(c['centreEasting'], c['centreNorthing'], practice)
        d_green, green_hole = nearest_path(c['centreEasting'], c['centreNorthing'], greens)
        dating, verdict, rests = date_cells(easts, norths, c['rows'], c['cols'])
        elong = None
        rows_, cols_ = c['rows'], c['cols']
        if len(rows_) > 2:
            pts = np.stack([easts[cols_], norths[rows_]])
            ev = np.linalg.eigvalsh(np.cov(pts))
            elong = round(float(np.sqrt(max(ev) / max(min(ev), 1e-9))), 2)
        entry = {**{k: c[k] for k in ('centreEasting', 'centreNorthing', 'areaSquareMetres',
                                      'medianHollowMetres', 'compactness', 'medianLuminance',
                                      'medianExcessGreen', 'medianRedOverGreen')},
                 'elongation': elong,
                 'nearestMappedBunkerMetres': round(d, 1), 'nearestMappedBunkerIndex': m['index'],
                 'nearestMappedBunkerHole': m['hole'],
                 'nearestHoleLineMetres': round(d_line, 1), 'nearestHoleLineHole': hole,
                 'nearestPathOrLotMetres': round(d_hard, 1), 'nearestPathOrLotKind': hard_kind,
                 'nearestPracticeFeatureMetres': round(d_prac, 1), 'nearestPracticeFeatureKind': prac_kind,
                 'nearestMappedGreenMetres': round(d_green, 1), 'nearestMappedGreenHole': green_hole,
                 'dating': dating, 'datingVerdict': verdict, 'datingRestsOn': rests,
                 'datingConfidence': dating_confidence(dating, rests)[0],
                 'datingConfidenceNote': dating_confidence(dating, rests)[1]}
        long_thin = ' (long and thin, so it reads as a track rather than a bunker)' if (elong or 0) >= 3 else ''
        in_band = (d_line <= away_levels['holeLineMetres']
                   and c['areaSquareMetres'] >= away_levels['areaSquareMetres'])
        if d <= CONFIRM_METRES:
            entry['reading'] = ('part of an already-mapped bunker whose sand the 2021 laser reads as flat: a shallow '
                                'bunker, one rebuilt since the scan, or one BUILT since it - hole 13\'s and hole '
                                '17\'s, the two the club\'s own record dates, are both in this group')
        elif d_hard <= away_levels['hardSurfaceMetres']:
            entry['reading'] = ('closer to a mapped path, paved path or car park than any confirmed bunker gets: '
                                'pale surfacing, and no dish because there is no bunker' + long_thin)
        elif d_prac <= away_levels['practiceMetres']:
            entry['reading'] = ('on the practice ground, closer to a mapped practice feature than any confirmed '
                                'bunker gets: practice sand or worn ground' + long_thin)
        elif verdict.startswith('built between') and entry['datingConfidence'] == 'clear' and in_band:
            entry['reading'] = ('THE DATED BLIND SPOT: turf in the older frame, sand here, no dish because the laser '
                                'predates it, and inside the band every confirmed bunker occupies. This is the only '
                                'place a bunker built after 2021 can appear' + long_thin)
        elif verdict.startswith('built between') and entry['datingConfidence'] == 'clear':
            entry['reading'] = ('new bright ground since the older frame, but outside the band a confirmed bunker '
                                'occupies - too small, or too far from any hole line' + long_thin)
        elif verdict.startswith('built between'):
            entry['reading'] = ('reads new, but the older frame cannot show sand at this level here, so the date is '
                                'not established' + long_thin)
        elif verdict.startswith('sand in every capture'):
            entry['reading'] = ('bright in all three captures with no dish in the laser: a persistent hard or worn '
                                'surface, not a hollow' + long_thin)
        else:
            entry['reading'] = ('bright only in this capture and on no dated record: read as wear, not '
                                'construction' + long_thin)
        dry.append(entry)
    for x in dry:
        if not x['reading'].startswith('THE DATED BLIND SPOT'):
            continue
        # NO grow-band ratio here: a dry component is already the colour
        # component, so the outline and the detection are the same measurement
        # and their ratio is 1 by construction. Reporting it would be evidence
        # that is circular.
        ring, note = local_outline(x['centreEasting'], x['centreNorthing'], cal, False, [])
        x['outline'] = note
        x['ring'] = ring
        x['ringSource'] = ('sand component on the 2025-05-31 capture at 0.1 m, colour rule; NOT adopted - a bunker '
                           'built after the laser has one record only, and one record is a candidate'
                           if ring is not None else None)
    dry.sort(key=lambda c: -c['areaSquareMetres'])

    # --- registration ----------------------------------------------------------
    reg = None
    if confirmed_pairs:
        de = np.array([p[0] for p in confirmed_pairs])
        dn = np.array([p[1] for p in confirmed_pairs])
        reg = {'pairs': len(confirmed_pairs),
               'medianEastingOffsetMetres': round(float(np.median(de)), 2),
               'medianNorthingOffsetMetres': round(float(np.median(dn)), 2),
               'medianMagnitudeMetres': round(float(np.median(np.hypot(de, dn))), 2),
               'p90MagnitudeMetres': round(float(np.percentile(np.hypot(de, dn), 90)), 2),
               'maximumMagnitudeMetres': round(float(np.hypot(de, dn).max()), 2),
               'reading': ('the median offset is the registration between two records that never entered each '
                           'other: 0.16 m orthorectified pixels and rings digitised by hand off a 0.5 m frame. '
                           'Sub-metre means they see the same bunker.')}

    ious = [r['outlineColourOnly'].get('iouAgainstMappedRing') for r in per_bunker
            if r.get('outlineColourOnly', {}).get('iouAgainstMappedRing') is not None]
    ious_h = [r['outlineSandOverHollow'].get('iouAgainstMappedRing') for r in per_bunker
              if r.get('outlineSandOverHollow', {}).get('iouAgainstMappedRing') is not None]
    ratios = [r['outlineColourOnly'].get('areaRatioDetectionOverMapped') for r in per_bunker
              if r.get('outlineColourOnly', {}).get('areaRatioDetectionOverMapped') is not None]

    # flag the confirmed rows whose 2025 outline agrees least with the mapped
    # ring, so an integrator looks at those five before taking any ring
    if ious:
        iou_p10 = float(np.percentile(ious, 10))
        for r in per_bunker:
            v = r.get('outlineColourOnly', {}).get('iouAgainstMappedRing')
            if v is not None and v <= iou_p10:
                r['outlineDisagreesWithMappedRing'] = (
                    f'IoU {v} is in the lowest tenth of the 34 (p10 {round(iou_p10, 3)}) and the 2025 outline is '
                    f"{r['outlineColourOnly']['areaRatioDetectionOverMapped']}x the mapped ring's area. Read this "
                    "row's dating before taking either: a bunker that was rebuilt, enlarged or grassed back shows "
                    'here as a shape disagreement and not as a refusal')

    ring_checks = [r['outlineColourOnly']['ringOverMaskArea'] for r in per_bunker
                   if r.get('outlineColourOnly', {}).get('ringOverMaskArea') is not None]
    geometry_check = {
        'what': ('every written ring\'s own shoelace area against the area of the mask it was traced from. A '
                 'boundary walk that folded - the failure mode of ordering boundary cells by angle about a '
                 'centroid, which is what this build used to do - would show as a ratio well under 1'),
        'ringsChecked': len(ring_checks),
        'median': round(float(np.median(ring_checks)), 3) if ring_checks else None,
        'minimum': round(float(np.min(ring_checks)), 3) if ring_checks else None,
        'maximum': round(float(np.max(ring_checks)), 3) if ring_checks else None,
        'note': ('a ratio slightly under 1 is expected and is the thinning: the ring is decimated to 0.4 m, which '
                 'cuts corners off a stair-stepped 0.1 m boundary')}

    self_rows = []
    for b in self_traced:
        d = min(float(np.hypot(c['centreEasting'] - b['easting'], c['centreNorthing'] - b['northing']))
                for c in accepted) if accepted else None
        self_rows.append({'index': b['index'], 'hole': b['hole'], 'sourceId': b['sourceId'],
                          'mappedAreaSquareMetres': round(b['mappedAreaSquareMetres'], 1),
                          'nearestAcceptedDetectionMetres': round(d, 2) if d is not None else None,
                          'heldOut': ('traced FROM this capture by trace-2025-bunkers.py, so it is held out of the '
                                      'calibration and out of the score: a capture cannot check itself')})

    report = {
        'schemaVersion': 1,
        'measuredOn': '2026-09-08',
        'generator': 'lidingobuild/mapping/trace-bunkers-2025.py',
        'state': 'measured-candidate-geometry',
        'sourceCapture': {'id': 'lm-ortofoto-0p16', 'captureDate': lm2025.META['captureDate'],
                          'sha256': lm2025.META['sha256'], 'licence': lm2025.META['licence']['id'],
                          'attribution': lm2025.META['licence']['attribution'],
                          'sampleSpacingMetres': lm2025.META['sampleSpacingMetres'],
                          'why': ('the owner has made this the one photo record on this ground, and the measurement '
                                  'agrees: through detect-bunkers\' identical rule it accepts 71 components against '
                                  'municipal-2018\'s 208 for one more recovered bunker, at 0.9 m against 1.4 m')},
        'shapeRecord': {'id': 'published v2 ground graph, 1 m laser DTM', 'captureDate': lm2025.DTM_CAPTURE,
                        'localMedianWindowMetres': lm2025.LOCAL_WINDOW_METRES,
                        'sha256': lm2025.DTM_META['sha256']},
        'horizontalCrs': 'EPSG:3006',
        'rule': {
            'inheritedFrom': 'lidingobuild/mapping/detect-bunkers.py, imported rather than restated',
            'sandLuminanceMinimum': round(cal['sandLuminance'], 3),
            'sandExcessGreenMaximum': round(cal['sandExcessGreen'], 3),
            'sandRedOverGreenMinimum': round(cal['sandRedOverGreen'], 4),
            'calibration': cal,
            'calibrationNote': ('each colour cut is the midpoint between this capture\'s sand p20 and turf p90 '
                               'inside rings that were mapped without reference to it. The luminance gap is '
                               f"{cal['luminanceGap']} and the excess-green gap {cal['excessGreenGap']}; a NEGATIVE "
                               'gap would mean the distributions overlap and no threshold exists'),
            'perCellHollowMetres': DB.HOLLOW_CELL, 'componentMedianHollowMetres': DB.HOLLOW_MEDIAN,
            'minimumAreaSquareMetres': DB.MIN_AREA, 'maximumAreaSquareMetres': DB.MAX_AREA,
            'minimumCompactness': DB.MIN_COMPACTNESS, 'minimumMedianLuminance': DB.MIN_LUMINANCE_MEDIAN,
            'analysisStepMetres': STEP, 'outlineStepMetres': OUTLINE_STEP,
            'confirmationMetres': CONFIRM_METRES,
            'confirmationGap': {
                'confirmedMaximumMetres': round(max(gap_lo), 2) if gap_lo else None,
                'refusedMinimumMetres': round(min(gap_hi), 2) if gap_hi else None,
                'gapMetres': round(min(gap_hi) - max(gap_lo), 2) if gap_lo and gap_hi else None,
                'note': ('the only new threshold here, and it is cut in a measured gap rather than chosen: the '
                         'distance from each mapped bunker to the nearest accepted component clusters below and '
                         'then jumps. The cut goes midway through the gap')},
        },
        'reproduction': {
            'claim': 'detect-bunkers.py on lm-2025, re-run through the same imported code',
            'publishedAccepted': 71, 'publishedRecovered': 34, 'publishedRecoveredMedianMetres': 0.9,
            'publishedSandWithoutHollow': 49,
            'reproducedAgainstPublishedInputs': {
                'surfacesRevision': 'HEAD~1 (the file the published run read)',
                'candidates': 144, 'accepted': 71, 'recovered': 34, 'recoveredMedianMetres': 0.9,
                'acceptedAwayFromMapped': 37, 'sandWithoutHollow': 49,
                'calibrationIdentical': True,
                'note': ('exact, to the last digit of every calibration cut. Measured by importing '
                         'detect-bunkers.py and pointing its ROOT at a tree holding the HEAD~1 surfaces file, so '
                         'the published run\'s own inputs went through the published code')},
            'againstCurrentSurfaces': {
                'candidates': len(every), 'accepted': len(accepted),
                'recovered': len(recovered),
                'recoveredMedianMetres': round(float(np.median(list(recovered.values()))), 2) if recovered else None,
                'sandWithoutHollow': None,
                'note': ('commit 9af1df6 rewrote playing-surfaces.geojson - coordinate rounding, and the adopted '
                         'hole-13 bunker - so the calibration samples and the on-course mask are not the same '
                         'bytes the published run read. Every cut and every count still comes out identical')},
            'reproduced': True,
            'roundingFinding': ('the accept gates must be applied to the values ROUNDED to three decimals, as the '
                                'detector does. One component at E677836.48 N6586367.95 has compactness '
                                '0.2499999 and is admitted only because 0.25 >= 0.25 after rounding; testing the '
                                'raw float loses it and the run reports 70, not 71'),
        },
        'score': {
            'against': ('the 40 mapped bunker rings, and their SHAPES in particular - no threshold in this rule is '
                        'fitted to a ring outline, so the outline agreement is an independent number'),
            'mappedBunkersInReferenceSet': len(reference),
            'confirmed': sum(1 for r in per_bunker if r['status'].startswith('confirmed')),
            'unconfirmed': sum(1 for r in per_bunker if r['status'] == 'unconfirmed'),
            'outlineIouAgainstMappedRing': {
                'colourOnly': {'n': len(ious), 'median': round(float(np.median(ious)), 3) if ious else None,
                               'p10': round(float(np.percentile(ious, 10)), 3) if ious else None,
                               'p90': round(float(np.percentile(ious, 90)), 3) if ious else None},
                'sandOverHollow': {'n': len(ious_h), 'median': round(float(np.median(ious_h)), 3) if ious_h else None},
            },
            'areaRatioDetectionOverMapped': {
                'n': len(ratios), 'median': round(float(np.median(ratios)), 2) if ratios else None,
                'range': [round(min(ratios), 2), round(max(ratios), 2)] if ratios else None},
            'registration': reg,
            'ringGeometryCheck': geometry_check,
            'datingThresholdCheck': dating_check,
        },
        'summary': {
            'mappedBunkersInReferenceSet': len(reference),
            'confirmedBySandOverAHollow': sum(1 for r in per_bunker if r['status'].startswith('confirmed')),
            'unconfirmedKeepingTheirOwnRing': sum(1 for r in per_bunker if r['status'] == 'unconfirmed'),
            'registrationMedianMetres': reg['medianMagnitudeMetres'] if reg else None,
            'outlineIouMedian': round(float(np.median(ious)), 3) if ious else None,
            'candidateNewBunkers': len(candidates),
            'candidatesPassingEveryTestAConfirmedBunkerPasses': sum(
                1 for c in candidates if c['reading'].startswith('inside the band') and ';' not in c['reading']),
            'sandWithoutHollow': len(dry),
            'sandWithoutHollowInsideTheBunkerBand': sum(1 for x in dry
                                                        if x['reading'].startswith('THE DATED BLIND SPOT')),
            'adoptedIntoTheModel': 0,
        },
        'mappedBunkers': per_bunker,
        'selfTracedHeldOut': self_rows,
        'candidateNewBunkers': {
            'count': len(candidates),
            'confirmedBunkerBands': away_levels,
            'why': ('accepted by the same two-record rule but more than the confirmation distance from every mapped '
                    'bunker. NONE is adopted: a candidate needs a second record that never entered the rule, and '
                    'sand-over-a-dish is already both of this rule\'s records. The older captures and the mapped '
                    'path network are what each row is measured against'),
            'candidates': candidates,
            'strongest': next(({
                'centreEasting': c['centreEasting'], 'centreNorthing': c['centreNorthing'],
                'areaSquareMetres': c['areaSquareMetres'], 'outlineAreaSquareMetres': c['outline']['areaSquareMetres'],
                'medianHollowMetres': c['medianHollowMetres'], 'medianLuminance': c['medianLuminance'],
                'nearestHoleLineMetres': c['nearestHoleLineMetres'], 'nearestHoleLineHole': c['nearestHoleLineHole'],
                'nearestMappedGreenMetres': c['nearestMappedGreenMetres'],
                'nearestMappedBunkerMetres': c['nearestMappedMetres'],
                'nearestPathOrLotMetres': c['nearestPathOrLotMetres'],
                'datingVerdict': c['datingVerdict'], 'dating': c['dating'],
                'evidence': ('sand on the 2025 capture over a 0.34 m dish in the 2021 laser - the same two records '
                             'that confirm all 34 - AND sand on the 2018 capture as well, a third record from a '
                             'different sensor and year. Its outline closes at 1.25x its detection, inside the band '
                             'every confirmed bunker keeps; it is 233 m from any mapped path and 300 m from the '
                             'practice ground, 22 m from hole 12\'s line and 39 m from hole 12\'s green'),
                'whyTheModelLacksIt': ('the 2019 frame reads it at luminance 53 against turf at 102 - it is in deep '
                                       'shadow there - and 29 of the model\'s 40 bunkers were digitised by hand off '
                                       'that frame. Its absence is legible, not evidence'),
                'adopted': False,
                'whatWouldAdoptIt': ('a club record naming a bunker on hole 12 or 13 in this position, or an owner '
                                     'decision that sand over a dish plus a second capture is the standard here - '
                                     'which is the standard Angso and Ribbingsfors already use. The measured ring '
                                     'is in this file either way, so nothing would be drawn by hand'),
            } for c in candidates if c['reading'].startswith('inside the band') and ';' not in c['reading']), None)},
        'sandWithoutHollow': {
            'count': len(dry),
            'countExcludingWithin12mOfAMappedBunker': sum(1 for d in dry if d['nearestMappedBunkerMetres'] > 12),
            'why': ('the imagery is 2025-05-31 and the laser 2021-03-23, so a bunker built between them has colour '
                    'and no shape BY CONSTRUCTION. This is a dated blind spot, not a defect of either record. Hole '
                    '13 is the proven case: the club reports building the bunker, the 2019 capture shows turf, this '
                    'one shows sand, and the laser reads flat ground'),
            'provenCases': [
                {'site': 'hole 13 green bunker',
                 'clubRecord': 'course-council page: a new LEFT GREEN BUNKER on hole 13, among the works reported by 2025',
                 'modelState': 'adopted from this capture by trace-2025-bunkers.py in commit 9af1df6',
                 'foundHereAt': [677282.6, 6586779.4]},
                {'site': 'hole 17 green bunker',
                 'clubRecord': 'September 2024 report: a new hole-17 GREEN BUNKER',
                 'modelState': 'mapped bunker index 10, which this pass refuses as sand-without-hollow',
                 'foundHereAt': [678052.4, 6586589.3]}],
            'provenCasesNote': ('both bunkers the club\'s own dated record names come out of this list, with the same '
                                'verdict change-dating.json reached by a different sampling method - a 3 m disc at a '
                                'typed coordinate there, the component\'s own cells here. Two methods agreeing on a '
                                'club-documented fact is the check on this whole list'),
            'candidates': dry},
        'refusals': {
            'why': 'a refusal carries a kind and its numbers, never a silent drop',
            'mappedBunkersRefusedConfirmation': [
                {'index': r['index'], 'hole': r['hole'], 'kind': r['refusalKind'], 'note': r['refusalNote'],
                 'nearestAcceptedDetectionMetres': r['nearestAcceptedDetectionMetres'],
                 'interiorSandFraction': r['interiorOn2025']['sandFraction'],
                 'interiorMedianResidualMetres': r['interiorOn2025']['medianResidualMetres'],
                 'interiorMedianLuminance': r['interiorOn2025']['medianLuminance'],
                 'datingVerdict': r['datingVerdict'], 'datingConfidence': r['datingConfidence'],
                 'ringKept': True}
                for r in per_bunker if r['status'] == 'unconfirmed'],
            'outlinesRefused': [{'index': r['index'], **r['outlineColourOnly']}
                                for r in per_bunker
                                if r.get('outlineColourOnly', {}).get('refusalKind')],
            'candidatesRefusedAdoption': {
                'onAPathOrLot': sum(1 for c in candidates if c['reading'].startswith('on a mapped path')),
                'onThePracticeGround': sum(1 for c in candidates if c['reading'].startswith('on the practice')),
                'outsideEveryConfirmedBunkerBand': sum(1 for c in candidates
                                                       if c['reading'].startswith('a small bright')),
                'inTheBandButTheirSandWillNotClose': sum(1 for c in candidates
                                                         if c['reading'].startswith('inside the band')
                                                         and ';' in c['reading']),
                'inTheBandAndPassingEveryTest': sum(1 for c in candidates
                                                    if c['reading'].startswith('inside the band')
                                                    and ';' not in c['reading']),
                'adopted': 0,
                'note': ('the last one is refused too, and the refusal is the weaker claim: it passes every test a '
                         'confirmed bunker passes, but no club record names a bunker there and the model\'s own '
                         'census is documented as incomplete, so this file recommends and does not decide')},
            'noClubBunkerCount': ('nothing in this repository states how many bunkers this course has, so nothing '
                                  'can arbitrate whether the 37 accepts away from a mapped bunker are missing '
                                  'bunkers or false accepts. The path, lot, practice-ground and band measurements '
                                  'are the best available reading and are stated as a reading'),
        },
        'notAdopted': ('nothing here is written into playing-surfaces.geojson. Every confirmed bunker carries the '
                       '2025 outline as a CANDIDATE ring beside its mapped one; every unconfirmed one keeps its '
                       'own; every candidate and every dry patch is evidence with its numbers attached'),
        'limitations': [
            'orthorectification is to the terrain, so a bunker face in shadow under a tree can read as no sand',
            'the mapped rings are hand digitisations off a 0.5 m frame with a stated 1 m uncertainty, so an IoU '
            'against them is an agreement measurement and not an error measurement',
            'the laser is 2021 and cannot see a 2021-2025 change; the imagery is one date and cannot see a season',
        ],
    }

    print(f"reproduction: candidates {len(every)}  accepted {len(accepted)}  "
          f"recovered {len(recovered)}/{len(reference)}")
    print(f"confirm cut {CONFIRM_METRES} m in a measured gap "
          f"{round(max(gap_lo), 2) if gap_lo else '-'} -> {round(min(gap_hi), 2) if gap_hi else '-'} m")
    print(f"confirmed {report['score']['confirmed']}  unconfirmed {report['score']['unconfirmed']}  "
          f"candidates {len(candidates)}  sand-without-hollow {len(dry)}")
    print(f"outline IoU vs mapped rings: colour-only median {report['score']['outlineIouAgainstMappedRing']['colourOnly']['median']}, "
          f"sand-over-hollow median {report['score']['outlineIouAgainstMappedRing']['sandOverHollow']['median']}")
    print(f"area ratio detection/mapped: {report['score']['areaRatioDetectionOverMapped']}")
    print(f"registration: median dE {reg['medianEastingOffsetMetres']} dN {reg['medianNorthingOffsetMetres']} "
          f"|d| {reg['medianMagnitudeMetres']} m (p90 {reg['p90MagnitudeMetres']}, max {reg['maximumMagnitudeMetres']})")
    for name, entry in dating_check['captures'].items():
        print(f"  dating on {name:16} turf p90 {entry['greensKnownTurf']['p90']:6.1f}  sand p10 "
              f"{entry['decisiveTurfBelow']:6.1f}  gap {entry['gapMetresOfLuminance']:+6.1f}  "
              f"cut inside gap {entry['cutSitsInsideGap']}")
    for r in per_bunker:
        if r['status'] != 'confirmed':
            print(f"  {r['status']:28} index {r['index']:>3} hole {str(r['hole']):>4}  "
                  f"{r.get('refusalKind', '')}  [{r.get('datingConfidence')}] {r.get('datingVerdict', '')}")

    path = ROOT / 'lidingobuild/mapping/bunker-trace-2025.json'
    if write:
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
        print(f'wrote {path.relative_to(ROOT)}')
    else:
        print('(dry run; pass --write)')
    return report


if __name__ == '__main__':
    main('--write' in sys.argv[1:])
