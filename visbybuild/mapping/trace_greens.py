"""Re-trace Visby's putting surfaces from orthophoto, anchored on the GPS survey.

WHY THIS IS WORTH TRYING HERE when Veckefjarden recorded that greens could not
be traced at all. Two things are different. Veckefjarden had 0.27 m autumn Esri
imagery and no per-hole survey, and colour did not separate a green from its
fairway. Visby has a GolfTraxx GPS centre for every hole -- an independent
record that never entered this model -- and two orthophotos, and the separation
is MEASURED rather than hoped for:

                     excess green (2g-r-b), median across six holes
    frame            green    collar   rough
    2026-04 0.16 m    28.0     22.5     11.0     <- finest, but April flattens the mow
    2022 summer 0.25  30.5     19.5      5.0     <- leaf-on and mown: green/collar gap 11

So the summer frame is the instrument for separating a putting surface from its
collar, and the April one for resolution. This grows on the summer frame.

The tracer SCORES ITSELF against something it never used: the model's existing
rings, traced independently off the 0.5 m municipal image. Fifteen of the
eighteen are corroborated by the survey to a median 2.09 m, so reproducing
those fifteen is the test of the method, and only then is hole 9's answer worth
anything.

    python3 visbybuild/mapping/trace_greens.py [--out FILE] [--holes 1,2,9]
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from ortho_read import window, to_pixel, to_local  # noqa: E402

LAYER = 'gotland'
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
MODEL = json.load(open(os.path.join(ROOT, 'visbybuild/course-model.json')))
SURVEY = json.load(open(os.path.join(ROOT, 'geo_data/visby_clean.json')))

FRAME_E, FRAME_N = 687748.5, 6370951.5
A = 6378137.0
F = 1 / 298.257222101
E2 = 2 * F - F * F
K0, LON0, FE = 0.9996, np.radians(15.0), 500000.0


def sweref(lat, lon):
    """WGS84 to EPSG:3006, Snyder's transverse Mercator on GRS 80 -- the same
    series packages/course-geo/chmv2/projection.mjs uses."""
    phi, lam = np.radians(lat), np.radians(lon)
    ep2 = E2 / (1 - E2)
    n = A / np.sqrt(1 - E2 * np.sin(phi) ** 2)
    t = np.tan(phi) ** 2
    c = ep2 * np.cos(phi) ** 2
    a_ = (lam - LON0) * np.cos(phi)
    e4, e6 = E2 * E2, E2 * E2 * E2
    m = A * ((1 - E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
             - (3 * E2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * np.sin(2 * phi)
             + (15 * e4 / 256 + 45 * e6 / 1024) * np.sin(4 * phi)
             - (35 * e6 / 3072) * np.sin(6 * phi))
    east = FE + K0 * n * (a_ + (1 - t + c) * a_ ** 3 / 6
                          + (5 - 18 * t + t * t + 72 * c - 58 * ep2) * a_ ** 5 / 120)
    north = K0 * (m + n * np.tan(phi) * (a_ ** 2 / 2 + (5 - t + 9 * c + 4 * c * c) * a_ ** 4 / 24
                                         + (61 - 58 * t + t * t + 600 * c - 330 * ep2) * a_ ** 6 / 720))
    return east, north


def survey_centres():
    out = {}
    for feature in SURVEY['features']:
        if feature['properties']['name'] != 'Green Center':
            continue
        lon, lat = feature['geometry']['coordinates']
        e, n = sweref(lat, lon)
        out[int(feature['properties']['hole'])] = (e - FRAME_E, FRAME_N - n)
    return out


def poly_mask(rows, cols, aff, ring):
    pts = [to_pixel(aff, x, z) for x, z in ring]
    mask = np.zeros((rows, cols), dtype=bool)
    for yi in range(rows):
        y = yi + 0.5
        xs = []
        for i in range(len(pts)):
            (x1, y1), (x2, y2) = pts[i], pts[(i + 1) % len(pts)]
            if (y1 > y) != (y2 > y):
                xs.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
        xs.sort()
        for a_, b_ in zip(xs[0::2], xs[1::2]):
            lo, hi = max(0, int(np.ceil(a_ - 0.5))), min(cols - 1, int(np.floor(b_ - 0.5)))
            if hi >= lo:
                mask[yi, lo:hi + 1] = True
    return mask


def grow(exg, seed, threshold):
    """Flood the connected component of `exg >= threshold` containing the seed."""
    rows, cols = exg.shape
    ok = exg >= threshold
    sy, sx = seed
    if not (0 <= sy < rows and 0 <= sx < cols) or not ok[sy, sx]:
        # nudge to the best nearby pixel rather than give up on a seed that
        # lands on a hole cup, a rake mark or a shadow
        r = 12
        ys, xs = np.mgrid[max(0, sy - r):min(rows, sy + r + 1), max(0, sx - r):min(cols, sx + r + 1)]
        sub = ok[max(0, sy - r):min(rows, sy + r + 1), max(0, sx - r):min(cols, sx + r + 1)]
        if not sub.any():
            return np.zeros_like(ok)
        d = (ys - sy) ** 2 + (xs - sx) ** 2
        d = np.where(sub, d, 1 << 30)
        i = np.unravel_index(np.argmin(d), d.shape)
        sy, sx = int(ys[i]), int(xs[i])
    out = np.zeros_like(ok)
    stack = [(sy, sx)]
    out[sy, sx] = True
    while stack:
        y, x = stack.pop()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < rows and 0 <= nx < cols and ok[ny, nx] and not out[ny, nx]:
                out[ny, nx] = True
                stack.append((ny, nx))
    return out


def contour(mask, aff, step=3):
    """A closed ring in local metres around the mask, walked on its bounding
    hull at `step` pixel resolution. Coarse on purpose: a putting-surface edge
    is a mown transition a metre wide, not a pixel."""
    ys, xs = np.nonzero(mask)
    cy, cx = ys.mean(), xs.mean()
    ring = []
    for k in range(72):
        a = 2 * np.pi * k / 72
        dy, dx = np.sin(a), np.cos(a)
        best = 0.0
        t = 0.0
        while t < 400:
            y, x = int(round(cy + dy * t)), int(round(cx + dx * t))
            if not (0 <= y < mask.shape[0] and 0 <= x < mask.shape[1]) or not mask[y, x]:
                break
            best = t
            t += step
        ring.append(to_local(aff, cx + dx * best, cy + dy * best))
    return [[round(x, 2), round(z, 2)] for x, z in ring]


def ring_area(ring):
    a = 0.0
    for i in range(len(ring)):
        x1, z1 = ring[i]
        x2, z2 = ring[(i + 1) % len(ring)]
        a += x1 * z2 - x2 * z1
    return abs(a / 2)


def main():
    global LAYER
    argv = sys.argv[1:]
    if '--layer' in argv: LAYER = argv[argv.index('--layer') + 1]
    out_path = argv[argv.index('--out') + 1] if '--out' in argv else None
    only = None
    if '--holes' in argv:
        only = {int(v) for v in argv[argv.index('--holes') + 1].split(',')}
    centres = survey_centres()
    thresholds = [22, 24, 26, 28, 30]
    records = []
    for hole in MODEL['holes']:
        n = hole['n']
        if only and n not in only:
            continue
        seed_xz = centres[n]
        px, aff = window(seed_xz[0], seed_xz[1], 140, layer=LAYER)
        v = px.astype(np.float32)
        exg = 2 * v[:, :, 1] - v[:, :, 0] - v[:, :, 2]
        sx, sy = to_pixel(aff, *seed_xz)
        existing = poly_mask(exg.shape[0], exg.shape[1], aff, hole['green']['ring'])
        cell = aff['metres'] ** 2
        best = None
        for t in thresholds:
            m = grow(exg, (int(round(sy)), int(round(sx))), t)
            area = m.sum() * cell
            if area < 150 or area > 1400:
                continue
            ys, xs = np.nonzero(m)
            if len(ys) == 0:
                continue
            span = max(np.ptp(ys), np.ptp(xs)) * aff["metres"]
            compact = area / (np.pi * (span / 2) ** 2)      # 1.0 is a disc
            inter = (m & existing).sum() * cell
            union = (m | existing).sum() * cell
            row = dict(threshold=t, areaSquareMetres=round(area), spanMetres=round(span, 1),
                       compactness=round(float(compact), 3),
                       iouAgainstExistingRing=round(inter / union, 3) if union else 0.0)
            if compact < 0.35:
                row['refused'] = 'not compact enough for a putting surface'
                records.append(dict(hole=n, **row))
                continue
            if best is None or area > best['area']:
                best = dict(area=area, mask=m, row=row)
            records.append(dict(hole=n, **row))
        if best is None:
            print(f'hole {n:2d}: refused at every threshold')
            continue
        ring = contour(best['mask'], aff)
        cxz = (float(np.mean([p[0] for p in ring])), float(np.mean([p[1] for p in ring])))
        d_model = float(np.hypot(cxz[0] - hole['green']['c'][0], cxz[1] - hole['green']['c'][1]))
        d_survey = float(np.hypot(cxz[0] - seed_xz[0], cxz[1] - seed_xz[1]))
        print(f"hole {n:2d}: t={best['row']['threshold']:>2}  area {best['row']['areaSquareMetres']:>5} m2 "
              f"(model {round(ring_area(hole['green']['ring'])):>5})  IoU {best['row']['iouAgainstExistingRing']:.2f}  "
              f"centre vs model {d_model:5.1f} m  vs survey {d_survey:4.1f} m")
        records.append(dict(hole=n, accepted=True, ring=ring, **best['row'],
                            centreLocal=[round(cxz[0], 2), round(cxz[1], 2)],
                            centreVersusModelMetres=round(d_model, 2),
                            centreVersusSurveyMetres=round(d_survey, 2),
                            modelRingAreaSquareMetres=round(ring_area(hole['green']['ring']))))
    if out_path:
        json.dump(records, open(out_path, 'w'), indent=2)
        print(f'wrote {out_path}')


if __name__ == '__main__':
    main()
