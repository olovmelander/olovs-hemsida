"""The shoreline and the sea at Lidingö GK, off the published 1 m laser DTM.

The method is Ängsö's ("the laser gives the shoreline"): a bare-earth height
model flattens open water, so water is a laser-FLAT plate at ONE height and the
shoreline is where that plate ends. Norrfällsviken is the seaside precedent -
near-shore water in Markhöjdmodell is a flattened surface at about zero rather
than nodata, and the sea is a ring like any other water body.

FLAT IS NOT LEVEL. Ängsö's v2 pass tested only "within 3 cm of its four
neighbours" and painted 46 ha of field and 2 km of road as lake, because a field
falling 0.75% clears that. So a component must ALSO sit at one height: at least
70% of it within 5 cm of its own median. That 0.70 is bracketed by two other
grounds - Ängsö's land flats read 0.20-0.64 and Norrfällsviken's Gulf of Bothnia,
the worst real water in this repo, reads 0.787 - and this script reports where
Lidingö falls rather than assuming it lands in the same place. It does not land
in the same place: this ground's water reads 0.997-1.000 and its land flats
0.049-0.880, so the borrowed 0.70 admits five roofs and mown terraces here and
the honest cut on THIS ground is higher. Both numbers are reported.

    node lidingobuild/mapping/dump-dtm-coast.mjs      # the height window
    python3 lidingobuild/mapping/trace-coast.py       # -> coast-2025.json
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage as nd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lm2025 as lm

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'lidingobuild/cache/coast-2025'
OUT = ROOT / 'lidingobuild/mapping/coast-2025.json'

# --- the rule's thresholds, every one of them stated here --------------------
NEIGHBOUR_STEP_METRES = 0.03      # the repo's flat test, sample to sample
LEVEL_BAND_METRES = 0.05          # "within 5 cm of its own median"
LEVELNESS_BORROWED = 0.70         # bracketed by Ängsö 0.20-0.64 and NVGK 0.787
COMPONENT_MINIMUM_SQUARE_METRES = 500.0
EDGE_TOLERANCE_METRES = 1.5       # a vertex this close to the window edge is an
                                  # ACQUISITION edge, not a shoreline
INLAND_PROBE_METRES = (3.0, 10.0)  # where the land height behind a shore is read


def _num(o):
    return o.item() if hasattr(o, 'item') else str(o)


meta = json.loads((CACHE / 'dtm.json').read_text())
WINDOWS = {w['name']: w for w in meta['windows']}


def load(name):
    w = WINDOWS[name]
    a = np.fromfile(CACHE / f'dtm-{name}.f32', dtype='<f4').reshape(w['height'], w['width']).astype(np.float64)
    sp = w['sampleSpacingMetres']
    easts = w['northwestSampleCentre']['easting'] + np.arange(w['width']) * sp
    norths = w['northwestSampleCentre']['northing'] - np.arange(w['height']) * sp
    return dict(window=w, a=a, easts=easts, norths=norths, sp=sp)


def flat_mask(a):
    d0 = np.abs(np.diff(a, axis=0))
    d1 = np.abs(np.diff(a, axis=1))
    m = np.ones(a.shape, bool)
    m[1:, :] &= d0 <= NEIGHBOUR_STEP_METRES
    m[:-1, :] &= d0 <= NEIGHBOUR_STEP_METRES
    m[:, 1:] &= d1 <= NEIGHBOUR_STEP_METRES
    m[:, :-1] &= d1 <= NEIGHBOUR_STEP_METRES
    return m


def census(p):
    a, sp, easts, norths = p['a'], p['sp'], p['easts'], p['norths']
    flat = flat_mask(a)
    lab, n = nd.label(flat, np.ones((3, 3)))
    cells = np.bincount(lab.ravel())
    rows = []
    for i in range(1, n + 1):
        if cells[i] * sp * sp < COMPONENT_MINIMUM_SQUARE_METRES:
            continue
        m = lab == i
        v = a[m]
        med = float(np.median(v))
        ys, xs = np.nonzero(m)
        rows.append(dict(label=int(i), cells=int(cells[i]), areaSquareMetres=round(cells[i] * sp * sp, 1),
                         medianHeightRH2000=round(med, 3),
                         levelness=round(float((np.abs(v - med) <= LEVEL_BAND_METRES).mean()), 4),
                         spreadP5P95Metres=round(float(np.percentile(v, 95) - np.percentile(v, 5)), 3),
                         touchesWindowEdge=bool(xs.min() == 0 or ys.min() == 0 or
                                                xs.max() == a.shape[1] - 1 or ys.max() == a.shape[0] - 1),
                         bboxEpsg3006=[round(float(easts[xs.min()]), 1), round(float(norths[ys.max()]), 1),
                                       round(float(easts[xs.max()]), 1), round(float(norths[ys.min()]), 1)]))
    rows.sort(key=lambda r: -r['areaSquareMetres'])
    p['flat'] = flat
    p['lab'] = lab
    p['rows'] = rows
    return rows


def edge_flags(ring, w, sp):
    b = w['pixelEdgeWindow']
    tol = EDGE_TOLERANCE_METRES + sp
    return [bool(abs(x - b['minEasting']) < tol or abs(x - b['maxEasting']) < tol or
                 abs(y - b['minNorthing']) < tol or abs(y - b['maxNorthing']) < tol) for x, y in ring]


def shoreline_runs(ring, flags, minimum=4):
    """Consecutive runs of NON-edge vertices: the parts that are really shore."""
    runs = []
    cur = []
    for pt, e in zip(ring, flags):
        if e:
            if len(cur) >= minimum:
                runs.append(cur)
            cur = []
        else:
            cur.append(pt)
    if len(cur) >= minimum:
        runs.append(cur)
    return runs


def nearest_to_polylines(points, polylines):
    out = []
    segs = []
    for line in polylines:
        t = np.asarray(line, float)
        if len(t) < 2:
            continue
        segs.append((t[:-1], t[1:] - t[:-1]))
    if not segs:
        return np.array([])
    for px, py in points:
        best = np.inf
        for a, ab in segs:
            denom = np.maximum((ab ** 2).sum(1), 1e-12)
            tt = np.clip(((px - a[:, 0]) * ab[:, 0] + (py - a[:, 1]) * ab[:, 1]) / denom, 0, 1)
            d = np.hypot(a[:, 0] + ab[:, 0] * tt - px, a[:, 1] + ab[:, 1] * tt - py).min()
            best = min(best, d)
        out.append(float(best))
    return np.array(out)


def stats(d, bands=(2, 5, 10, 25, 50)):
    if not len(d):
        return None
    s = dict(count=int(len(d)), medianMetres=round(float(np.median(d)), 2),
             p90Metres=round(float(np.percentile(d, 90)), 2), worstMetres=round(float(d.max()), 2),
             meanMetres=round(float(d.mean()), 2))
    s['withinMetresFraction'] = {str(b): round(float((d <= b).mean()), 3) for b in bands}
    return s


report = {
    'schemaVersion': 1,
    'layer': 'shoreline-and-sea',
    'measuredOn': '2026-09-08',
    'generator': 'lidingobuild/mapping/trace-coast.py',
    'horizontalCrs': 'EPSG:3006',
    'verticalCrs': 'EPSG:5613 (RH 2000)',
    'coordinateOrder': ['easting', 'northing'],
    'sourceCapture': {
        'id': lm.META['sourceId'],
        'captureDate': lm.META['captureDate'],
        'sha256': lm.META['sha256'],
        'licence': lm.META['licence']['id'],
        'attribution': lm.META['licence']['attribution'],
        'roleInThisLayer': ('the shoreline is a SHAPE and this capture does not cover it - 0 of 504 traced '
                            'shoreline vertices and 0 of 224 OSM coastline vertices fall inside the '
                            'orthophoto window - so the photograph refutes and confirms plates INLAND only. '
                            'See photograph.'),
    },
    'rule': {
        'statement': ('open water is a laser-FLAT plate at ONE height in a bare-earth model, and the shoreline '
                      'is where that plate ends. A component must pass BOTH tests; flat alone is not enough.'),
        'thresholds': {
            'neighbourStepMetres': NEIGHBOUR_STEP_METRES,
            'levelBandMetres': LEVEL_BAND_METRES,
            'levelnessMinimumBorrowed': LEVELNESS_BORROWED,
            'componentMinimumSquareMetres': COMPONENT_MINIMUM_SQUARE_METRES,
            'edgeToleranceMetres': EDGE_TOLERANCE_METRES,
            'inlandProbeMetres': list(INLAND_PROBE_METRES),
            'seaVsPondTest': 'contact with the acquisition window edge',
            'waterVsLandFlatTestUsedForGeometry': 'levelness >= 0.99 AND p5-p95 spread <= 0.01 m',
        },
        'howCalibrated': {
            'neighbourStepMetres': "the repo's own flat test, carried verbatim from the v2 flat-water pass",
            "levelnessMinimumBorrowed": ("BORROWED, and reported as borrowed: bracketed by Angso's land flats "
                                         "0.20-0.64 and Norrfallsviken's Gulf of Bothnia 0.787, the worst real "
                                         "water in this repo"),
            "waterVsLandFlatTestUsedForGeometry": ("CALIBRATED ON THIS GROUND: see "
                                                   "flatWaterCensus.fine.thisGroundsOwnGap. This ground's water "
                                                   "reads levelness 0.9974-1.0000 at a p5-p95 spread of exactly "
                                                   "0.000 m, its other level components 0.7149-0.8803 at "
                                                   "0.108-0.177 m, and the cut is put in that gap."),
            'componentMinimumSquareMetres': 'chosen to be well under the smallest existing water ring (67.7 m2 '
                                            'is smaller still and is handled by interiorFlatFraction instead)',
        },
        'whatTheRuleIsNot': ('it is not a colour rule. The photograph cannot see this feature - see photograph - '
                             'so nothing here is derived from pixels; the capture appears in this layer only as '
                             'a refusal and as the check that refuted two false accepts inland.'),
    },
    'shapeRecord': {
        'source': 'published Lidingö v2 ground graph (Lantmäteriet Markhöjdmodell 1 m), read through '
                  'packages/course-v2/published-ground-lookup.mjs at the finest level covering each sample',
        'captureDate': lm.DTM_CAPTURE,
        'licence': 'CC-BY-4.0',
        'attribution': 'Markhöjdmodell Nedladdning, © Lantmäteriet, bearbetad, CC BY 4.0',
        'windows': [{k: v for k, v in w.items()} for w in meta['windows']],
        'dumpedBy': 'lidingobuild/mapping/dump-dtm-coast.mjs',
    },
}

# --- 1. what the model already has, and where its coastal rings stop ---------
model = json.loads((ROOT / 'lidingobuild/course-model.json').read_text())
E0, N0 = 677700.5, 6586399.5          # model frame origin, read from model.frame
report['modelFrame'] = {'origin': {'easting': E0, 'northing': N0},
                        'toEpsg3006': 'easting = x + 677700.5, northing = 6586399.5 - z',
                        'note': 'the page frame has north at -z; EPSG:3006 northing increases north. '
                                'Every coordinate in this file is EPSG:3006.'}
clip = json.loads((ROOT / 'geo_data/course-v2/lidingo/mapping/water-breakgeometry-review.json').read_text())
existing = []
for r in model['water']:
    ring = [[p[0] + E0, N0 - p[1]] for p in r['ring']]
    ee = [p[0] for p in ring]
    nn = [p[1] for p in ring]
    existing.append(dict(id=r['id'], waterKind=r['waterKind'], level=r['level'], area=round(r['area'], 1),
                         vertices=len(ring), ring=ring,
                         bboxEpsg3006=[round(min(ee), 1), round(min(nn), 1), round(max(ee), 1), round(max(nn), 1)]))

fine = load('fine')
census(fine)
context = load('context')
census(context)

# plate fraction of the MODEL's own rings, measured on the 1 m plate
flat_fine = fine['flat']
level_ok = np.zeros_like(flat_fine)
for r in fine['rows']:
    if r['levelness'] >= LEVELNESS_BORROWED:
        level_ok |= (fine['lab'] == r['label'])
for e in existing:
    EEi, NNi = lm.interior_samples(e['ring'], step=1.0)
    if len(EEi):
        c = np.clip(np.round(EEi - fine['easts'][0]).astype(int), 0, flat_fine.shape[1] - 1)
        rr = np.clip(np.round(fine['norths'][0] - NNi).astype(int), 0, flat_fine.shape[0] - 1)
        inside = ((EEi >= fine['easts'][0]) & (EEi <= fine['easts'][-1]) &
                  (NNi <= fine['norths'][0]) & (NNi >= fine['norths'][-1]))
        e['interiorSamples'] = int(len(EEi))
        e['insideHeightWindowFraction'] = round(float(inside.mean()), 3)
        e['plateFraction'] = round(float(level_ok[rr, c][inside].mean()), 3) if inside.any() else None
        # plateFraction is measured against components over 500 m2, so a ring
        # smaller than that scores 0 for a reason that is about the census and
        # not about the ring. These two carry no area minimum.
        e['interiorFlatFraction'] = round(float(flat_fine[rr, c][inside].mean()), 3) if inside.any() else None
        hv = fine['a'][rr, c][inside]
        e['interiorMedianHeightRH2000'] = round(float(np.median(hv)), 3) if inside.any() else None
        e['interiorAtOwnLevelFraction'] = (round(float((np.abs(hv - e['level']) <= LEVEL_BAND_METRES).mean()), 3)
                                           if inside.any() else None)
        e['plateFractionCaveat'] = ('component minimum 500 m2 - this ring is smaller than that, so read '
                                    'interiorFlatFraction and interiorAtOwnLevelFraction instead'
                                    if e['area'] < COMPONENT_MINIMUM_SQUARE_METRES else None)

report['modelBefore'] = {
    'coast': model['coast'],
    'pois': model['pois'],
    'seaLevel': model['seaLevel'],
    'waterRings': [{k: v for k, v in e.items() if k != 'ring'} for e in existing],
    'coastalRingSource': {
        'sourceId': 'water-breaks-lm-1m',
        'sourceFeatureId': 'lm-658-67-water-14',
        'sourceAreaSquareMetres': clip['features'][0]['sourceAreaSquareMetres'],
        'clippedAreaSquareMetres': clip['features'][0]['clippedAreaSquareMetres'],
        'clipBoundsEpsg3006': clip['clipBoundsEpsg3006'],
        'measuredNotAssumed': ('the coastal rings stop at the CLIP BOX, not at a source item edge. The box is '
                               '2048 m square, its centre is the model origin E677700.5 N6586399.5 to 0.0 m, '
                               'and it is byte-for-byte the published level-0 ring extent - so the sea was cut '
                               'to the terrain window, not to item 658_67, which reaches 10 km. 20.657 km2 of '
                               'source sea survives as 0.099 km2, i.e. 0.48%.'),
        'clipBoxSideMetres': round(clip['clipBoundsEpsg3006'][2] - clip['clipBoundsEpsg3006'][0], 1),
        'clipBoxCentreOffsetFromModelOriginMetres': [
            round((clip['clipBoundsEpsg3006'][0] + clip['clipBoundsEpsg3006'][2]) / 2 - E0, 3),
            round((clip['clipBoundsEpsg3006'][1] + clip['clipBoundsEpsg3006'][3]) / 2 - N0, 3)],
        'equalsPublishedLevel0Ring': (clip['clipBoundsEpsg3006'] ==
                                      [WINDOWS['fine']['pixelEdgeWindow']['minEasting'],
                                       WINDOWS['fine']['pixelEdgeWindow']['minNorthing'],
                                       WINDOWS['fine']['pixelEdgeWindow']['maxEasting'],
                                       WINDOWS['fine']['pixelEdgeWindow']['maxNorthing']]),
    },
}

# --- 2. the laser-flat plate ------------------------------------------------
for name, p in (('fine', fine), ('context', context)):
    rows = p['rows']
    acc = [r for r in rows if r['levelness'] >= LEVELNESS_BORROWED]
    ref = [r for r in rows if r['levelness'] < LEVELNESS_BORROWED]
    water = [r for r in acc if r['spreadP5P95Metres'] <= 0.01 and r['levelness'] >= 0.99]
    nonwater_acc = [r for r in acc if r not in water]
    report.setdefault('flatWaterCensus', {})[name] = {
        'sampleSpacingMetres': p['sp'],
        'windowEpsg3006': p['window']['pixelEdgeWindow'],
        'minimumHeightRH2000': p['window']['minimumHeightRH2000'],
        'flatCells': int(p['flat'].sum()),
        'flatHectares': round(float(p['flat'].sum()) * p['sp'] * p['sp'] / 1e4, 2),
        'componentsOverMinimumArea': len(rows),
        'borrowedThreshold': LEVELNESS_BORROWED,
        'acceptedAtBorrowedThreshold': acc,
        'refusedNotLevelCount': len(ref),
        'refusedNotLevelWorst': ref[:10],
        'levelnessGapAtBorrowedCut': (round(min(r['levelness'] for r in acc) - max(r['levelness'] for r in ref), 4)
                                      if acc and ref else None),
        'levelnessAcceptedRange': [min(r['levelness'] for r in acc), max(r['levelness'] for r in acc)] if acc else None,
        'levelnessRefusedRange': [min(r['levelness'] for r in ref), max(r['levelness'] for r in ref)] if ref else None,
        'thisGroundsOwnGap': {
            'note': ('calibrated on THIS ground rather than borrowed: the plates the break geometry calls water '
                     'sit at one CONSTANT height (p5-p95 spread 0.000 m) with levelness >= 0.99, while every '
                     'other level component here spreads 0.10-0.18 m. The two distributions do not touch.'),
            'waterLevelnessRange': [min(r['levelness'] for r in water), max(r['levelness'] for r in water)] if water else None,
            'nonWaterAcceptedLevelnessRange': ([min(r['levelness'] for r in nonwater_acc),
                                                max(r['levelness'] for r in nonwater_acc)] if nonwater_acc else None),
            'gap': (round(min(r['levelness'] for r in water) - max(r['levelness'] for r in nonwater_acc), 4)
                    if water and nonwater_acc else None),
            'waterSpreadRange': [min(r['spreadP5P95Metres'] for r in water), max(r['spreadP5P95Metres'] for r in water)] if water else None,
            'nonWaterAcceptedSpreadRange': ([min(r['spreadP5P95Metres'] for r in nonwater_acc),
                                             max(r['spreadP5P95Metres'] for r in nonwater_acc)] if nonwater_acc else None),
            'falseAcceptsAtBorrowedThreshold': [{k: r[k] for k in ('label', 'areaSquareMetres', 'medianHeightRH2000',
                                                                   'levelness', 'spreadP5P95Metres', 'bboxEpsg3006')}
                                                for r in nonwater_acc],
        },
    }
    p['water'] = water

# --- the sea, told from the ponds by CONTAINMENT, never by winding -----------
sea_fine_rows = [r for r in fine['water'] if r['touchesWindowEdge']]
pond_rows_fine = [r for r in fine['water'] if not r['touchesWindowEdge']]
sea_ctx_rows = [r for r in context['water'] if r['touchesWindowEdge'] and r['areaSquareMetres'] >= 10000]
report['seaSelection'] = {
    'rule': ('a level plate that REACHES the acquisition window edge continues beyond it and is the sea; a '
             'level plate wholly inside the window is an inland pond. Edge contact is a containment question '
             'about the window, not a winding or a height test, so it cannot be flipped by a frame convention.'),
    'lowestPlateHeightRH2000': min(r['medianHeightRH2000'] for r in fine['water']),
    'seaMeasuredLevelRH2000': sorted({r['medianHeightRH2000'] for r in sea_fine_rows}),
    'sea': [{k: r[k] for k in ('label', 'areaSquareMetres', 'medianHeightRH2000', 'levelness',
                               'spreadP5P95Metres', 'bboxEpsg3006')} for r in sea_fine_rows],
    'inlandPonds': [{k: r[k] for k in ('label', 'areaSquareMetres', 'medianHeightRH2000', 'levelness',
                                       'spreadP5P95Metres', 'bboxEpsg3006')} for r in pond_rows_fine],
    'modelSeaLevelDisagreement': {
        'modelSeaLevel': model['seaLevel'],
        'modelCoastalRingLevel': existing[0]['level'],
        'measuredPlateLevelRH2000': sorted({r['medianHeightRH2000'] for r in sea_ctx_rows}),
        'note': ('the model carries seaLevel 0 while its own coastal rings and the plate both read 0.100 m '
                 'RH 2000 - a 0.1 m internal disagreement, measured, not fixed here'),
    },
}


# --- 3. trace the shoreline off the plate -----------------------------------
def trace_plate(p, rows, thin, source):
    out = []
    for i, r in enumerate(rows):
        mask = p['lab'] == r['label']
        ring = lm.trace_outline(mask, p['easts'], p['norths'], thin_metres=thin)
        if ring is None:
            continue
        flags = edge_flags(ring, p['window'], p['sp'])
        runs = shoreline_runs(ring, flags)
        filled = nd.binary_fill_holes(mask)
        interior = p['a'][filled]
        med = float(np.median(interior))
        # the land behind the shore: a real shoreline rises away from the plate
        land = {}
        for probe in INLAND_PROBE_METRES:
            grown = nd.binary_dilation(mask, np.ones((3, 3)), iterations=max(1, int(round(probe / p['sp']))))
            band = grown & ~nd.binary_dilation(mask, np.ones((3, 3)),
                                               iterations=max(1, int(round((probe - p['sp']) / p['sp']))))
            band[0, :] = band[-1, :] = band[:, 0] = band[:, -1] = False
            v = p['a'][band]
            land[f'{probe:g}m'] = dict(samples=int(v.size),
                                       medianHeightRH2000=round(float(np.median(v)), 3) if v.size else None,
                                       aboveWaterMetres=round(float(np.median(v)) - med, 3) if v.size else None)
        # a self-check on the tracer itself: the ring's own shoelace area against
        # the component's filled cell count. lm2025.trace_outline is verified at
        # 0.957 IoU on a concave test shape; this says what it did HERE.
        rr = np.asarray(ring, float)
        shoelace = abs(float(np.sum(rr[:-1, 0] * rr[1:, 1] - rr[1:, 0] * rr[:-1, 1])) / 2)
        filled_area = float(nd.binary_fill_holes(mask).sum()) * p['sp'] * p['sp']
        out.append(dict(
            id=f'lidingo-sea-{source}-{i + 1}', component=r, ring=ring, edgeFlags=flags, runs=runs,
            tracedRingAreaSquareMetres=round(shoelace, 1),
            filledComponentAreaSquareMetres=round(filled_area, 1),
            traceAreaRatio=round(shoelace / filled_area, 4),
            plateFraction=round(float(mask[filled].mean()), 4),
            interiorMedianHeightRH2000=round(med, 3),
            interiorLevelness=round(float((np.abs(interior - med) <= LEVEL_BAND_METRES).mean()), 4),
            landBehindShore=land))
    return out


sea_fine = trace_plate(fine, sea_fine_rows, 2.0, 'fine')
sea_context = trace_plate(context, sea_ctx_rows, 4.0, 'context')


# --- islands: complement components INSIDE the plate, by containment depth ---
def islands_of(p, rows):
    mask = np.zeros(p['flat'].shape, bool)
    for r in rows:
        mask |= (p['lab'] == r['label'])
    inv, ninv = nd.label(~mask, np.ones((3, 3)))
    border = set(np.unique(np.concatenate([inv[0, :], inv[-1, :], inv[:, 0], inv[:, -1]])))
    out = []
    for i in range(1, ninv + 1):
        if i in border:
            continue
        cells = int((inv == i).sum())
        if cells * p['sp'] * p['sp'] < COMPONENT_MINIMUM_SQUARE_METRES:
            continue
        m = inv == i
        ys, xs = np.nonzero(m)
        ring = lm.trace_outline(m, p['easts'], p['norths'], thin_metres=max(2.0, p['sp']))
        out.append(dict(containmentDepth=1, areaSquareMetres=round(cells * p['sp'] * p['sp'], 1),
                        maximumHeightRH2000=round(float(p['a'][m].max()), 2),
                        medianHeightRH2000=round(float(np.median(p['a'][m])), 2),
                        bboxEpsg3006=[round(float(p['easts'][xs.min()]), 1), round(float(p['norths'][ys.max()]), 1),
                                      round(float(p['easts'][xs.max()]), 1), round(float(p['norths'][ys.min()]), 1)],
                        ringEpsg3006=ring))
    out.sort(key=lambda r: -r['areaSquareMetres'])
    return out


islands_fine = islands_of(fine, sea_fine_rows)
islands_ctx = islands_of(context, sea_ctx_rows)
report['islands'] = {
    'rule': ('classified by CONTAINMENT DEPTH, never by winding: a complement component of the plate that '
             'never reaches the window border is enclosed by the plate (depth 1). Winding flips meaning '
             'between a z-south page frame and EPSG:3006 northing, and that mistake once read a 15 ha island '
             'as the lake. Every one of these also stands ABOVE the plate, which a hole in the trace would not.'),
    'fine1m': islands_fine,
    'context2m': islands_ctx,
    'countFine': len(islands_fine),
    'countContext': len(islands_ctx),
    'namingRefused': ('no name source on disk reaches them: the OSM extract bbox stops at N ~6587023 and every '
                      'island but one lies north or east of it, so no island is named and none is emitted as a poi'),
}

# --- 3b. agreement with the records that exist ------------------------------
osm = None
for f in json.loads((ROOT / 'geo_data/course-v2/lidingo/reference/osm-context-epsg3006.geojson').read_text())['features']:
    if f['properties']['tags'].get('natural') == 'coastline':
        osm = dict(osmId=f['properties']['osmId'], version=f['properties']['osmVersion'],
                   timestamp=f['properties']['osmTimestamp'], tags=f['properties']['tags'],
                   line=f['geometry']['coordinates'])

agreements = []
all_runs_fine = [run for t in sea_fine for run in t['runs']]
for t in sea_fine:
    shore = [pt for run in t['runs'] for pt in run]
    entry = dict(id=t['id'], label=t['component']['label'], ringVertices=len(t['ring']),
                 shorelineVertices=len(shore), acquisitionEdgeVertices=int(sum(t['edgeFlags'])),
                 shorelineRuns=len(t['runs']))
    same = [e for e in existing if e['waterKind'] == 'coastal-water'
            and not (e['bboxEpsg3006'][2] < t['component']['bboxEpsg3006'][0] - 5 or
                     e['bboxEpsg3006'][0] > t['component']['bboxEpsg3006'][2] + 5 or
                     e['bboxEpsg3006'][3] < t['component']['bboxEpsg3006'][1] - 5 or
                     e['bboxEpsg3006'][1] > t['component']['bboxEpsg3006'][3] + 5)]
    if same and shore:
        entry['versusModelCoastalRing'] = dict(
            id=same[0]['id'], independent=False,
            note=('the break geometry and this plate are the SAME record - Lantmäteriet flattens water in the '
                  'height model and publishes the break lines describing that flattening - so this is a '
                  'CONSISTENCY check on the tracing, not corroboration of the shoreline'),
            **stats(nearest_to_polylines(shore, [same[0]['ring']])))
    agreements.append(entry)

# the independent score: OSM's landsat coastline against the traced shore runs.
# Only OSM vertices well inside the height window can be scored - outside it the
# plate is not traced and a distance would measure the window, not the shore.
b = WINDOWS['fine']['pixelEdgeWindow']
inset = 25.0
osm_scorable = [p for p in osm['line'] if b['minEasting'] + inset <= p[0] <= b['maxEasting'] - inset
                and b['minNorthing'] + inset <= p[1] <= b['maxNorthing'] - inset]
d_osm_to_shore = nearest_to_polylines(osm_scorable, all_runs_fine)
shore_pts = [pt for run in all_runs_fine for pt in run]
# the reverse direction is only meaningful where OSM HAS a record: its way covers
# the south-western shore only, so a traced vertex on the north-eastern plate has
# nothing to be compared with and would report a kilometre of nothing.
_o = np.asarray(osm['line'], float)
_ob = [_o[:, 0].min() - 150, _o[:, 1].min() - 150, _o[:, 0].max() + 150, _o[:, 1].max() + 150]
shore_in_osm = [pt for pt in shore_pts if _ob[0] <= pt[0] <= _ob[2] and _ob[1] <= pt[1] <= _ob[3]]
d_shore_to_osm = nearest_to_polylines(shore_in_osm, [osm['line']])
report['independentScore'] = {
    'record': dict(source='OpenStreetMap natural=coastline', osmId=osm['osmId'], osmVersion=osm['version'],
                   osmTimestamp=osm['timestamp'], tagSource=osm['tags'].get('source'),
                   vertices=len(osm['line']), lengthMetres=round(float(np.hypot(*np.diff(np.asarray(osm['line'], float), axis=0).T).sum()), 1),
                   whyIndependent='traced from Landsat by OSM contributors; it never entered the laser DTM, the '
                                  'break geometry, the orthophoto or this rule',
                   itsOwnResolution='Landsat is 30 m/pixel, so the original import cannot be held to better '
                                    'than tens of metres; this way is at version 25 with edits to 2022, so it '
                                    'has plainly been refined since, which is consistent with the few-metre '
                                    'agreement measured below',
                   independenceCaution=('the way itself carries source=landsat and nothing else, but other water '
                                        'in the same extract carries source:lake="Review by So9q using LM '
                                        'Topographic Map". A later contributor aligning this coastline to a '
                                        'Lantmäteriet product cannot be excluded from its history, and that '
                                        'would make part of the agreement circular. The tag record does not '
                                        'say so and the score is reported as measured.')),
    'osmVerticesInsideHeightWindow': len([p for p in osm['line'] if b['minEasting'] <= p[0] <= b['maxEasting']
                                          and b['minNorthing'] <= p[1] <= b['maxNorthing']]),
    'osmVerticesScored': len(osm_scorable),
    'scoringGeometry': ('OSM vertices are scored only where they lie 25 m inside the height window, since '
                        'outside it there is no traced plate to be near; traced vertices are scored only '
                        'within 150 m of the OSM way\'s own envelope, since its way covers the south-western '
                        'shore alone and the north-eastern plate has no OSM record at all'),
    'tracedShoreVerticesWithAnOsmRecord': len(shore_in_osm),
    'tracedShoreVerticesWithNoOsmRecord': len(shore_pts) - len(shore_in_osm),
    'osmVertexToTracedShore': stats(d_osm_to_shore),
    'tracedShoreVertexToOsm': stats(d_shore_to_osm),
    'reading': None,   # filled below
}
report['agreement'] = agreements

# --- 4. does the 2025 photograph agree? -------------------------------------
ow = lm.META['windowEpsg3006']


def in_ortho(x, y):
    return ow['minEasting'] <= x <= ow['maxEasting'] and ow['minNorthing'] <= y <= ow['maxNorthing']


total = len(shore_pts)
covered = sum(1 for x, y in shore_pts if in_ortho(x, y))
ctx_shore = [pt for t in sea_context for run in t['runs'] for pt in run]
photo = dict(
    orthoWindowEpsg3006=ow,
    tracedShorelineVerticesFine=total,
    tracedShorelineVerticesFineInsideOrtho=covered,
    tracedShorelineVerticesContext=len(ctx_shore),
    tracedShorelineVerticesContextInsideOrtho=sum(1 for x, y in ctx_shore if in_ortho(*[x, y])),
    osmCoastlineVerticesInsideOrtho=int(sum(1 for p in osm['line'] if in_ortho(*p))),
    seaPlateSamplesInsideOrtho=None,
    verdict=None)
ys, xs = np.nonzero(np.isin(fine['lab'], [r['label'] for r in sea_fine_rows]))
photo['seaPlateSamplesInsideOrtho'] = int(sum(1 for e, n in zip(fine['easts'][xs], fine['norths'][ys]) if in_ortho(e, n)))
photo['seaPlateSamplesFine'] = int(len(xs))

# The colour rule CAN be calibrated where the capture DOES hold plate: the inland
# ones. Water in an ortho is dark and unsaturated - measure the gap, and use it
# to test the level components the break geometry does NOT call water.
def colour_of(mask, p, rings=3, gap=1):
    grown = nd.binary_dilation(mask, np.ones((3, 3)), iterations=rings + gap)
    collar = grown & ~nd.binary_dilation(mask, np.ones((3, 3)), iterations=gap)
    core = nd.binary_erosion(mask, np.ones((3, 3)), iterations=2)
    if core.sum() < 30:
        core = mask
    out = {}
    for key, m in (('inside', core), ('collar', collar)):
        yy, xx = np.nonzero(m)
        if not len(yy):
            return None
        px = lm.sample(p['easts'][xx], p['norths'][yy])
        L, G, _ = lm.indices(px)
        sat = (px.max(1).astype(float) - px.min(1)) / np.maximum(px.max(1), 1)
        out[key] = dict(samples=int(len(yy)),
                        luminanceMedian=round(float(np.median(L)), 1),
                        luminanceP10=round(float(np.percentile(L, 10)), 1),
                        luminanceP90=round(float(np.percentile(L, 90)), 1),
                        excessGreenMedian=round(float(np.median(G)), 1),
                        saturationMedian=round(float(np.median(sat)), 3))
    return out


colour_rows = []
for r in fine['rows']:
    if r['levelness'] < LEVELNESS_BORROWED or r['touchesWindowEdge']:
        continue
    mask = fine['lab'] == r['label']
    yy, xx = np.nonzero(mask)
    if not all(in_ortho(e, n) for e, n in zip(fine['easts'][xx], fine['norths'][yy])):
        continue
    c = colour_of(mask, fine)
    if c is None:
        continue
    claimed = any(abs(e['level'] - r['medianHeightRH2000']) < 0.2 and
                  e['bboxEpsg3006'][0] - 8 <= r['bboxEpsg3006'][0] and r['bboxEpsg3006'][2] <= e['bboxEpsg3006'][2] + 8
                  for e in existing)
    colour_rows.append(dict(label=r['label'], areaSquareMetres=r['areaSquareMetres'],
                            levelRH2000=r['medianHeightRH2000'], levelness=r['levelness'],
                            spreadP5P95Metres=r['spreadP5P95Metres'],
                            claimedWaterByBreakGeometry=bool(claimed), **c))
# the cut, put in the gap THIS capture's own pixels leave on these plates
water_c = [r for r in colour_rows if r['claimedWaterByBreakGeometry']]
other_c = [r for r in colour_rows if not r['claimedWaterByBreakGeometry']]
lum_cut = sat_cut = lum_gap = None
if water_c and other_c:
    lum_gap = round(min(r['inside']['luminanceMedian'] for r in other_c) -
                    max(r['inside']['luminanceMedian'] for r in water_c), 1)
    lum_cut = round((min(r['inside']['luminanceMedian'] for r in other_c) +
                     max(r['inside']['luminanceMedian'] for r in water_c)) / 2, 1)
photo['calibrationOnInlandPlates'] = dict(
    why=('the sea is outside the capture, so the water/land colour rule is calibrated where the capture DOES '
         'hold a laser plate: the inland ones. The four plates the break geometry calls water and the level '
         'components it does not are compared on the same statistic.'),
    plates=colour_rows,
    interiorLuminanceOfBreakGeometryWater=[r['inside']['luminanceMedian'] for r in water_c],
    interiorLuminanceOfOtherLevelPlates=[r['inside']['luminanceMedian'] for r in other_c],
    luminanceGap=lum_gap,
    luminanceCut=lum_cut,
    reading=None)
report['photograph'] = photo

# --- how far the sea is from the played ground ------------------------------
played = []
for h in model['holes']:
    played += [[p[0] + E0, N0 - p[1]] for p in h['line']]
    for k in ('green', 'fairway'):
        g = h.get(k)
        if isinstance(g, list) and g and isinstance(g[0], list):
            played += [[p[0] + E0, N0 - p[1]] for p in g]
    tees = h.get('tees') or {}
    for pad in (tees.get('pads') or []):
        ring = pad.get('ring') if isinstance(pad, dict) else pad
        if isinstance(ring, list) and ring and isinstance(ring[0], list):
            played += [[p[0] + E0, N0 - p[1]] for p in ring]
se = fine['easts'][xs]
sn = fine['norths'][ys]
d_play = np.array([float(np.min(np.hypot(se - p[0], sn - p[1]))) for p in played])
ctx_ys, ctx_xs = np.nonzero(np.isin(context['lab'], [r['label'] for r in sea_ctx_rows]))
cse = context['easts'][ctx_xs]
csn = context['norths'][ctx_ys]
d_play_ctx = np.array([float(np.min(np.hypot(cse - p[0], csn - p[1]))) for p in played])
report['seaDistanceToPlay'] = dict(
    playedPoints=len(played),
    nearestPlayedPointToSeaMetres=round(float(d_play_ctx.min()), 1),
    medianPlayedPointToSeaMetres=round(float(np.median(d_play_ctx)), 1),
    nearestUsingFineWindowOnlyMetres=round(float(d_play.min()), 1),
    note=('the club sits on the Lidingö coast and the sea is visible from it, but no played point touches '
          'the water: the nearest is a third of a kilometre away, so this layer is horizon and setting, '
          'not a hazard'))

# --- readings, refusals, state ---------------------------------------------
_a2s = report['independentScore']['osmVertexToTracedShore']
_s2a = report['independentScore']['tracedShoreVertexToOsm']
report['independentScore']['reading'] = (
    f"the traced shore and OSM's Landsat coastline agree at a median {_a2s['medianMetres']} m over "
    f"{_a2s['count']} scorable OSM vertices, {int(_a2s['withinMetresFraction']['10'] * 100)}% within 10 m and "
    f"a worst of {_a2s['worstMetres']} m; the other way round it is a median {_s2a['medianMetres']} m over "
    f"{_s2a['count']} traced vertices, worst {_s2a['worstMetres']} m. Two records that never entered each "
    'other therefore put this shoreline in the same place to a few metres. What that does NOT establish is '
    'the shape: a 30 m/pixel record cannot corroborate a 1 m one below its own resolution, so the agreement '
    'is read as position and the geometry comes from the laser. '
    f"{report['independentScore']['tracedShoreVerticesWithNoOsmRecord']} traced vertices - the whole "
    'north-eastern plate - have no OSM record at all and are scored by nothing.')
photo['verdict'] = (
    f"the photograph cannot see this shoreline. {photo['tracedShorelineVerticesFineInsideOrtho']} of "
    f"{photo['tracedShorelineVerticesFine']} traced shoreline vertices, "
    f"{photo['tracedShorelineVerticesContextInsideOrtho']} of {photo['tracedShorelineVerticesContext']} at 2 m, "
    f"{photo['seaPlateSamplesInsideOrtho']} of {photo['seaPlateSamplesFine']} sea-plate samples and "
    f"{photo['osmCoastlineVerticesInsideOrtho']} of {len(osm['line'])} OSM coastline vertices fall inside the "
    'orthophoto window. The capture was requested over the played ground; the sea is 0.3-0.6 km outside it. '
    'Step 4 of this layer is therefore REFUSED for the shoreline and answered on the inland plates instead.')
photo['calibrationOnInlandPlates']['reading'] = (
    (f"the break geometry's water reads interior luminance {sorted(r['inside']['luminanceMedian'] for r in water_c)} "
     f"and the level plates it does not claim read {sorted(r['inside']['luminanceMedian'] for r in other_c)}; the gap "
     f"is {lum_gap} and a cut at {lum_cut} separates them on this capture. So on the plates the photograph CAN see, "
     'colour and the break geometry agree, and the photograph independently refutes the false accepts the borrowed '
     '0.70 levelness threshold let through.') if lum_gap is not None else
    'not enough plates inside the capture to state a cut')

REFUSALS = [
    dict(kind='photograph-does-not-cover-the-feature', what='the 2025-05-31 Lantmäteriet capture over the shoreline',
         numbers=dict(shorelineVerticesInsideCapture=photo['tracedShorelineVerticesFineInsideOrtho'],
                      shorelineVerticesTotal=photo['tracedShorelineVerticesFine'],
                      seaPlateSamplesInsideCapture=photo['seaPlateSamplesInsideOrtho'],
                      seaPlateSamplesTotal=photo['seaPlateSamplesFine'],
                      captureWindowEpsg3006=ow,
                      seaPlateBboxes=[r['bboxEpsg3006'] for r in sea_fine_rows]),
         consequence='the shoreline carries ONE shape record (the laser) plus one coarse independent position '
                     'record (OSM landsat). It is not photo-confirmed and is not claimed to be.',
         whatWouldFix='a capture window enlarged to the 2048 m level-0 ring; the same service and the same six '
                      'requests would cover it'),
    dict(kind='not-traceable-beyond-the-window',
         what='the sea outside the published ground graph',
         numbers=dict(fineWindowSeaHectares=round(sum(r['areaSquareMetres'] for r in sea_fine_rows) / 1e4, 2),
                      contextWindowSeaHectares=round(sum(r['areaSquareMetres'] for r in sea_ctx_rows) / 1e4, 2),
                      sourceFeatureHectares=round(clip['features'][0]['sourceAreaSquareMetres'] / 1e4, 2),
                      acquisitionEdgeVerticesFine=int(sum(sum(t['edgeFlags']) for t in sea_fine)),
                      acquisitionEdgeVerticesContext=int(sum(sum(t['edgeFlags']) for t in sea_context))),
         consequence='every ring here closes through the acquisition edge. acquisitionEdgeFlags marks which '
                     'vertices are not shoreline; they must never be drawn as one.',
         whatWouldFix='the lod 2-6 rings reach 16 km and would trace the same plate at 4-64 m'),
    dict(kind='no-name-source', what='the islands and any coastal poi',
         numbers=dict(islandsFine=len(islands_fine), islandsContext=len(islands_ctx),
                      osmExtractBboxWgs84=[18.1191947, 59.3735013, 18.1361814, 59.3843145],
                      islandsInsideOsmExtract=0),
         consequence='model.pois stays empty for this layer; an island is geometry here, never a named landmark',
         whatWouldFix='an OSM extract over the archipelago, or Lantmäteriet ortnamn'),
    dict(kind='threshold-borrowed-not-calibrated',
         what="the 0.70 levelness cut taken from Ängsö/Norrfällsviken",
         numbers=dict(falseAcceptsFine=report['flatWaterCensus']['fine']['thisGroundsOwnGap']['falseAcceptsAtBorrowedThreshold'],
                      thisGroundsWaterLevelness=report['flatWaterCensus']['fine']['thisGroundsOwnGap']['waterLevelnessRange'],
                      thisGroundsNonWaterAcceptedLevelness=report['flatWaterCensus']['fine']['thisGroundsOwnGap']['nonWaterAcceptedLevelnessRange'],
                      gapOnThisGround=report['flatWaterCensus']['fine']['thisGroundsOwnGap']['gap']),
         consequence='0.70 is not wrong here, it is merely loose: it admits five roofs and mown terraces of '
                     '518-937 m2. The sea is selected by a rule those cannot pass anyway (constant height AND '
                     'edge contact), so no false accept reaches the geometry - but a future flat-water pass on '
                     'this ground should use this ground\'s own cut, not the borrowed one.',
         whatWouldFix='nothing to acquire; the numbers to calibrate on are in flatWaterCensus'),
]

STATE = 'measured-candidate-geometry'
report['adoptionArgument'] = {
    'state': STATE,
    'whatIsMeasured': ('two sea plates in the 1 m window (8.90 ha and 0.96 ha) and one 593.83 ha plate in the '
                       '2 m window, all at a CONSTANT 0.100 m RH 2000, traced to closed rings with every '
                       'acquisition-edge vertex flagged'),
    'recordOne': 'the published 1 m laser DTM, 2021-03-23 - the shape record',
    'recordTwo': "OpenStreetMap's Landsat coastline, way 15733694 - independent of everything above, agreeing "
                 'at a median of a few metres over 124 scorable vertices',
    'recordThreeIsNotIndependent': ('the model\'s existing coastal rings come from the SAME Lantmäteriet '
                                    'flattening; their 1.4 m median agreement with this trace is a consistency '
                                    'check on the tracing and is reported as one'),
    'whatIsNew': ('the model has coast [] and 9.9 ha of sea clipped to a 2048 m box. This measures the same '
                  'plate independently of the polygon product, hands back the shoreline as chains with the '
                  'acquisition edge marked, extends the sea 60x to 593.83 ha with 20 measured islands, and '
                  'records the sea level as 0.100 m RH 2000 against the model\'s seaLevel 0.'),
    'whatIsNotClaimed': ('not photo-confirmed; not a 2025 shoreline - the shape is 2021-03-23 and anything '
                         'built or eroded since has colour and no shape here, and no colour either because the '
                         'capture does not reach it. Not a survey.'),
}


def emit(traces, spacing, thin):
    out = []
    for t in traces:
        c = t['component']
        out.append(dict(
            id=t['id'], waterKind='sea', isSea=True, containmentDepth=0,
            measuredLevelRH2000=c['medianHeightRH2000'],
            levelSpreadP5P95Metres=c['spreadP5P95Metres'],
            flatnessLevelness=c['levelness'],
            plateFraction=t['plateFraction'],
            interiorLevelness=t['interiorLevelness'],
            landBehindShore=t['landBehindShore'],
            areaSquareMetres=c['areaSquareMetres'],
            tracedRingAreaSquareMetres=t['tracedRingAreaSquareMetres'],
            filledComponentAreaSquareMetres=t['filledComponentAreaSquareMetres'],
            traceAreaRatio=t['traceAreaRatio'],
            sampleSpacingMetres=spacing, traceThinMetres=thin,
            vertices=len(t['ring']),
            shorelineVertices=int(len(t['ring']) - sum(t['edgeFlags'])),
            acquisitionEdgeVertices=int(sum(t['edgeFlags'])),
            shorelineChains=t['runs'],
            bboxEpsg3006=c['bboxEpsg3006'],
            ringEpsg3006=t['ring'],
            acquisitionEdgeFlags=[int(f) for f in t['edgeFlags']]))
    return out


report['tracedShoreline'] = {
    'note': ('every ring is CLOSED through the acquisition window edge; acquisitionEdgeFlags marks each vertex '
             'that lies on that edge and shorelineChains carries only the runs that are really shore. Ring '
             'vertex order is raster-order Moore-neighbour tracing - ask membership by containment, never by '
             'winding.'),
    'fine1m': emit(sea_fine, 1, 2.0),
    'context2m': emit(sea_context, 2, 4.0),
}
report['refusals'] = REFUSALS
report['state'] = STATE
OUT.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=_num) + '\n', encoding='utf8')

print(json.dumps({
    'state': STATE,
    'seaFine': [{k: r[k] for k in ('id', 'areaSquareMetres', 'measuredLevelRH2000', 'levelSpreadP5P95Metres',
                                   'flatnessLevelness', 'plateFraction', 'traceAreaRatio', 'vertices',
                                   'shorelineVertices', 'acquisitionEdgeVertices', 'landBehindShore')} for r in report['tracedShoreline']['fine1m']],
    'seaContext': [{k: r[k] for k in ('id', 'areaSquareMetres', 'measuredLevelRH2000', 'flatnessLevelness',
                                      'plateFraction', 'vertices', 'shorelineVertices', 'acquisitionEdgeVertices')}
                   for r in report['tracedShoreline']['context2m']],
    'ownGapFine': report['flatWaterCensus']['fine']['thisGroundsOwnGap'],
    'independentScore': report['independentScore'],
    'agreement': agreements,
    'photo': {k: v for k, v in photo.items() if k != 'calibrationOnInlandPlates'},
    'photoCalibration': {k: v for k, v in photo['calibrationOnInlandPlates'].items() if k != 'plates'},
    'islands': dict(fine=len(islands_fine), context=len(islands_ctx),
                    largest=[i['areaSquareMetres'] for i in islands_ctx[:5]]),
    'play': report['seaDistanceToPlay'],
}, indent=1, default=_num))
