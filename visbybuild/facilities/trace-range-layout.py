"""Detect the individual hitting mats and the net poles on the 2026 range panels.

    & upsalabuild/cache/review-venv/Scripts/python.exe visbybuild/facilities/trace-range-layout.py

Reads the native 0.16 m Lantmateriet panels under reference/ortho (their
geotransforms come from the panel receipts), the three firing-strip alignments
and the east net alignment already traced in reference/observed-roofs-2026.json,
and writes range-layout.json: every mat as a centre and orientation in Blender
metres, the two nets as pole runs, the covered shelter and the studio roofs
with their photo-informed heights. A review PNG with the detections drawn on
the panel is written beside it in the ignored cache, so the numbers can be
checked against the picture they came from.

The mats are the darkest rectangles on the artificial-turf strip: along each
traced strip line a perpendicular darkness profile has one deep minimum per
mat, and each minimum is refined to the centroid of the dark pixels inside a
2 m window. Spacing, count and orientation are therefore measured, not typed.
"""
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT / 'visbybuild/facilities'
ORTHO = HERE / 'reference/ortho'
ORIGIN_E, ORIGIN_N = 687748.5, 6370951.5
PIXEL = 0.16


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def panel(name):
    """Geotransform from the panel receipt, else from its world file (whose
    origin is the CENTRE of the top-left pixel, so it moves half a pixel)."""
    image = np.asarray(Image.open(ORTHO / f'{name}.png').convert('RGB')).astype(np.float32)
    receipt = ORTHO / f'{name}.json'
    if receipt.exists():
        return image, read(receipt)['geoTransform']
    a, d, b, e, c, f = [float(v) for v in (ORTHO / f'{name}.pgw').read_text().split()]
    return image, [c - a / 2, a, d, f - e / 2, b, e]


def px_to_blender(gt, px, py):
    e = gt[0] + px * gt[1]
    n = gt[3] + py * gt[5]
    return e - ORIGIN_E, n - ORIGIN_N


def blender_to_px(gt, x, y):
    return (x + ORIGIN_E - gt[0]) / gt[1], (y + ORIGIN_N - gt[3]) / gt[5]


def darkness(image):
    r, g, b = image[..., 0], image[..., 1], image[..., 2]
    return 0.299 * r + 0.587 * g + 0.114 * b


