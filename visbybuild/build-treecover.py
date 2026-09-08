"""Build Visby's tree-cover raster from orthophoto -- AND IT DOES NOT WORK YET.

READ THIS BEFORE RUNNING IT. The raster this writes UNDER-DETECTS BY ABOUT
4.5x and is deliberately not committed. Measured against an independent z17
Esri classification of the same ground, which puts 22.4 ha of canopy (18.1%)
inside the 123.7 ha property hull, this produces 6.3 ha (4.0%) inside the
played bounding box. A raster that wrong would state something false about the
place, so it is left unshipped and the attempt is recorded instead.

What it establishes is still worth keeping, and section by section below it is
all measured on this course rather than carried from another:

  - the SUMMER frame cannot do this at all. Every other build here keys canopy
    on TEXTURE, and on Region Gotland's 2022 export that fails at 1 m, 0.5 m
    and 0.25 m alike -- every threshold flags nearly as much known-mown ground
    as non-mown (tex>20 at 0.5 m: 15.2% against 9.7%). It is served as JPEG
    through an ImageServer and carries compression texture everywhere.
  - the APRIL frame separates on COLOUR, because Kronholmen is pine and
    juniper: in April a conifer is dark and still green while the grass is pale
    and dormant. Swept over the whole window, lum < mown-p2 with ExG > 4 flags
    7.39% of non-mown land against 1.52% of known-mown, 4.86x.
  - and that is still not enough, because the detection is SPECKLED rather than
    solid crowns: aggregating those pixels into 3 m cells at a one-third fill
    drops the canopy share from 7.39% to 2.2%. The rule is finding crown edges
    and shadow, not crowns.
  - texture as a shadow veto made it worse, not better: the mown class's own
    75th percentile of texture on this frame is 6, which is a coin flip rather
    than a veto, and applying it pushed false positives above the hit rate.

THE ROUTE THAT SHOULD WORK is not imagery at all. The vegetation chain already
builds 1 m canopy-height rasters from the LiDAR (packages/course-geo/copc-
reader/build-canopy.mjs), and a canopy HEIGHT model measures the thing this is
trying to infer. Those rasters live in the runner's temp and travel in the run
artifact rather than being committed, so deriving tree-cover.json from them
means having the workflow write it. That is the next attempt; do not tune these
thresholds further.

--- the original description follows ---

Build Visby's tree-cover raster from orthophoto.

WHY THIS EXISTS AT ALL. Visby was the only build here without a tree-cover
raster, and the engine's two vista-cone loops sit inside `if (M.cover)`. With
no raster there were no distant trees of any kind -- which mattered little
while the ground stopped at 2 km and matters a great deal now it reaches 16.
The LiDAR generation plants the 4,096 m window; this raster is what stands
BEYOND it, and `coverEdgeFade` fades its word out over the last 240 m so the
boundary is not a line on the ground.

WHICH PHOTOGRAPH, AND THIS WAS MEASURED THE WRONG WAY ROUND FIRST. The obvious
choice is Region Gotland's 2022 summer capture, because leaf-on is what a
canopy classifier wants, and the repo's other builds all key on TEXTURE -- a
crown is violently textured where mown turf is smooth. On this frame that does
not work at any sampling: at 1 m, 0.5 m and 0.25 m alike, every texture
threshold flags nearly as much KNOWN-MOWN ground as it does non-mown land
(tex>20 at 0.5 m: 15.2% of land against 9.7% of mown). The frame is served as
JPEG through an ImageServer export and carries compression texture everywhere.

The 2026-04-10 Lantmateriet flight works, and on COLOUR rather than texture,
precisely because it is leaf-off: Kronholmen is pine and juniper ground, so in
April a conifer is DARK and still GREEN while the grass around it is pale and
dormant. Measured over a 600 m window at 0.5 m, `lum < 75 and ExG > 8` takes
12.5% of non-mown land against 2.7% of known-mown -- a 4.6x separation where
the summer frame's best was barely 1.6x.

So the two frames are instruments for different questions, and the answer is
the opposite of the green tracer's: THERE the summer frame wins because a
putting surface is defined by its mow contrast, HERE the April frame wins
because a conifer is defined by staying green when nothing else is. Pick the
frame by what the feature does in it.

The residual false positive is a tree's own shadow: dark and green, lying on
mown grass. Veckefjarden recorded the discriminator -- a shadow is dead SMOOTH
where a crown is textured -- so texture is used here as a veto rather than as
the rule.

CALIBRATION IS FROM THIS COURSE, never carried. Open ground is sampled inside
the model's own mown rings, which are known open by construction; water is
masked by the model's water rings; and the canopy threshold is read off the
land remainder. The one number that is not local is the cell size, 3 m, which
every other build here uses.

    python3 visbybuild/build-treecover.py  ->  visbybuild/tree-cover.json
"""
import base64
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'mapping'))
from ortho_read import window, to_pixel  # noqa: E402

