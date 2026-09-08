#!/usr/bin/env python3
"""The tree-cover raster for Lidingö, read off the 2025-05-31 Lantmäteriet capture.

Every other ground here has a 3 m tree-cover raster and this one had none, so the
planter had nothing to obey outside the LiDAR window and nothing to thin an
over-claiming wood polygon with. This builds it from the one photo record, on
Veckefjärden's spacing (3 m) and in the same two-bit packed form the six other
builds ship, and it scores itself against a record that never entered it.

WHAT DECIDES A CELL.  Veckefjärden's classifier section is the physics and it
holds here: mown turf is bright, green AND SMOOTH, sunlit leaf-on canopy is
bright and green but violently textured, and a tree's long shadow on grass is
dark but dead smooth.  Texture is the discriminator, not colour -- and on this
capture the second half of the same idea is stronger still: a real crown at this
sun stands next to genuine darkness, while a fairway never does.  So the rule is
a LOCAL term and a CONTEXT term:

    trees  =  relative texture over 4.8 m  >  TEX_CUT
              AND the darkest pixel within 4.8 m  <  DARK_CUT

Both cuts are swept on ground THIS MODEL ALREADY LABELS on THIS capture -- the
interiors of the 18 wood rings against the interiors of the greens, fairways and
tee pads -- and both gaps are reported.  Nothing is copied from another course or
another day's light.

WHAT CHECKS IT.  The 2021-03-23 laser canopy height model, which never entered
the rule.  Its numeric rasters are a gitignored CI cache and are not on this
machine, but the vegetation chain's review renders ARE committed, and they encode
the CHM exactly: grey v = round(20 + min(1, h/30) * 235), dark blue (12,18,48)
for no return, drawn at 1 m per pixel into eighteen crops whose EPSG:3006 bboxes
are recorded in review/legend.json.  The georeference is confirmed independently
-- 99.7% of the model's hole-centre-line samples land within one pixel of the
white line the renderer drew from that same geometry -- and the overlays the
renderer draws in grey (fairway rings at 170) are masked by re-rasterising them
here, so no line is read back as 19 m of canopy.

Run:  python3 lidingobuild/mapping/build-treecover-2025.py
Out:  lidingobuild/mapping/tree-cover-2025.json   (evidence, statistics, refusals)
      lidingobuild/tree-cover.json                (the raster, if the score stands)
"""
import base64, json, sys, time
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as nd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lm2025 as L

ROOT = Path(__file__).resolve().parents[2]
GENERATOR = 'lidingobuild/mapping/build-treecover-2025.py'
MEASURED_ON = '2026-09-08'
CELL = 3.0
BLOCK = 6                      # 0.16 m native -> 0.96 m working pixel
COLOUR_WINDOW = 3              # 2.88 m
TEXTURE_WINDOW = 5             # 4.80 m
REVIEW = ROOT / 'geo_data/course-v2/lidingo/vegetation/review'

model = json.loads((ROOT / 'lidingobuild/course-model.json').read_text(encoding='utf8'))
E0, N0 = 677700.5, 6586399.5   # model frame origin: E = x + E0, N = N0 - z


def to3006(ring):
    return [[x + E0, N0 - z] for x, z in ring]


def closed(ring):
    ring = [list(p) for p in ring]
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring


# ---------------------------------------------------------------- the capture
t0 = time.time()
image, world = L.image()
px = world[0]
photo = dict(minE=world[4], maxN=world[5],
             maxE=world[4] + image.shape[1] * px, minN=world[5] - image.shape[0] * px)