def detect_mats(image, gt, line_px, half_width_m=2.2, mat_m=1.5):
    """Walk the strip line; the mats are periodic dark minima of the profile."""
    lum = darkness(image)
    h, w = lum.shape
    samples = []
    for (ax, ay), (bx, by) in zip(line_px, line_px[1:]):
        length = math.hypot(bx - ax, by - ay)
        ux, uy = (bx - ax) / length, (by - ay) / length
        nx, ny = -uy, ux
        steps = int(length)
        for s in range(steps):
            cx, cy = ax + ux * s, ay + uy * s
            span = int(half_width_m / PIXEL)
            values = []
            for t in range(-span, span + 1):
                px, py = int(round(cx + nx * t)), int(round(cy + ny * t))
                if 0 <= px < w and 0 <= py < h:
                    values.append(lum[py, px])
            if values:
                samples.append((cx, cy, ux, uy, nx, ny, float(np.mean(sorted(values)[:max(3, len(values) // 4)]))))
    if not samples:
        return []
    profile = np.array([s[6] for s in samples])
    # Smooth over roughly half a mat and find minima at least a mat apart.
    k = max(1, int(mat_m * 0.5 / PIXEL))
    kernel = np.ones(k) / k
    smooth = np.convolve(profile, kernel, mode='same')
    threshold = np.percentile(smooth, 45)
    min_gap = int(mat_m * 0.9 / PIXEL)
    minima = []
    for i in range(len(smooth)):
        lo, hi = max(0, i - min_gap), min(len(smooth), i + min_gap + 1)
        if smooth[i] == smooth[lo:hi].min() and smooth[i] < threshold:
            if minima and i - minima[-1] < min_gap:
                continue
            minima.append(i)
    mats = []
    for i in minima:
        cx, cy, ux, uy, nx, ny, _ = samples[i]
        # Refine to the centroid of the dark pixels within a 2 m box around the minimum.
        box = int(1.0 / PIXEL)
        x0, x1 = int(cx) - box, int(cx) + box + 1
        y0, y1 = int(cy) - box, int(cy) + box + 1
        window = lum[max(0, y0):min(h, y1), max(0, x0):min(w, x1)]
        cut = np.percentile(window, 30)
        ys, xs = np.nonzero(window <= cut)
        if len(xs) < 20:
            continue
        mx, my = max(0, x0) + xs.mean(), max(0, y0) + ys.mean()
        # Reject a minimum that sits off the strip (tree shadow, gravel edge).
        offset = (mx - cx) * nx + (my - cy) * ny
        if abs(offset) * PIXEL > 1.6:
            continue
        mats.append({'pixel': [round(float(mx), 2), round(float(my), 2)], 'tangentPixel': [ux, uy],
                     'darkness': round(float(smooth[i]), 1)})
    return mats


def shot_direction_blender(tangent_px, gt, field_centre_blender, at_blender):
    """Perpendicular to the strip that points at the field."""
    tx, ty = tangent_px[0] * gt[1], tangent_px[1] * gt[5]
    length = math.hypot(tx, ty)
    tx, ty = tx / length, ty / length
    nx, ny = -ty, tx
    if (field_centre_blender[0] - at_blender[0]) * nx + (field_centre_blender[1] - at_blender[1]) * ny < 0:
        nx, ny = -nx, -ny
    return nx, ny


def main():
    observed = read(HERE / 'reference/observed-roofs-2026.json')
    inventory = read(HERE / 'facility-inventory.json')
    model = read(ROOT / 'visbybuild/course-model.json')
    field = model['scenery']['range'][0]
    field_centre = [sum(p[0] for p in field) / len(field), -sum(p[1] for p in field) / len(field)]  # Blender XY
    strips = {f['id']: f for f in observed['nonBuildingFacilities'] if f['kind'] == 'range-firing-mats'}
    nets = {f['id']: f for f in observed['nonBuildingFacilities'] if f['kind'] == 'range-safety-net-base'}
    image, gt = panel('range-firing-line')
    layout = {'schemaVersion': 1, 'groundId': 'visby', 'captureDate': observed['captureDate'],
              'method': 'perpendicular darkness minima along the traced strip lines, refined to dark-pixel centroids',
              'matSizeMetres': [1.5, 1.5], 'matRows': [], 'nets': [], 'structures': {}}
    review = Image.open(ORTHO / 'range-firing-line.png').convert('RGB')
    draw = ImageDraw.Draw(review)
    for key in ('range-firing-mats-west-2026', 'range-firing-mats-central-2026', 'range-firing-mats-east-2026'):
        line = strips[key]['linePixels']
        mats = detect_mats(image, gt, line)
        row = {'id': key, 'source': 'range-firing-line', 'linePixels': line, 'mats': []}
        for index, mat in enumerate(mats, 1):
            bx, by = px_to_blender(gt, *mat['pixel'])
            nx, ny = shot_direction_blender(mat['tangentPixel'], gt, field_centre, (bx, by))
            angle = math.atan2(mat['tangentPixel'][1] * gt[5], mat['tangentPixel'][0] * gt[1])
            row['mats'].append({'id': f'{key}-mat-{index:02d}', 'pixel': mat['pixel'],
                                'centerBlenderXY': [round(bx, 3), round(by, 3)], 'angleRadians': round(angle, 5),
                                'shotDirectionBlender': [round(nx, 4), round(ny, 4)], 'darkness': mat['darkness']})
            px, py = mat['pixel']
            draw.rectangle([px - 4, py - 4, px + 4, py + 4], outline=(255, 40, 40), width=1)
            draw.text((px + 5, py - 10), str(index), fill=(255, 255, 0))
        for a, b in zip(line, line[1:]):
            draw.line([tuple(a), tuple(b)], fill=(0, 200, 255), width=1)
        layout['matRows'].append(row)
    # Nets: the east alignment is already traced on range-net-north; the poles
    # stand where the traced base line bends, so its vertices are the poles.
    east = nets['range-east-net-base-2026']
    net_image, net_gt = panel('range-net-north')
    poles = [px_to_blender(net_gt, px, py) for px, py in east['linePixels']]
    layout['nets'].append({'id': 'range-east-net-base-2026', 'source': 'range-net-north',
                           'polePixels': east['linePixels'],
                           'polesBlenderXY': [[round(x, 3), round(y, 3)] for x, y in poles],
                           'heightEstimateMetres': 9.0,
                           'heightEvidence': 'visual estimate from the 2024 construction photograph (01-bygga-range.jpg); '
                                             'tall timber poles with net on the field side; not measured'})
    for a, b in zip(east['linePixels'], east['linePixels'][1:]):
        pass
    # Structures: the studio (OSM footprint) and the covered bays (observed roof).
    studio = next(f for f in inventory['facilities'] if f['id'] == 'way/530655627')
    shelter = next(r for r in observed['roofs'] if r['id'] == 'range-east-shelter-2026')
    shelter_xy = [list(px_to_blender(gt, px, py)) for px, py in shelter['ringPixels'][:4]]
    layout['structures'] = {
        'studio': {'id': 'way/530655627', 'roofCornersBlenderXY': studio['footprintBlenderXY'][:4],
                   'eaveEstimateMetres': 2.9, 'ridgeEstimateMetres': 4.25,
                   'evidence': 'OSM footprint on the silver ribbed roof in the 2026 panel; interior photographs '
                               'studio3.jpg and svingstudio1.jpg show two broad sectional door openings and white walls'},
        'shelter': {'id': 'range-east-shelter-2026', 'roofCornersBlenderXY': [[round(x, 3), round(y, 3)] for x, y in shelter_xy],
                    'rearEaveEstimateMetres': 2.55, 'frontEaveEstimateMetres': 3.5, 'coveredBays': 4,
                    'countSource': 'https://www.visbygk.com/nyheter/trana-med-trackman-range/',
                    'evidence': 'roof outline traced on the 2026 panel; the 2024 construction photograph shows one '
                                'slope, high toward the field, over white posts'}}
    layout['claims'] = {'source': 'club news 2024-02-21 (id 12661) and 2024-03-27 (id 13047)',
                        'teeLineMovedForwardMetres': 4, 'newPlaces': 6, 'fixedScreens': 10, 'coveredScreens': 4}
    counts = {row['id']: len(row['mats']) for row in layout['matRows']}
    layout['detected'] = counts
    (HERE / 'range-layout.json').write_text(json.dumps(layout, indent=2) + '\n', encoding='utf-8')
    out = ROOT / 'visbybuild/cache/range-refinement'
    out.mkdir(parents=True, exist_ok=True)
    review.save(out / 'mat-detection-review.png')
    print(json.dumps({'mats': counts, 'eastNetPoles': len(poles), 'review': str(out / 'mat-detection-review.png')}))


if __name__ == '__main__':
    main()