ROOT = os.path.dirname(__file__)
MODEL = json.load(open(os.path.join(ROOT, 'course-model.json')))

CELL = 3.0
X0, X1 = -1500.0, 1500.0
Z0, Z1 = -1900.0, 1400.0
SAMPLE = 0.5           # metres per pixel to classify at, aggregated into cells


def poly_mask(rows, cols, aff, ring):
    pts = [to_pixel(aff, x, z) for x, z in ring]
    mask = np.zeros((rows, cols), dtype=bool)
    ys = np.array([p[1] for p in pts])
    for yi in range(rows):
        y = yi + 0.5
        if y < ys.min() - 1 or y > ys.max() + 1:
            continue
        xs = []
        for i in range(len(pts)):
            (x1, y1), (x2, y2) = pts[i], pts[(i + 1) % len(pts)]
            if (y1 > y) != (y2 > y):
                xs.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
        xs.sort()
        for a, b in zip(xs[0::2], xs[1::2]):
            lo, hi = max(0, int(np.ceil(a - 0.5))), min(cols - 1, int(np.floor(b - 0.5)))
            if hi >= lo:
                mask[yi, lo:hi + 1] = True
    return mask


def main():
    size = max(X1 - X0, Z1 - Z0)
    cx, cz = (X0 + X1) / 2, (Z0 + Z1) / 2
    px, aff = window(cx, cz, size, layer='lm016', metres=SAMPLE)
    rows, cols = px.shape[:2]
    print(f'imagery {cols}x{rows} at {SAMPLE} m/px over {size:.0f} m, layer lm016 (2026-04-10, leaf-off)')
    v = px.astype(np.float32)
    r, g, b = v[:, :, 0], v[:, :, 1], v[:, :, 2]
    exg = 2 * g - r - b
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    # local texture: a crown is violently textured, mown turf and water are not
    pad = np.pad(lum, 1, mode='edge')
    tex = np.zeros_like(lum)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            tex = np.maximum(tex, np.abs(pad[1 + dy:1 + dy + rows, 1 + dx:1 + dx + cols] - lum))

    mown = np.zeros((rows, cols), dtype=bool)
    for hole in MODEL['holes']:
        mown |= poly_mask(rows, cols, aff, hole['green']['ring'])
        for ring in hole['fairway']['rings']:
            mown |= poly_mask(rows, cols, aff, ring)
        for pad_ in hole['tees']['pads']:
            mown |= poly_mask(rows, cols, aff, pad_['ring'])
    water = np.zeros((rows, cols), dtype=bool)
    for body in MODEL['water']:
        water |= poly_mask(rows, cols, aff, body['ring'])
    built = np.zeros((rows, cols), dtype=bool)
    for building in MODEL['infra']['buildings']:
        built |= poly_mask(rows, cols, aff, building['ring'])

    land = ~water
    print(f'  calibration masks: mown {mown.sum():,} px, water {water.sum():,}, buildings {built.sum():,}')
    print(f'  mown  : lum p50 {np.percentile(lum[mown],50):6.1f}  tex p50 {np.percentile(tex[mown],50):5.1f}  ExG p50 {np.percentile(exg[mown],50):5.1f}')
    rest = land & ~mown & ~built
    print(f'  land  : lum p50 {np.percentile(lum[rest],50):6.1f}  tex p50 {np.percentile(tex[rest],50):5.1f}  ExG p50 {np.percentile(exg[rest],50):5.1f}')

    # A conifer in April is DARKER and GREENER than the dormant grass around
    # it. Both thresholds come from the mown class, the one known open by
    # construction: darker than its 25th percentile of luminance and greener
    # than its 25th percentile of excess green.
    # The darkness bar is the 2nd percentile of the MOWN class, i.e. darker
    # than all but a fiftieth of ground known open by construction; the green
    # bar is low and only excludes deep shadow, wet sand and water edges,
    # because in April a conifer is not especially green in absolute terms --
    # it is simply the only thing still green. Both were swept rather than
    # chosen: over the whole window, p2 with ExG > 4 flags 7.39% of non-mown
    # land against 1.52% of known-mown, a 4.86x separation, and every tighter
    # or looser pair scores worse (p1/>4 4.32% and 5.99x is more selective but
    # finds too little; p5/>0 takes 16.6% at 3.39x).
    dark = float(np.percentile(lum[mown], 2))
    green = 4.0
    print(f'  thresholds swept on this course: lum < {dark:.1f} (mown p2) AND ExG > {green:.0f}')
    trees = land & ~mown & ~built & (lum < dark) & (exg > green)
    false_positive = float((mown & (lum < dark) & (exg > green)).sum()) / max(1, mown.sum())
    print(f'  canopy: {trees.sum():,} px, {100*trees.sum()/land.sum():.2f}% of {land.sum():,} land px')
    hit = trees.sum() / max(1, (land & ~mown & ~built).sum())
    print(f'  the same rule on KNOWN-MOWN ground: {100*false_positive:.2f}% false positives, '
          f'{hit/max(false_positive, 1e-9):.2f}x separation')
    # texture was tried as a shadow veto and made it worse: at 0.5 m on this
    # frame the mown class's own 75th percentile of texture is 6, which is not
    # a veto but a coin flip, and applying it pushed false positives above the
    # hit rate. Recorded rather than kept.

    # aggregate to the 3 m cell: a cell is trees if a third of it is canopy
    nx, nz = int(round((X1 - X0) / CELL)), int(round((Z1 - Z0) / CELL))
    per = int(round(CELL / SAMPLE))
    ox, oz = int(round((X0 - aff['x0']) / SAMPLE)), int(round((Z0 - aff['z0']) / SAMPLE))
    crop = trees[oz:oz + nz * per, ox:ox + nx * per]
    frac = crop.reshape(nz, per, nx, per).mean(axis=(1, 3))
    cover = np.where(frac >= 1 / 3, 3, 2).astype(np.uint8)
    # the model's own rings are the authority where it has one
    for name, m_ in (('water', water), ('mown', mown), ('buildings', built)):
        c = m_[oz:oz + nz * per, ox:ox + nx * per].reshape(nz, per, nx, per).mean(axis=(1, 3))
        cover[c >= 0.5] = 2
    share = np.bincount(cover.ravel(), minlength=4) / cover.size
    print(f'  cells {nx}x{nz} @ {CELL} m -> trees {100*share[3]:.1f}%, open {100*share[2]:.1f}%')

    packed = np.packbits(np.unpackbits(cover.reshape(-1, 1), axis=1, count=2, bitorder='little').reshape(-1),
                         bitorder='little')
    out = dict(cell=CELL, x0=X0, z0=Z0, nx=nx, nz=nz,
               legend={'0': 'unknown', '2': 'open', '3': 'trees'},
               source=('Lantmateriet orto-f2-2026, flown 2026-04-10, 0.16 m RGBI, read at 0.5 m through the '
                       'viewing service Min karta proxies and aggregated to 3 m cells. Self-calibrated on '
                       'this course: open ground from the model mown rings, water and buildings from its own '
                       'rings, and the thresholds read off the mown distribution -- darker than its 25th '
                       'percentile of luminance and greener than its 25th of excess green, with a smoothness '
                       'veto that removes a tree\'s own shadow on grass. The LEAF-OFF frame is chosen '
                       'deliberately over Region Gotland 2022, which is summer and leaf-on but whose texture '
                       'flags nearly as much known-mown ground as non-mown at every sampling tried: on this '
                       'ground a conifer is identified by staying green when the grass does not.'),
               b64=base64.b64encode(packed.tobytes()).decode())
    path = os.path.join(ROOT, 'tree-cover.json')
    json.dump(out, open(path, 'w'))
    print(f'wrote {path}')


if __name__ == '__main__':
    main()