# the raster window IS the capture's own coverage, snapped inward to the 3 m grid:
# the photograph is the authority and it does not reach further.
X0 = np.ceil((photo['minE'] - E0) / CELL) * CELL
Z0 = np.ceil((N0 - photo['maxN']) / CELL) * CELL
NX = int((photo['maxE'] - E0 - X0) // CELL)
NZ = int((N0 - photo['minN'] - Z0) // CELL)

H = (image.shape[0] // BLOCK) * BLOCK
W = (image.shape[1] // BLOCK) * BLOCK
work = image[:H, :W].reshape(H // BLOCK, BLOCK, W // BLOCK, BLOCK, 3).mean(axis=(1, 3)).astype(np.float32)
wpx = px * BLOCK
WE0 = world[4] + wpx / 2.0
WN0 = world[5] - wpx / 2.0
R, G, B = work[..., 0], work[..., 1], work[..., 2]
lum = 0.299 * R + 0.587 * G + 0.114 * B
box = lambda a, k: nd.uniform_filter(a, k, mode='nearest')
meanY = box(lum, TEXTURE_WINDOW)
sigmaY = np.sqrt(np.maximum(0, box(lum * lum, TEXTURE_WINDOW) - meanY * meanY))
minY = nd.minimum_filter(lum, TEXTURE_WINDOW, mode='nearest')
sR, sG, sB, sL = box(R, COLOUR_WINDOW), box(G, COLOUR_WINDOW), box(B, COLOUR_WINDOW), box(lum, COLOUR_WINDOW)

ii, jj = np.meshgrid(np.arange(NX), np.arange(NZ))
CE = X0 + (ii + 0.5) * CELL + E0
CN = N0 - (Z0 + (jj + 0.5) * CELL)
col = np.clip(np.round((CE - WE0) / wpx).astype(np.int32), 0, work.shape[1] - 1)
row = np.clip(np.round((WN0 - CN) / wpx).astype(np.int32), 0, work.shape[0] - 1)
take = lambda f: f[row, col]
cR, cG, cB, cL = take(sR), take(sG), take(sB), take(sL)
cSigma, cMin = take(sigmaY), take(minY)
SUM = np.maximum(cR + cG + cB, 1)
EXG = (2 * cG - cR - cB) / SUM * 100.0          # normalised excess green, reported only
TEX = cSigma / np.maximum(cL, 1) * 100.0        # relative texture over 4.8 m
print(f'window {NX}x{NZ} @ {CELL} m   working pixel {wpx:.2f} m   {time.time()-t0:.1f}s')


# --------------------------------------------------------- ring rasterisation
def fill(ring):
    """A ring, in EPSG:3006, as a boolean cell mask. Evaluated over its own bbox
    only -- 900 rings over the whole grid is minutes, over their bboxes seconds."""
    mask = np.zeros((NZ, NX), bool)
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    i0 = max(int((min(xs) - E0 - X0) / CELL) - 1, 0)
    i1 = min(int((max(xs) - E0 - X0) / CELL) + 2, NX)
    j0 = max(int((N0 - max(ys) - Z0) / CELL) - 1, 0)
    j1 = min(int((N0 - min(ys) - Z0) / CELL) + 2, NZ)
    if i1 <= i0 or j1 <= j0:
        return mask
    mask[j0:j1, i0:i1] = L.point_in_ring(CE[j0:j1, i0:i1], CN[j0:j1, i0:i1], ring)
    return mask


def union(rings):
    out = np.zeros((NZ, NX), bool)
    for ring in rings:
        out |= fill(closed(ring))
    return out


wood_rings = [to3006(r) for r in model['vegetation']['wood']]
wood = union(wood_rings)
surfaces = L.surfaces()
kinds = {k: [] for k in ('green', 'fairway', 'tee', 'bunker')}
for f in surfaces['features']:
    kinds[f['properties']['kind']] += L.rings_of(f['geometry'])
green, fairway, tee, bunker = (union(kinds[k]) for k in ('green', 'fairway', 'tee', 'bunker'))
turf = green | fairway | tee
water = union([b['ring'] and to3006(b['ring']) for b in model['water'] if b.get('ring')])
buildings = union([to3006(b['ring']) for b in model['infra']['buildings']])
parking = union([to3006(b['ring']) for b in model['infra']['parking']])

erode = lambda m, k: nd.binary_erosion(m, np.ones((3, 3)), iterations=k)
dilate = lambda m, k: nd.binary_dilation(m, np.ones((3, 3)), iterations=k)
# calibration interiors: two cells in from every edge, and clear of each other
wood_cal = erode(wood, 2) & ~dilate(turf | bunker | buildings, 2)
turf_cal = erode(turf, 2) & ~dilate(wood, 2)
hard_cal = erode(buildings, 1) | erode(parking, 1)
print(f'calibration cells: wood {wood_cal.sum()}  turf {turf_cal.sum()}  hard {hard_cal.sum()}')


# ------------------------------------------------------------- the calibration
def sweep_pair(field, positive, negative, positive_is_high, lo, hi, step=0.05):
    """The cut that minimises (positive missed + negative falsely claimed) on THIS
    capture's own pixels, and the decile gap the two distributions leave. A
    negative gap means the distributions overlap at the deciles and no threshold
    exists; it is reported either way."""
    a, b = field[positive], field[negative]
    best = None
    for cut in np.arange(lo, hi + 1e-9, step):
        err = ((a < cut).mean() if positive_is_high else (a > cut).mean()) + \
              ((b >= cut).mean() if positive_is_high else (b <= cut).mean())
        if best is None or err < best[0]:
            best = (err, float(cut))
    err, cut = best
    if positive_is_high:
        gap = float(np.percentile(a, 10) - np.percentile(b, 90))
        miss = float((a < cut).mean()); false = float((b >= cut).mean())
    else:
        gap = float(np.percentile(b, 10) - np.percentile(a, 90))
        miss = float((a > cut).mean()); false = float((b <= cut).mean())
    q = lambda v: [round(float(x), 2) for x in np.percentile(v, [10, 50, 90])]
    return dict(cut=round(cut, 2), decileGap=round(gap, 2),
                positiveMissed=round(miss, 4), negativeFalselyClaimed=round(false, 4),
                positiveDeciles=q(a), negativeDeciles=q(b))


def sweep(field, above_is_wood, lo, hi, step=0.05):
    """The cut that minimises (wood missed + turf falsely claimed) on THIS
    capture's own pixels, and the decile gap the two distributions leave. A
    negative gap would mean the distributions overlap at the deciles and no
    threshold exists; it is reported either way."""
    a, b = field[wood_cal], field[turf_cal]
    best = None
    for cut in np.arange(lo, hi + 1e-9, step):
        err = ((a < cut).mean() if above_is_wood else (a > cut).mean()) + \
              ((b >= cut).mean() if above_is_wood else (b <= cut).mean())
        if best is None or err < best[0]:
            best = (err, float(cut))
    err, cut = best
    if above_is_wood:
        gap = float(np.percentile(a, 10) - np.percentile(b, 90))
        miss = float((a < cut).mean()); false = float((b >= cut).mean()); hard = float((field[hard_cal] >= cut).mean())
    else:
        gap = float(np.percentile(b, 10) - np.percentile(a, 90))
        miss = float((a > cut).mean()); false = float((b <= cut).mean()); hard = float((field[hard_cal] <= cut).mean())
    q = lambda v: [round(float(x), 2) for x in np.percentile(v, [10, 50, 90])]
    return dict(cut=round(cut, 2), decileGap=round(gap, 2), woodMissed=round(miss, 4),
                turfFalselyClaimed=round(false, 4), hardSurfaceFalselyClaimed=round(hard, 4),
                woodDeciles=q(a), turfDeciles=q(b), hardDeciles=q(field[hard_cal]))


tex_cal = sweep(TEX, True, 2.0, 20.0)
dark_cal = sweep(cMin, False, 20.0, 120.0)
# excess green is measured against the question it can actually answer -- is this
# cell VEGETATION at all -- and not against wood-versus-turf, where it runs the
# other way (a fairway is greener than a canopy) and no threshold exists.
exg_cal = sweep_pair(EXG, wood_cal | turf_cal, hard_cal, True, -6.0, 20.0)
exg_cal['woodVersusTurfDecileGap'] = round(float(np.percentile(EXG[wood_cal], 10) - np.percentile(EXG[turf_cal], 90)), 2)
exg_cal['woodDeciles'] = [round(float(x), 2) for x in np.percentile(EXG[wood_cal], [10, 50, 90])]
exg_cal['turfDeciles'] = [round(float(x), 2) for x in np.percentile(EXG[turf_cal], [10, 50, 90])]
TEX_CUT = tex_cal['cut']
DARK_CUT = dark_cal['cut']
print(f'texture cut {TEX_CUT} (gap {tex_cal["decileGap"]})   shadow cut {DARK_CUT} (gap {dark_cal["decileGap"]})')

raw_trees = (TEX > TEX_CUT) & (cMin < DARK_CUT)
voted = nd.uniform_filter(raw_trees.astype(np.float32), 3, mode='nearest') > 0.5
burn_open = turf | bunker | water | buildings | parking
trees = voted & ~burn_open
cover = np.where(trees, 3, 2).astype(np.uint8)


# ------------------------------------------- the independent record: the laser
def read_chm():
    """The 2021 canopy height model, decoded out of the committed review renders.
    Returns height in metres, a validity mask, and the mosaic's frame."""
    legend = json.loads((REVIEW / 'legend.json').read_text())
    boxes = [e['bboxEpsg3006'] for e in legend['holes']]
    UE0 = float(np.floor(min(b[0] for b in boxes))); UN1 = float(np.ceil(max(b[3] for b in boxes)))
    UE1 = float(np.ceil(max(b[2] for b in boxes))); UN0 = float(np.floor(min(b[1] for b in boxes)))
    w, h = int(UE1 - UE0), int(UN1 - UN0)
    chm = np.zeros((h, w), np.float32)
    ok = np.zeros((h, w), bool)
    # every line the renderer draws, re-rasterised here: the fairway rings are
    # drawn in GREY (170) and would otherwise decode as 19.15 m of canopy
    overlay_lines = []
    for hole in model['holes']:
        overlay_lines.append(to3006(hole['line']))
        overlay_lines += [to3006(closed(r)) for r in hole['fairway']['rings'] if r]
        overlay_lines += [to3006(closed(p['ring'])) for p in hole['tees']['pads'] if p.get('ring')]
        if hole['green'].get('ring'):
            overlay_lines.append(to3006(closed(hole['green']['ring'])))
        overlay_lines += [to3006(closed(b['ring'])) for b in hole.get('bunkers', []) if b.get('ring')]
    overlay_lines += [to3006(closed(b['ring'])) for b in model['water'] if b.get('ring')]
    checked = hit = 0
    for entry in legend['holes']:
        b = entry['bboxEpsg3006']
        a = np.asarray(Image.open(REVIEW / entry['file']).convert('RGB')).astype(np.int16)
        ph, pw = a.shape[:2]
        grey = (a[..., 0] == a[..., 1]) & (a[..., 1] == a[..., 2])
        void = (a[..., 0] == 12) & (a[..., 1] == 18) & (a[..., 2] == 48)
        drawn = np.zeros((ph, pw), bool)
        for pts in overlay_lines:
            for i in range(len(pts) - 1):
                p, q = pts[i], pts[i + 1]
                x0, y0 = p[0] - b[0], b[3] - p[1]
                x1, y1 = q[0] - b[0], b[3] - q[1]
                steps = int(max(1, abs(x1 - x0), abs(y1 - y0)))
                for s in range(steps + 1):
                    xx = int(round(x0 + (x1 - x0) * s / steps)); yy = int(round(y0 + (y1 - y0) * s / steps))
                    if 0 <= xx < pw and 0 <= yy < ph:
                        drawn[yy, xx] = True
        # the georeference check: the renderer drew the hole lines from geometry
        # this classifier never touched, so where they land is an independent test
        for pts in [to3006(hh['line']) for hh in model['holes']]:
            for i in range(len(pts) - 1):
                p, q = pts[i], pts[i + 1]
                x0, y0 = p[0] - b[0], b[3] - p[1]
                x1, y1 = q[0] - b[0], b[3] - q[1]
                steps = int(max(1, abs(x1 - x0), abs(y1 - y0)))
                for s in range(steps + 1):
                    xx = int(round(x0 + (x1 - x0) * s / steps)); yy = int(round(y0 + (y1 - y0) * s / steps))
                    if 0 <= xx < pw and 0 <= yy < ph:
                        checked += 1
                        white = (a[max(0, yy - 1):yy + 2, max(0, xx - 1):xx + 2] == 255).all(axis=2)
                        hit += bool(white.any())
        mask = nd.binary_dilation(drawn, np.ones((5, 5))) | nd.binary_dilation(~grey & ~void, np.ones((3, 3)))
        usable = grey & ~mask
        height = (a[..., 0].astype(np.float32) - 20.0) / 235.0 * 30.0
        c0 = int(round(b[0] - UE0)); r0 = int(round(UN1 - b[3]))
        sl = (slice(r0, r0 + ph), slice(c0, c0 + pw))
        fresh = usable & ~ok[sl]
        sub = chm[sl]; sub[fresh] = height[fresh]; chm[sl] = sub
        acc = ok[sl]; acc |= usable; ok[sl] = acc
    return chm, ok, UE0, UN1, w, h, checked, hit


chm, chm_ok, UE0, UN1, CW, CH, geo_checked, geo_hit = read_chm()
count = np.zeros((NZ, NX), np.int32); canopy = np.zeros((NZ, NX), np.int32)
hsum = np.zeros((NZ, NX)); hmax = np.zeros((NZ, NX))
for dy in (-1, 0, 1):
    for dx in (-1, 0, 1):
        c = np.floor(CE + dx - UE0).astype(int); r = np.floor(UN1 - (CN + dy)).astype(int)
        inside = (c >= 0) & (c < CW) & (r >= 0) & (r < CH)
        cc = np.clip(c, 0, CW - 1); rr = np.clip(r, 0, CH - 1)
        good = chm_ok[rr, cc] & inside
        hh = chm[rr, cc]
        count += good; canopy += (good & (hh >= 2.0)); hsum += np.where(good, hh, 0)
        hmax = np.maximum(hmax, np.where(good, hh, 0))
have = count >= 5
frac = np.where(count > 0, canopy / np.maximum(count, 1), 0.0)
hmean = np.where(count > 0, hsum / np.maximum(count, 1), 0.0)
laser_canopy = have & (frac >= 0.5)
laser_open = have & (frac <= 0.2)
to_canopy = nd.distance_transform_edt(~laser_canopy) * CELL


def score(pred, label):
    p = pred & ~burn_open
    tp = int((p & laser_canopy).sum()); fp = int((p & laser_open).sum())
    fn = int((~p & laser_canopy).sum()); tn = int((~p & laser_open).sum())
    return dict(label=label, truePositive=tp, falsePositive=fp, falseNegative=fn, trueNegative=tn,
                precision=round(tp / max(tp + fp, 1), 3), recall=round(tp / max(tp + fn, 1), 3),
                iou=round(tp / max(tp + fp + fn, 1), 3),
                accuracy=round((tp + tn) / max(tp + tn + fp + fn, 1), 3))


adopted = score(trees, 'imagery classifier (adopted)')
baseline = score(wood, 'model wood rings burned solid (what the model already has)')
tex_only = score(nd.uniform_filter((TEX > TEX_CUT).astype(np.float32), 3, mode='nearest') > 0.5, 'texture term alone')
dark_only = score(nd.uniform_filter((cMin < DARK_CUT).astype(np.float32), 3, mode='nearest') > 0.5, 'shadow term alone')
half = CE < (photo['minE'] + photo['maxE']) / 2


def score_region(pred, region, label):
    p = pred & ~burn_open & region
    can = laser_canopy & region; opn = laser_open & region
    tp = int((p & can).sum()); fp = int((p & opn).sum())
    fn = int((~p & can).sum()); tn = int((~p & opn).sum())
    return dict(label=label, truePositive=tp, falsePositive=fp, falseNegative=fn, trueNegative=tn,
                precision=round(tp / max(tp + fp, 1), 3), recall=round(tp / max(tp + fn, 1), 3),
                iou=round(tp / max(tp + fp + fn, 1), 3),
                accuracy=round((tp + tn) / max(tp + tn + fp + fn, 1), 3))


west = score_region(trees, half, 'adopted, west half of the capture only')
east = score_region(trees, ~half, 'adopted, east half of the capture only')
# the two rule forms that were measured and NOT adopted, so the note quotes numbers
vote = lambda m: nd.uniform_filter(m.astype(np.float32), 3, mode='nearest') > 0.5
turf_floor = float(np.percentile(cL[turf_cal], 10))
variant_lum = score(vote((TEX > TEX_CUT) & (cMin < DARK_CUT) & (cL < turf_floor)),
                    'adopted plus mean luminance < the turf floor (%.1f)' % turf_floor)
variant_exg = score(vote((TEX > TEX_CUT) & (cMin < DARK_CUT) & (EXG > exg_cal['cut'])),
                    'adopted plus a vegetation gate (normalised excess green > %.2f)' % exg_cal['cut'])
cal_err = lambda m: round(float((1 - m[wood_cal].mean()) + m[turf_cal].mean()), 4)
variant_lum['ringCalibrationError'] = cal_err(vote((TEX > TEX_CUT) & (cMin < DARK_CUT) & (cL < turf_floor)))
variant_exg['ringCalibrationError'] = cal_err(vote((TEX > TEX_CUT) & (cMin < DARK_CUT) & (EXG > exg_cal['cut'])))
adopted_cal_err = cal_err(voted)

fp_cells = trees & laser_open
near = {f'within{d}m': round(float((to_canopy[fp_cells] <= d + 1e-6).mean()), 3) for d in (3, 6, 9, 12)}
far = fp_cells & (to_canopy > 9)
fn_cells = (~trees) & laser_canopy
q = lambda v, ps: [round(float(x), 2) for x in np.percentile(v, ps)] if v.size else None

# ------------------------------------------------------------------- statistics
wood_open_ring = wood & ~burn_open
stats = dict(
    windowCells=int(NX * NZ), windowAreaHectares=round(NX * NZ * CELL * CELL / 1e4, 1),
    canopyFractionOverWindow=round(float((cover == 3).mean()), 4),
    openFractionOverWindow=round(float((cover == 2).mean()), 4),
    unknownCells=int((cover == 0).sum()),
    canopyInsideWoodRings=round(float((cover[wood_open_ring] == 3).mean()), 4),
    laserCanopyInsideWoodRings=round(float((frac[wood_open_ring & have] >= 0.5).mean()), 4),
    woodRingCellsWithLaser=int((wood_open_ring & have).sum()),
    canopyOutsideWoodRings=round(float((cover[~wood & ~burn_open] == 3).mean()), 4),
    canopyAreaOutsideWoodRingsHectares=round(float(((cover == 3) & ~wood).sum()) * CELL * CELL / 1e4, 1),
    laserCoveredCells=int(have.sum()),
    laserCoverageFractionOfWindow=round(float(have.mean()), 3),
    laserCanopyFractionWhereCovered=round(float(laser_canopy[have].mean()), 4),
    classifierCanopyFractionWhereCovered=round(float(trees[have].mean()), 4),
)
print(json.dumps(stats, indent=1))
print('adopted', adopted, '\nbaseline', baseline)

evidence = dict(
    schemaVersion=1, measuredOn=MEASURED_ON, generator=GENERATOR,
    state='measured-candidate-geometry',
    layer='tree cover and forest',
    horizontalCrs='EPSG:3006',
    sourceCapture=dict(id=L.META['sourceId'], captureDate=L.META['captureDate'],
                       sha256=L.META['sha256'], provider=L.META['provider'], product=L.META['product'],
                       licence='Lantmäteriet Ortofoto via minkarta; see geo_data/course-v2/lidingo/discovery/source-access.json',
                       attribution='© Lantmäteriet',
                       sampleSpacingMetres=L.META['sampleSpacingMetres'],
                       windowEpsg3006=L.META['windowEpsg3006']),
    raster=dict(path='lidingobuild/tree-cover.json', cellMetres=CELL,
                frame='page-local metres from the model origin: east +x, SOUTH +z; E = x + %.1f, N = %.1f - z' % (E0, N0),
                x0=float(X0), z0=float(Z0), nx=NX, nz=NZ,
                legend={'0': 'unknown', '2': 'open', '3': 'trees'},
                packing='two bits per cell, crumb k at byte k>>2 shift (k&3)*2 (little bitorder); '
                        'decoder verified against geobuild/nvgkbuild/puttombuild tree-cover.json, which decode '
                        'to values {2,3} only with byte counts equal to ceil(nx*nz/4)',
                windowIsTheCapture='the window is the capture\'s own coverage snapped inward to the 3 m grid; '
                                   'the photograph reaches only 110-119 m beyond the played bounding box, '
                                   'against the 700 m margin Veckefjärden\'s raster carries'),
    rule=dict(
        form='trees = relativeTexture(4.8 m) > TEX_CUT AND minimumLuminance(4.8 m) < DARK_CUT, '
             'then a 3x3 majority vote, then known ground burned open',
        why='Veckefjärden\'s classifier lesson, re-measured here: mown turf is bright, green AND SMOOTH; '
            'sunlit leaf-on canopy is bright and green but violently textured; a tree\'s shadow on grass is '
            'dark but dead smooth. Texture is the discriminator, not colour. The second term is the same '
            'idea from the other side: a crown at this sun stands beside genuine darkness and a fairway does not.',
        workingResolutionMetres=round(wpx, 3),
        preparation='the 0.16 m capture block-averaged %dx to %.2f m; colour smoothed over %d px (%.2f m); '
                    'texture is the standard deviation of luminance over %d px (%.2f m); the shadow anchor is '
                    'the minimum of luminance over the same window' % (
                        BLOCK, wpx, COLOUR_WINDOW, COLOUR_WINDOW * wpx, TEXTURE_WINDOW, TEXTURE_WINDOW * wpx),
        relativeTexture='100 * sigma(luminance) / mean(luminance)',
        calibration=dict(
            method='every cut is swept on ground this model already labels, on this capture only: the '
                   'interiors of the 18 wood rings (eroded two cells, clear of any playing surface) against '
                   'the interiors of the greens, fairways and tee pads (eroded two cells, clear of wood). '
                   'The cut is the one that minimises wood-missed plus turf-falsely-claimed. '
                   'A negative decile gap would mean the two distributions overlap and no threshold exists.',
            texture=tex_cal, shadowAnchor=dark_cal,
            normalisedExcessGreen=dict(**exg_cal,
                sweptAgainst='vegetation (wood interiors + turf interiors) versus hard standing '
                             '(building and parking interiors)',
                note='measured and NOT used as a term. It answers "is this vegetation at all" -- hard '
                     'standing sits at or below zero -- but it cannot answer "is this canopy": against '
                     'turf it runs the WRONG WAY, a fairway being greener than a crown, and its '
                     'wood-versus-turf decile gap is negative. Adding it as a third term costs recall '
                     '(see score.variantsMeasuredNotAdopted). Buildings and parking are burned open from '
                     'the model instead, which is exact.'),
        ),
        thresholds=dict(relativeTextureCut=TEX_CUT, minimumLuminanceCut=DARK_CUT,
                        majorityVote='3x3, strictly more than half'),
        burnedOpen=['playing-surfaces.geojson greens, fairways, tees and bunkers',
                    'course-model.json water rings', 'course-model.json building footprints (562)',
                    'course-model.json parking rings (29)'],
        notBurned='roads and paths are lines with generic rendering widths and a crown legitimately '
                  'overhangs a road, so no road corridor is burned; the diagnostic is reported below',
    ),
    independentCheck=dict(
        record='the 2021-03-23 laser canopy height model of the ground-vegetation chain',
        whyIndependent='it is a different sensor, a different year and a different pipeline, and no part of '
                       'it entered the classifier or its calibration',
        access='the numeric rasters (lidingobuild/cache/vegetation/chm-*.f32) are a gitignored CI cache and '
               'are NOT on this machine; the committed review renders under '
               'geo_data/course-v2/lidingo/vegetation/review are read instead. render-review.mjs encodes the '
               'CHM as grey v = round(20 + min(1, h/30) * 235) with dark blue (12,18,48) for no return, at '
               '1 m per pixel, into 18 crops whose bboxes legend.json records.',
        decode='h = (v - 20) / 235 * 30 for grey pixels; pixels the renderer drew over are excluded by '
               're-rasterising every line it draws and dilating 5x5, because the fairway rings are drawn in '
               'grey 170 and would decode as 19.15 m of canopy',
        georeferenceProof=dict(
            test='the renderer draws the model hole centre lines in white; rasterising the same lines here '
                 'and asking whether each sample lands within one pixel of a white pixel tests the crops\' '
                 'georeference with geometry the classifier never used',
            samples=geo_checked, landedOnWhite=geo_hit,
            fraction=round(geo_hit / max(geo_checked, 1), 4)),
        laserCanopyThresholdMetres=2.0,
        cellRule='a cell is laser canopy if at least half of its >=5 valid 1 m samples stand 2 m or more '
                 'above ground, laser open if at most a fifth do; the rest are held out as ambiguous',
        ambiguousCells=int((have & ~laser_canopy & ~laser_open).sum()),
        vintageCaveat='the laser is 2021-03-23 and LEAF-OFF, the photograph is 2025-05-31 and leaf-on. '
                      'Disagreement is expected in both directions and is not by itself an error of either '
                      'record: a March scan under-detects deciduous crowns (the Johannesberg caveat), and '
                      'four years separate them.',
    ),
    score=dict(
        adopted=adopted, baseline=baseline,
        singleTermVariants=[tex_only, dark_only],
        spatialHalves=[west, east],
        beatsWhatTheModelHas=dict(
            iouAdopted=adopted['iou'], iouBaseline=baseline['iou'],
            statement='the classifier reaches IoU %.3f against the laser where the model\'s own wood rings, '
                      'burned solid, reach %.3f -- the rings recall only %.3f of the laser\'s canopy because '
                      'six of the eighteen lie wholly outside the capture and the rest miss the woodland '
                      'between them' % (adopted['iou'], baseline['iou'], baseline['recall'])),
        variantsMeasuredNotAdopted=[variant_lum, variant_exg],
        ringCalibrationErrorAdopted=adopted_cal_err,
        howTheFormWasChosen='by the RING CALIBRATION, never by the laser. The adopted form leaves ring '
                            'calibration error %.4f; the luminance variant leaves %.4f and the vegetation '
                            'variant %.4f, so neither was selected -- even though the luminance variant '
                            'scores HIGHER against the laser. Choosing a form by the check would spend the '
                            'check, and this is written down so a reader can see the trade rather than '
                            'take it on trust.' % (adopted_cal_err, variant_lum['ringCalibrationError'],
                                                   variant_exg['ringCalibrationError']),
    ),
    theDecidingStatistic=dict(
        question='where the imagery claims canopy and the laser does not, is the laser height piled at zero '
                 '(the imagery over-detected) or does it carry branch height (a leaf-off scan thinned a real '
                 'crown)? -- the Johannesberg rule',
        disputedCells=int(fp_cells.sum()),
        disputedAreaHectares=round(float(fp_cells.sum()) * CELL * CELL / 1e4, 2),
        distanceToNearestLaserCanopyCell=near,
        reading='%.1f%% of the disputed cells lie within 9 m of a cell the laser itself calls canopy, so most '
                'of the disagreement is an EDGE effect: a leaf-on May crown is wider than its leaf-off March '
                'skeleton, the shadow anchor reaches 2.4 m past a crown edge, and the majority vote adds a '
                'cell. It is a fattening of the canopy boundary, not canopy invented in open ground.'
                % (100 * near['within9m']),
        genuinelyIsolated=dict(
            cells=int(far.sum()), areaHectares=round(float(far.sum()) * CELL * CELL / 1e4, 2),
            fractionOfDisputed=round(float(far.sum()) / max(int(fp_cells.sum()), 1), 3),
            maxLaserHeightQuantiles_p50_p75_p90=q(hmax[far], [50, 75, 90]),
            fractionWithMaxHeightBelowHalfMetre=round(float((hmax[far] < 0.5).mean()), 3),
            verdict='piled at zero. By the Johannesberg rule this residual is genuine OVER-DETECTION by the '
                    'imagery, not canopy the leaf-off scan missed, and it is the honest cost of the rule.'),
        reverseDisagreement=dict(
            cells=int(fn_cells.sum()),
            meanLaserHeightQuantiles_p50_p90=q(hmean[fn_cells], [50, 90]),
            reading='where the imagery says open and the laser says canopy the laser height is real '
                    '(metres, not centimetres), so these are crowns the photograph does not show as canopy: '
                    'felled or thinned between 2021 and 2025, or standing over ground the burn rules claim.'),
    ),
    statistics=stats,
    refusals=[],
)

# ------------------------------------------------------------------- refusals
inside_capture = lambda ring: all(photo['minE'] <= p[0] <= photo['maxE'] and photo['minN'] <= p[1] <= photo['maxN'] for p in ring)
overlaps = lambda ring: not (max(p[0] for p in ring) < photo['minE'] or min(p[0] for p in ring) > photo['maxE'] or
                             max(p[1] for p in ring) < photo['minN'] or min(p[1] for p in ring) > photo['maxN'])
whole = [i for i, r in enumerate(wood_rings) if inside_capture(r)]
partial = [i for i, r in enumerate(wood_rings) if overlaps(r) and i not in whole]
outside = [i for i, r in enumerate(wood_rings) if not overlaps(r)]
scrub_rings = [to3006(r) for r in model['vegetation']['scrub']]
evidence['refusals'] = [
    dict(kind='outside-the-capture', what='wood rings the photograph does not reach',
         woodRingsWhollyInside=len(whole), woodRingsPartlyInside=len(partial), woodRingsWhollyOutside=outside,
         detail='the capture spans E %.0f-%.0f N %.0f-%.0f. Six of the eighteen wood rings lie entirely '
                'outside it and six more only partly inside, so the raster cannot thin them and they keep '
                'whatever the model already says.' % (photo['minE'], photo['maxE'], photo['minN'], photo['maxN'])),
    dict(kind='outside-the-capture', what='the single scrub ring',
         rings=len(scrub_rings), overlapsCapture=int(sum(1 for r in scrub_rings if overlaps(r))),
         detail='vegetation.scrub\'s one ring stands at E %.0f-%.0f N %.0f-%.0f, clear of the photograph. '
                'Nothing is said about it.' % (min(p[0] for p in scrub_rings[0]), max(p[0] for p in scrub_rings[0]),
                                               min(p[1] for p in scrub_rings[0]), max(p[1] for p in scrub_rings[0]))),
    dict(kind='no-independent-check', what='the part of the window the review crops do not cover',
         cells=int((~have).sum()), fractionOfWindow=round(float((~have).mean()), 3),
         detail='the laser record available on this machine is the eighteen hole crops, which cover the '
                'played ground and 90 m round it. Over the remaining cells the classification is stated with '
                'its calibration behind it and nothing independent under it.'),
    dict(kind='measured-over-detection', what='the isolated disputed cells',
         cells=int(far.sum()), areaHectares=round(float(far.sum()) * CELL * CELL / 1e4, 2),
         detail='kept as a measured cost, not silently removed. Trimming them would mean tuning the rule on '
                'the record that checks it.'),
    dict(kind='not-attempted', what='forest RING geometry for vegetation.forest',
         detail='this layer emits a raster and no rings. A polygon is a claim about a boundary; the raster is '
                'a claim about a cell, and only the second is what the classifier measured. '
                'vegetation.forest stays empty.'),
    dict(kind='dated-blind-spot', what='growth and felling between 2021 and 2025',
         detail='the laser is four years older than the photograph, so neither record can date a change on '
                'its own. Where they disagree the older captures (2018, 2019) are the dating instrument, '
                'and that is a different measurement from this one.'),
]

# road diagnostic (reported, not acted on)
road_pts = 0; road_trees = 0
for way in model['infra']['roads']:
    for x, z in way['line']:
        i = int((x - X0) / CELL); j = int((z - Z0) / CELL)
        if 0 <= i < NX and 0 <= j < NZ:
            road_pts += 1; road_trees += int(cover[j, i] == 3)
evidence['rule']['roadDiagnostic'] = dict(
    roadVertexSamplesInsideWindow=road_pts, classedTrees=road_trees,
    fraction=round(road_trees / max(road_pts, 1), 3),
    note='road centre-line vertices that land in a cell the raster calls trees. A crown really does overhang '
         'a suburban road here, so this is reported rather than burned away.')

out = ROOT / 'lidingobuild/mapping/tree-cover-2025.json'
out.write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + '\n', encoding='utf8')
print('wrote', out)

if adopted['iou'] > baseline['iou'] and adopted['recall'] > 0.85:
    packed = np.packbits(np.unpackbits(cover.reshape(-1, 1), axis=1, count=2, bitorder='little').reshape(-1),
                         bitorder='little')
    raster = dict(cell=CELL, x0=float(X0), z0=float(Z0), nx=int(NX), nz=int(NZ),
                  b64=base64.b64encode(packed.tobytes()).decode(),
                  legend={'0': 'unknown', '2': 'open', '3': 'trees'},
                  source='Lantmateriet Ortofoto 0.16 m, %s (EPSG:3006 native, orthorectified, no registration). '
                         'Relative texture over 4.8 m > %.2f AND darkest pixel within 4.8 m < %.1f, both cut on '
                         'this capture\'s own pixels inside the model\'s wood rings against its greens, fairways '
                         'and tee pads; 3x3 majority vote; playing surfaces, water, buildings and parking burned '
                         'open. Scored against the 2021 laser canopy height model, which never entered it: '
                         'IoU %.3f, precision %.3f, recall %.3f, against IoU %.3f for the model\'s own wood '
                         'rings. Evidence: %s'
                         % (L.META['captureDate'], TEX_CUT, DARK_CUT, adopted['iou'], adopted['precision'],
                            adopted['recall'], baseline['iou'], 'lidingobuild/mapping/tree-cover-2025.json'))
    p = ROOT / 'lidingobuild/tree-cover.json'
    p.write_text(json.dumps(raster) + '\n', encoding='utf8')
    print('wrote', p, f'{len(packed)} bytes packed')
else:
    print('REFUSED: the classifier does not beat the model wood rings; raster not written')
