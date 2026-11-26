#!/usr/bin/env python3
"""Find where a course guide's hole plates lie on the orthophoto, and read their tee and flag marks in EPSG:3006.

    pixi run --manifest-path packages/course-geo/toolchain/pixi.toml -e mapping --frozen python \
      packages/course-geo/mapping/register-guide-plates.py --config <build>/mapping/trace-config.json \
        --plates '<build>/cache/club-sources/golfisverige-h{hole:02d}-diagram.webp' [--holes 1-18] \
        --out <build>/mapping/guide-plates.json

A guide plate (golfisverige.com's "banguide") is a crop of an aerial photograph, turned so the hole runs up the
page, with the hole drawn on it: a yellow dot on the yellow tee and a red flag on the green. Where no club map gives
the routing, the plates are the best evidence of which deck and which green a hole plays. They are drawings: they
name things and give their order, and never place them (docs/pipeline-v2.md). So this finds each plate's own
photograph on the orthophoto, by masked normalised cross-correlation of locally normalised brightness over rotation
and scale (at 4 m, then at 1 m round the best), and reads the two marks through that fit. The record says where
each plate puts its tee and its flag, with the fit's score; a reviewer compares them with the decisions, and the
decisions stay the measurement. Nothing here writes an outline.

The layout (what is drawing, where the marks are) is golfisverige.com's 1600 x 2000 plate: the tee dot is the one
saturated yellow disc outside the left legend, the flag the red triangle on its stick. A plate of another layout
needs its own LAYOUT and marks.
"""
import argparse
import json
import os
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as nd

from photo_views import ROOT, Imagery, load_json

LAYOUT = dict(
    boxes=[(0, 0, 430, 1010),        # hole number, par, index, the tees' lengths
           (40, 1560, 420, 1960),    # compass
           (640, 1900, 960, 2000)],  # site label
    circles=[(1300, 300, 250),       # the green's inset, at another scale
             (1360, 1760, 215)],     # legend
)
NORMALISE_METRES = 24.0   # local brightness is normalised over this, on the plate and on the photo alike
COARSE, FINE = 4.0, 1.0


def drawing_free(shape):
    h, w = shape
    yy, xx = np.mgrid[:h, :w]
    free = np.ones((h, w), bool)
    for x0, y0, x1, y1 in LAYOUT['boxes']:
        free &= ~((xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1))
    for cx, cy, rad in LAYOUT['circles']:
        free &= (xx - cx) ** 2 + (yy - cy) ** 2 > rad ** 2
    return free, xx, yy


def plate_mask(rgb):
    """True where the plate shows its photograph: not the layout, a drawn line, a label or the white fade."""
    r, g, b = (rgb[..., i].astype(np.float32) for i in range(3))
    mx, mn = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b)
    sat = (mx - mn) / (mx + 1)
    keep, xx, yy = drawing_free(r.shape)
    keep &= ~((mx > 200) & (sat < 0.22))                        # white lines and the vignette
    keep &= ~((r > 170) & (g > 120) & (b < 90) & (sat > 0.45))  # yellow dashes and labels
    keep &= ~((r > 170) & (g < 90) & (b < 90))                  # red dots and the flag
    h, w = r.shape
    keep &= np.minimum.reduce([xx, yy, w - 1 - xx, h - 1 - yy]) > 60
    return nd.binary_erosion(keep, iterations=6)


def marks(rgb):
    """The tee dot's centre and the flagstick's foot, in plate pixels (x, y); None where a mark is not found."""
    r, g, b = (rgb[..., i].astype(np.float32) for i in range(3))
    free, _, _ = drawing_free(r.shape)
    tee = None
    yellow = (r > 220) & (g > 150) & (g < 215) & (b < 70) & free
    lab, n = nd.label(yellow)
    if n:
        sizes = nd.sum(yellow, lab, range(1, n + 1))
        k = int(np.argmax(sizes)) + 1
        if sizes[k - 1] > 150:
            ys, xs = np.nonzero(lab == k)
            tee = (float(xs.mean()), float(ys.mean()))
    flag = None
    red = (r > 200) & (g < 90) & (b < 90) & free
    lab, n = nd.label(red)
    best, score = None, 0.0
    for i, sl in enumerate(nd.find_objects(lab) if n else [], 1):
        m = lab[sl] == i
        area = float(m.sum())
        if area < 80:
            continue
        s = area * (1.2 - area / m.size)   # a triangle fills half its box, the round lay-up dot 0.79
        if s > score:
            best, score = (sl, m), s
    if best is not None:
        sl, m = best
        ys, xs = np.nonzero(m)
        x_stick = sl[1].start + int(xs.min())
        top = sl[0].start + int(ys.min())
        foot = top
        # The stick is white and runs down from the flag's left corner; its foot is its lowest white pixel.
        for yi in range(top, min(rgb.shape[0], top + 200)):
            px = rgb[yi, max(0, x_stick - 5):x_stick + 3].astype(np.float32)
            if (px.min(axis=1) > 195).any():
                foot = yi
            elif yi > top + 40:
                break
        flag = (float(x_stick), float(foot))
    return tee, flag


