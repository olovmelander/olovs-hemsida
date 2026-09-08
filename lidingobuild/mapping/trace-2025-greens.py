"""Can a green be traced on the 2025 capture? Five methods compete; the number decides.

This repository has refused traced greens once and accepted them once, and the
difference was the photograph. At Veckefjarden six methods on a 0.27 m autumn
frame reached a median IoU of 0.65 against the surveyed outlines and NONE was
adopted: the imagery shows the green COMPLEX and not the putting surface. At
Ribbingsfors a leaf-off capture made mown turf vivid against dormant pasture and
all nine passed. Lidingo's 2025 frame is finer than either at 0.16 m and is
leaf-on late spring, so which of those two it is, is a question about it.

Five methods, each scored against the 11 OSM green rings that carry a hole -
geometry nobody read off this capture:

  colourgrow    region growth on excess green from the GPS centre
  firststep     per-ray, the first sustained fall in excess green
  largeststep   per-ray, the radius of the steepest fall
  roughness     region growth on 1 m laser roughness (a green is the smoothest turf)
  fusion        growth on the normalised sum of colour and smoothness

The bar is a median IoU of 0.75 and a region on 16 of 18 holes. 0.65 is a
method this repository has already decided against, so anything at or under it
is refused here too - and the refusal is written down with its numbers, because
a measurement taken and then ignored is worse than one never made.

  python3 lidingobuild/mapping/trace-2025-greens.py [--write]
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage as nd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lm2025

ROOT = lm2025.ROOT
STEP = 0.25
HALF = 45.0
MIN_AREA, MAX_AREA = 150.0, 1400.0     # the 11 OSM greens measure 246-921 m2
MIN_COMPACTNESS = 0.45                  # a green is a compact blob; 4*pi*A/P^2
ADOPT_MEDIAN_IOU = 0.75
ADOPT_HOLES = 16


def field(centre):
    e0, n0 = centre
    g = np.arange(-HALF, HALF + STEP / 2, STEP)
    EE, NN = np.meshgrid(e0 + g, n0 - g)
    lum, exg, rg = lm2025.indices(lm2025.sample(EE, NN))
    # the 1 m laser's local roughness: a green is the smoothest turf on a course
    h = lm2025.dtm_at(EE, NN)
    rough = nd.generic_filter(h, np.std, size=int(round(3.0 / STEP)), mode='nearest')
    return EE, NN, lum, exg, rough


def grow(EE, NN, mask, centre):
    m = nd.binary_opening(mask, np.ones((3, 3), bool))
    lab, _ = nd.label(m)
    ci = int(np.argmin((EE - centre[0]) ** 2 + (NN - centre[1]) ** 2))
    here = lab.flat[ci]
    return (lab == here) if here else None


def stats(comp):
    area = int(comp.sum()) * STEP * STEP
    edge = int((comp ^ nd.binary_erosion(comp, np.ones((3, 3), bool))).sum())
    perim = max(edge * STEP, 1e-6)
    return area, 4 * np.pi * area / (perim * perim)


def ring_from_radii(centre, radii, angles):
    ring = [[round(float(centre[0] + r * np.sin(a)), 3), round(float(centre[1] + r * np.cos(a)), 3)]
            for r, a in zip(radii, angles)]
    ring.append(ring[0])
    return ring


def polar(centre, signal_at, mode):
    """Walk rays out from the survey centre and take a radius per ray.

    `firststep` takes the first sustained fall below half the centre's own
    value; `largeststep` takes the steepest fall. The radii are then median
    filtered AROUND THE CIRCLE, because a single ray that runs down a mown
    approach is one ray and not a green."""
    angles = np.linspace(0, 2 * np.pi, 180, endpoint=False)
    rr = np.arange(1.0, 36.0, 0.25)
    E = centre[0] + np.outer(rr, np.sin(angles))
    N = centre[1] + np.outer(rr, np.cos(angles))
    v = signal_at(E, N)
    v = nd.uniform_filter1d(v, size=9, axis=0, mode='nearest')
    inner = np.median(v[:12, :], axis=0)
    outer = np.percentile(v, 10)
    radii = np.zeros(len(angles))
    for j in range(len(angles)):
        prof = v[:, j]
        if mode == 'firststep':
            cut = outer + 0.5 * (inner[j] - outer)
            below = prof < cut
            # sustained: eight consecutive samples (2 m) under the cut
            run = np.convolve(below.astype(int), np.ones(8, int), 'valid')
            hit = np.nonzero(run >= 8)[0]
            radii[j] = rr[hit[0]] if len(hit) else rr[-1]
        else:
            d = np.diff(prof)
            radii[j] = rr[int(np.argmin(d)) + 1]
    radii = nd.median_filter(radii, size=15, mode='wrap')
    return ring_from_radii(centre, radii, angles), angles


def iou(ring_a, ring_b):
    xs = [p[0] for p in ring_a] + [p[0] for p in ring_b]
    ys = [p[1] for p in ring_a] + [p[1] for p in ring_b]
    gx = np.arange(min(xs) - 1, max(xs) + 1, 0.25)
    gy = np.arange(min(ys) - 1, max(ys) + 1, 0.25)
    EE, NN = np.meshgrid(gx, gy)
    A = lm2025.point_in_ring(EE, NN, ring_a)
    B = lm2025.point_in_ring(EE, NN, ring_b)
    u = (A | B).sum()
    return float((A & B).sum() / u) if u else 0.0


def ring_area(ring):
    a = 0.0
    ox, oy = ring[0]
    for i in range(len(ring) - 1):
        a += (ring[i][0] - ox) * (ring[i + 1][1] - oy) - (ring[i + 1][0] - ox) * (ring[i][1] - oy)
    return abs(a) / 2


def main(write=False):
    survey = lm2025.survey()
    surfaces = lm2025.surfaces()
    osm = {f['properties']['hole']: lm2025.rings_of(f['geometry'])[0]
           for f in surfaces['features']
           if f['properties']['kind'] == 'green'
           and f['properties']['method'] == 'unchanged-osm-source-ring'
           and f['properties']['hole']}

    green_px, ref_px = [], []
    for hole, ring in osm.items():
        E, N = lm2025.interior_samples(ring, 0.5)
        if len(E):
            green_px.append(lm2025.sample(E, N))
        c = survey[hole]['Green Center']
        ang = np.linspace(0, 2 * np.pi, 64, endpoint=False)
        for r in (25, 32, 40):
            ref_px.append(lm2025.sample(c[0] + r * np.cos(ang), c[1] + r * np.sin(ang)))
    g_lum, g_exg, _ = lm2025.indices(np.concatenate(green_px))
    r_lum, r_exg, _ = lm2025.indices(np.concatenate(ref_px))
    calibration = {
        'greenPixels': int(len(g_exg)), 'referencePixels': int(len(r_exg)),
        'greenExcessGreenPercentiles': [round(float(np.percentile(g_exg, q)), 1) for q in (10, 50, 90)],
        'referenceExcessGreenPercentiles': [round(float(np.percentile(r_exg, q)), 1) for q in (10, 50, 90)],
        'greenLuminancePercentiles': [round(float(np.percentile(g_lum, q)), 1) for q in (10, 50, 90)],
        'referenceLuminancePercentiles': [round(float(np.percentile(r_lum, q)), 1) for q in (10, 50, 90)],
        'excessGreenSeparation': round(float(np.percentile(g_exg, 10) - np.percentile(r_exg, 90)), 2),
        'note': ('a NEGATIVE separation means the two distributions overlap and no colour threshold exists; '
                 'the reference is the ground 25-40 m out, which on this course is approach, semi and rough'),
    }

    methods = ['colourgrow', 'firststep', 'largeststep', 'roughness', 'fusion']
    results = {m: [] for m in methods}
    per_hole = []
    for hole in sorted(survey):
        centre = survey[hole]['Green Center']
        EE, NN, lum, exg, rough = field(centre)
        row = {'hole': hole, 'methods': {}}
        # the two region growers, each over a ladder of cuts; the largest
        # region that stays COMPACT is the one that has not leaked
        smooth_exg = nd.uniform_filter(exg, size=int(round(1.5 / STEP)))
        smooth_rough = nd.uniform_filter(rough, size=int(round(2.0 / STEP)))
        fusion = ((smooth_exg - smooth_exg.mean()) / (smooth_exg.std() + 1e-6)
                  - (smooth_rough - smooth_rough.mean()) / (smooth_rough.std() + 1e-6))
        growers = {'colourgrow': (smooth_exg, np.percentile(smooth_exg, np.arange(95, 40, -5)), 1),
                   'roughness': (smooth_rough, np.percentile(smooth_rough, np.arange(5, 60, 5)), -1),
                   'fusion': (fusion, np.percentile(fusion, np.arange(95, 40, -5)), 1)}
        for name, (sig, cuts, sign) in growers.items():
            best = None
            for cut in cuts:
                comp = grow(EE, NN, (sig >= cut) if sign > 0 else (sig <= cut), centre)
                if comp is None:
                    continue
                area, compact = stats(comp)
                if MIN_AREA <= area <= MAX_AREA and compact >= MIN_COMPACTNESS and (best is None or area > best[0]):
                    best = (area, comp)
            if best:
                ring = lm2025.trace_outline(best[1], EE[0, :], NN[:, 0], thin_metres=0.6)
                if ring:
                    row['methods'][name] = {'ring': ring, 'areaSquareMetres': round(ring_area(ring), 1)}
        for name, mode in (('firststep', 'firststep'), ('largeststep', 'largeststep')):
            ring, _ = polar(centre, lambda E, N: lm2025.indices(lm2025.sample(E, N))[1], mode)
            row['methods'][name] = {'ring': ring, 'areaSquareMetres': round(ring_area(ring), 1)}
        for name, got in row['methods'].items():
            if hole in osm:
                got['iouAgainstOsmRing'] = round(iou(got['ring'], osm[hole]), 3)
                got['areaRatioAgainstOsmRing'] = round(got['areaSquareMetres'] / ring_area(osm[hole]), 3)
                results[name].append(got['iouAgainstOsmRing'])
        per_hole.append(row)
        got = {m: row['methods'].get(m, {}).get('iouAgainstOsmRing') for m in methods}
        print(f"hole {hole:2}  " + '  '.join(f"{m}={'-' if got[m] is None else f'{got[m]:.2f}'}" for m in methods))

    scores = {}
    for m in methods:
        v = results[m]
        grew = sum(m in r['methods'] for r in per_hole)
        scores[m] = {'scoredAgainst': len(v), 'grewOnHoles': grew,
                     'medianIou': round(float(np.median(v)), 3) if v else None,
                     'minIou': round(float(min(v)), 3) if v else None,
                     'maxIou': round(float(max(v)), 3) if v else None,
                     'medianAreaRatio': round(float(np.median([r['methods'][m]['areaRatioAgainstOsmRing']
                                                               for r in per_hole
                                                               if m in r['methods'] and 'areaRatioAgainstOsmRing' in r['methods'][m]])), 3) if v else None}
    best = max(methods, key=lambda m: (scores[m]['medianIou'] or 0))
    verdict = {
        'bestMethod': best, 'bestMedianIou': scores[best]['medianIou'], 'bestGrewOnHoles': scores[best]['grewOnHoles'],
        'bar': (f'median IoU >= {ADOPT_MEDIAN_IOU} against the OSM rings AND a region on at least {ADOPT_HOLES} of 18 '
                "holes; Veckefjarden's best of six tracers reached 0.65 and was refused, so a method at or under "
                'that is one this repository has already decided against'),
        'adopt': bool((scores[best]['medianIou'] or 0) >= ADOPT_MEDIAN_IOU and scores[best]['grewOnHoles'] >= ADOPT_HOLES),
    }
    print()
    for m in methods:
        s = scores[m]
        print(f"{m:12} grew {s['grewOnHoles']:2}/18  scored {s['scoredAgainst']:2}  median IoU "
              f"{s['medianIou']}  area ratio {s['medianAreaRatio']}")
    print(json.dumps(verdict))

    report = {'schemaVersion': 1, 'measuredOn': '2026-09-08', 'state': 'measurement-evidence-only',
              'generator': 'lidingobuild/mapping/trace-2025-greens.py',
              'sourceCapture': {'id': lm2025.CAPTURE, 'captureDate': lm2025.IMAGE_CAPTURE,
                                'sha256': lm2025.META['sha256'], 'licence': lm2025.META['licence']['id'],
                                'attribution': lm2025.META['licence']['attribution']},
              'horizontalCrs': 'EPSG:3006', 'analysisStepMetres': STEP,
              'scoredAgainst': 'the OSM green rings that carry a hole; they never entered any rule here',
              'calibration': calibration, 'scores': scores, 'verdict': verdict,
              'holes': [{'hole': r['hole'],
                         'methods': {m: {k: v for k, v in got.items() if k != 'ring'}
                                     for m, got in r['methods'].items()}} for r in per_hole]}
    if write:
        out = ROOT / 'lidingobuild/mapping/green-trace-2025.json'
        out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
        print('wrote', out.relative_to(ROOT))
    return report, per_hole


if __name__ == '__main__':
    main('--write' in sys.argv)