def masked_normalise(g, m, sigma):
    w = nd.gaussian_filter(m.astype(np.float32), sigma) + 1e-6
    mu = nd.gaussian_filter(g * m, sigma) / w
    var = nd.gaussian_filter((g - mu) ** 2 * m, sigma) / w
    return np.where(m, (g - mu) / np.sqrt(np.maximum(var, 1e-3)), 0.0)


def zoomed(gray, mask, scale, res):
    """The plate at `res` metres a pixel: smoothed before it is thinned, then normalised like the photo."""
    f = scale / res
    sig = max(0.0, 0.45 / f)
    g = nd.zoom(nd.gaussian_filter(gray, sig) if sig > 0.3 else gray, f, order=1)
    m = nd.zoom(mask.astype(np.float32), f, order=1) > 0.75
    return masked_normalise(g, m, NORMALISE_METRES / res), m


def turned(g, m, theta):
    gt = nd.rotate(g, theta, reshape=True, order=1, cval=0.0)
    mt = nd.rotate(m.astype(np.float32), theta, reshape=True, order=1, cval=0.0) > 0.75
    return np.where(mt, gt, 0.0), mt


class Reference:
    def __init__(self, imagery, box, res):
        self.box, self.res = box, res
        img, have = imagery.read(*box, res)
        g = img[:3].astype(np.float32).mean(axis=0)
        self.img = masked_normalise(g, have, NORMALISE_METRES / res)
        self.have = have

    def search(self, tpl, m):
        """Best placement of a masked template: (score, row, col) of its top-left corner."""
        h, w = self.img.shape
        th, tw = tpl.shape
        if th >= h or tw >= w or m.sum() < 300:
            return None
        H, W = h + th, w + tw
        t = np.where(m, tpl - tpl[m].mean(), 0.0)
        ft = np.fft.rfft2(t[::-1, ::-1], s=(H, W))
        fm = np.fft.rfft2(m[::-1, ::-1].astype(np.float64), s=(H, W))
        fi = np.fft.rfft2(self.img, s=(H, W))
        fi2 = np.fft.rfft2(self.img ** 2, s=(H, W))
        num = np.fft.irfft2(fi * ft, s=(H, W))
        s1 = np.fft.irfft2(fi * fm, s=(H, W))
        s2 = np.fft.irfft2(fi2 * fm, s=(H, W))
        n = float(m.sum())
        ncc = num / np.sqrt(np.maximum(s2 - s1 ** 2 / n, 1e-3) * float((t ** 2).sum()))
        valid = ncc[th - 1:h, tw - 1:w]
        i = np.unravel_index(int(np.argmax(valid)), valid.shape)
        return float(valid[i]), int(i[0]), int(i[1])


def mark_world(point, plate_shape, scale, theta, res, corner):
    """A plate pixel through the same zoom and turn as the template, so no rotation convention is assumed."""
    if point is None:
        return None
    hot = np.zeros(plate_shape, np.float32)
    x, y = int(round(point[0])), int(round(point[1]))
    hot[max(0, y - 6):y + 7, max(0, x - 6):x + 7] = 1.0
    f = scale / res
    z = nd.zoom(nd.gaussian_filter(hot, 3), f, order=1)
    z = nd.rotate(z, theta, reshape=True, order=1, cval=0.0)
    r, c = nd.center_of_mass(z)
    e0, n1 = corner
    return [round(float(e0 + (c + 0.5) * res), 1), round(float(n1 - (r + 0.5) * res), 1)]


def register(job):
    rgb = np.asarray(Image.open(job['plate']).convert('RGB'))
    gray = rgb.astype(np.float32).mean(axis=2)
    mask = plate_mask(rgb)
    tee, flag = marks(rgb)
    imagery = Imagery([ROOT / p for p in job['rasters']])
    # The plate's own scale: its drawn line from tee to flag is the card's length, and never shorter than the
    # straight line between them; a dogleg makes it up to about a third longer. Left free, a small plate finds a
    # high chance peak (0.065 m/px on a 346 m hole).
    coarse = COARSE
    if tee and flag and job.get('cardMetres'):
        straight = float(np.hypot(tee[0] - flag[0], tee[1] - flag[1]))
        top = job['cardMetres'] / straight
        scales = np.geomspace(0.72 * top, 1.03 * top, 12)
        # A short hole's plate covers a small ground: at 4 m it is too few pixels to place (a par 3's is about 40
        # across), so the first pass is finer.
        coarse = float(np.clip(top * rgb.shape[1] / 90.0, 1.5, COARSE))
    else:
        scales = np.geomspace(0.07, 0.6, 38)
    ref = Reference(imagery, job['box'], coarse)
    best = None
    for scale in scales:
        g, m = zoomed(gray, mask, scale, coarse)
        for theta in np.arange(0.0, 360.0, 4.0):
            found = ref.search(*turned(g, m, theta))
            if found and (best is None or found[0] > best[0]):
                best = (found[0], float(scale), float(theta), found[1], found[2])
    coarse_score, scale, theta, row, col = best
    g, m = turned(*zoomed(gray, mask, scale, coarse), theta)
    e0, n1 = ref.box[0] + col * coarse, ref.box[3] - row * coarse
    pad = 50.0
    fbox = (e0 - pad, n1 - g.shape[0] * coarse - pad, e0 + g.shape[1] * coarse + pad, n1 + pad)
    fine = Reference(imagery, fbox, FINE)
    fbest = None
    for s in scale * np.geomspace(0.93, 1.07, 15):
        gz, mz = zoomed(gray, mask, s, FINE)
        for th in theta + np.arange(-4.0, 4.01, 0.5):
            found = fine.search(*turned(gz, mz, th))
            if found and (fbest is None or found[0] > fbest[0]):
                fbest = (found[0], float(s), float(th), found[1], found[2])
    score, s, th, row, col = fbest
    corner = (fbox[0] + col * FINE, fbox[3] - row * FINE)
    return dict(hole=job['hole'], plate=Path(job['plate']).as_posix(), score=round(score, 3), coarseScore=round(coarse_score, 3),
                metresPerPixel=round(s, 4), turnDegrees=round(th % 360, 1),
                tee=mark_world(tee, gray.shape, s, th, FINE, corner), flag=mark_world(flag, gray.shape, s, th, FINE, corner),
                teePixel=tee and [round(v, 1) for v in tee], flagPixel=flag and [round(v, 1) for v in flag])


def holes_arg(text):
    out = []
    for part in text.split(','):
        a, _, b = part.partition('-')
        out += list(range(int(a), int(b or a) + 1))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--config', type=Path, required=True)
    ap.add_argument('--plates', required=True, help="a path with {hole} in it, e.g. '<dir>/h{hole:02d}.webp'")
    ap.add_argument('--holes', default='1-18')
    ap.add_argument('--margin', type=float, default=250.0, help='metres of photo searched round the box')
    ap.add_argument('--workers', type=int, default=max(1, (os.cpu_count() or 2) - 2))
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()
    cfg = load_json(args.config)
    e0, n0, e1, n1 = cfg['box']
    box = (e0 - args.margin, n0 - args.margin, e1 + args.margin, n1 + args.margin)
    card = load_json(cfg['courses'][0]['card']) if len(cfg['courses']) == 1 else None
    first_tee = card['tees'][0]['id'] if card else None
    length = {h['number']: h['lengths'][first_tee] for h in card['holes']} if card else {}
    jobs = [dict(hole=h, plate=args.plates.format(hole=h), box=box, rasters=cfg['imagery']['rasters'], cardMetres=length.get(h))
            for h in holes_arg(args.holes)]
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        rows = sorted(pool.map(register, jobs), key=lambda r: r['hole'])
    inside = lambda p: p is not None and e0 <= p[0] <= e1 and n0 <= p[1] <= n1
    for r in rows:
        # A fit whose marks leave the course is a chance peak, whatever its score: a short hole's plate shows little
        # but turf, and turf matches turf anywhere. Its marks are kept for the record and must not be used.
        r['accepted'] = inside(r['tee']) and inside(r['flag'])
        if not r['accepted']:
            r['rejected'] = 'its tee or flag falls outside the course box: a chance peak; read this plate by eye'
    record = dict(schemaVersion=1, groundId=cfg['groundId'], imagery=cfg['imagery']['sourceId'],
                  method=(f'masked NCC of brightness normalised over {NORMALISE_METRES:g} m: over rotation, and scale bounded by the card length '
                          f'against the drawn tee-to-flag distance, at up to {COARSE:g} m (finer for a short hole), then at {FINE:g} m'),
                  note='The plates are drawings: their marks say which tee and which green a hole plays, never where an outline lies.',
                  plates=rows)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(record, indent=1) + '\n', encoding='utf-8', newline='\n')
    for r in rows:
        print(f"hole {r['hole']:2d}  score {r['score']:.3f}  {r['metresPerPixel']:.3f} m/px  turn {r['turnDegrees']:5.1f}  tee {r['tee']}  flag {r['flag']}"
              + ('' if r['accepted'] else '  REJECTED: ' + r['rejected']))


if __name__ == '__main__':
    main()
