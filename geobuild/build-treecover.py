#!/usr/bin/env python3
"""Build the tree-cover raster from orthorectified satellite imagery.

Three generations of source, each replacing the last for a reason. The club's
overview map was warped 40-70 m and called mown turf forest. The eighteen hole
plans fixed that where they reach, but each plan rides a two-anchor similarity
with a 5-6 m error bar, they miss the gaps between corridors, and their dark
mottled rough kept reading as canopy. The Esri World Imagery tiles need no
registration at all -- a Web Mercator tile's coordinates ARE its georeference --
they resolve individual crowns at ~0.54 m/px, and they cover the whole frame in
one exposure.

The other correction this pass makes is AUTHORITY. Earlier passes burned OSM's
forest polygons in as solid trees; the club's own aerials show those polygons
over-claim badly -- inside them sit heath, scattered singles and thinned stands.
Now the imagery decides everywhere, the model's mown/water/building rings still
burn as open (known ground can never be trees), and OSM forest agreement is
printed as a measurement instead of enforced as a truth.

Classification: mown turf is bright and green-dominant; conifer canopy is dark
and still green-dominant; leafless birch canopy (the capture is autumn) is
neither, but its crowns cast shadows that make it the most TEXTURED thing in
the frame. Thresholds calibrate against the model's own turf rings and the
interiors of OSM forest, then a 3x3 majority vote despeckles.

Needs:  node geobuild/fetch-sat.mjs   (once; tiles cache under geobuild/cache/sat)
Run:    python3 geobuild/build-treecover.py     -> geobuild/tree-cover.json        """
import base64, json, math, os
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
model = json.load(open(os.path.join(ROOT, "geobuild/course-model.json")))
SATDIR = os.path.join(ROOT, "geobuild/cache/sat")
Z = 17

# ---------------------------------------------------------------- raster frame
CELL = 3.0
pts = [p for h in model["holes"] for p in h["line"]]
xs = [p[0] for p in pts]; zs = [p[1] for p in pts]
X0, Z0 = min(xs) - 700, min(zs) - 700
NX = int((max(xs) + 700 - X0) / CELL) + 1
NZ = int((max(zs) + 700 - Z0) / CELL) + 1
print(f"tree-cover grid {NX}x{NZ} @ {CELL} m")

# ------------------------------------------------------------- satellite mosaic
LON0, LAT0 = 18.6735, 63.2845
def merc_px(x, z):
    lon = x / 50045.09 + LON0
    lat = LAT0 - z / 111320.0
    n = 2 ** Z
    fx = (lon + 180) / 360 * n * 256
    fy = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n * 256
    return fx, fy

fx0, fy0 = merc_px(X0, Z0)
fx1, fy1 = merc_px(X0 + NX * CELL, Z0 + NZ * CELL)
tx0, tx1 = int(fx0 // 256), int(fx1 // 256)
ty0, ty1 = int(fy0 // 256), int(fy1 // 256)
W = (tx1 - tx0 + 1) * 256
H = (ty1 - ty0 + 1) * 256
mosaic = np.zeros((H, W, 3), dtype=np.uint8)
missing = 0
for ty in range(ty0, ty1 + 1):
    for tx in range(tx0, tx1 + 1):
        p = os.path.join(SATDIR, f"{Z}_{tx}_{ty}.jpg")
        if not os.path.exists(p):
            missing += 1
            continue
        mosaic[(ty - ty0) * 256:(ty - ty0 + 1) * 256,
               (tx - tx0) * 256:(tx - tx0 + 1) * 256] = np.asarray(Image.open(p).convert("RGB"))
print(f"mosaic {W}x{H} from {(tx1-tx0+1)*(ty1-ty0+1)} tiles ({missing} missing)")

# work at half resolution (~1.1 m/px): plenty for 3 m cells, quarter the memory
im = mosaic[::2, ::2].astype(np.float32)
del mosaic
Rc, Gc, Bc = im[..., 0], im[..., 1], im[..., 2]
gray = im.mean(axis=2)

def box(a, k):
    pad = np.pad(a, k, mode="edge")
    out = np.zeros_like(a)
    for dy in range(-k, k + 1):
        for dx in range(-k, k + 1):
            out += pad[k + dy:k + dy + a.shape[0], k + dx:k + dx + a.shape[1]]
    return out / (2 * k + 1) ** 2

mR, mG, mB = box(Rc, 1), box(Gc, 1), box(Bc, 1)
mY = box(gray, 2)
sY = np.sqrt(np.maximum(0, box(gray * gray, 2) - box(gray, 2) ** 2))

# ------------------------------------------------- per-cell gather (world frame)
jj, ii = np.meshgrid(np.arange(NZ), np.arange(NX), indexing="ij")
wx = X0 + (ii + 0.5) * CELL
wz = Z0 + (jj + 0.5) * CELL
lon = wx / 50045.09 + LON0
lat = LAT0 - wz / 111320.0
n2 = 2 ** Z
px = ((lon + 180) / 360 * n2 * 256 - tx0 * 256) / 2
py = ((1 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2 * n2 * 256 - ty0 * 256) / 2
pxi = np.clip(px.astype(np.int32), 0, im.shape[1] - 1)
pyi = np.clip(py.astype(np.int32), 0, im.shape[0] - 1)
cR, cG, cB = mR[pyi, pxi], mG[pyi, pxi], mB[pyi, pxi]
cY, cS = mY[pyi, pxi], sY[pyi, pxi]

# --------------------------------------------------------- calibration masks
def rings_mask(rings):
    m = Image.new("L", (NX, NZ), 0)
    d = ImageDraw.Draw(m)
    for ring in rings:
        p = [((x - X0) / CELL, (z - Z0) / CELL) for x, z in ring]
        if len(p) >= 3:
            d.polygon(p, fill=1)
    return np.asarray(m, dtype=bool)

def turf_rings_of(h):
    return [h["green"]["ring"]] + h["fairway"]["rings"] + [t["ring"] for t in h["tees"]["pads"]]

all_turf = []
for h in model["holes"]:
    all_turf += turf_rings_of(h) + [b["ring"] for b in h["bunkers"]]
for k in ("fairways", "greens", "tees", "grass", "range"):
    all_turf += model["scenery"].get(k, [])
forest_rings = model["vegetation"].get("forest", []) + model["vegetation"].get("wood", [])
tmask = rings_mask(all_turf)
fmask = rings_mask(forest_rings)
wmask = rings_mask([w["ring"] for w in model["water"]])
bmask = rings_mask([b["ring"] for b in model["infra"]["buildings"]])

gd = cG - np.maximum(cR, cB)                        # green dominance
bright_thr = np.percentile(cY[tmask], 20) * 0.82    # mown turf is bright...
gd_thr = np.percentile(gd[tmask], 15) * 0.45        # ...and decisively green
gd_hi = np.percentile(gd[tmask], 40)                # unambiguously grass-green
dark_thr = (np.percentile(cY[fmask & ~tmask], 55) + np.percentile(cY[tmask], 10)) / 2
txt_thr = (np.percentile(cS[fmask & ~tmask], 45) + np.percentile(cS[tmask], 85)) / 2
print(f"calibrated: mown bright>{bright_thr:.0f} gd>{gd_thr:.0f}/{gd_hi:.0f} / conifer dark<{dark_thr:.0f} / crown texture>{txt_thr:.1f}")

# Two mistakes the first satellite pass made, both fixed by adding SMOOTHNESS to
# the turf tests: sunlit autumn canopy is bright and green-shifted but violently
# textured, so 'bright and green' alone swallowed whole clumps as fairway; and a
# tree's long shadow ON grass is dark but still decisively green and dead smooth,
# so 'dark and green' alone planted trees down every shadow. Grass is the smooth
# thing in this frame; canopy never is.
mown = (gd > gd_thr) & (cY > bright_thr) & (cS < txt_thr * 1.15)
shadowed_turf = (gd > gd_hi) & (cS < txt_thr * 0.85)
open_g = mown | shadowed_turf
conifer = (cG > cR + 4) & (cY < dark_thr) & ~open_g
# Texture alone was not enough: the mottled brown rough between the fairways is as
# textured as canopy and was planting trees down every strip the club's aerial shows
# bare. What canopy has and rough never does is SHADOW -- at this sun every real
# crown stands next to near-black cells -- so textured trees must be anchored by
# genuine darkness within a few cells.
dark_anchor = np.percentile(cY[fmask & ~tmask], 28)
anchored = box((cY < dark_anchor).astype(np.float32), 3) > 0.05
crowns = (cS > txt_thr * 0.9) & ~open_g & anchored
trees = conifer | crowns

# 3x3 majority vote despeckles both ways
tv = box(trees.astype(np.float32), 1)
trees = tv > 0.5
cover = np.where(trees, 3, 2).astype(np.uint8)

# --------------------------------------------------------- burn known ground
for m, v in ((tmask, 2), (wmask, 2), (bmask, 2)):
    cover[m] = v

frac = np.bincount(cover.ravel(), minlength=4) / cover.size
inF = cover[fmask & ~tmask]
print(f"final: open {frac[2]*100:.1f}%  trees {frac[3]*100:.1f}%")
print(f"inside OSM forest polygons the imagery sees trees on {(inF==3).mean()*100:.0f}% "
      f"of cells -- the rest is the over-claim the planter used to fill")

packed = np.packbits(np.unpackbits(cover.reshape(-1, 1), axis=1, count=2, bitorder="little").reshape(-1),
                     bitorder="little")   # crumb k lives at byte k>>2, shift (k&3)*2 -- the page's decode
json.dump({"cell": CELL, "x0": float(X0), "z0": float(Z0), "nx": int(NX), "nz": int(NZ),
           "b64": base64.b64encode(packed.tobytes()).decode(),
           "legend": {"0": "unknown", "2": "open", "3": "trees"},
           "source": "Esri World Imagery z17 (orthorectified, no registration), calibrated on model "
                     "turf + OSM forest interiors; mown/water/building rings burned open; OSM forest "
                     "NOT burned -- the imagery is the authority on where canopy stands"},
          open(os.path.join(ROOT, "geobuild/tree-cover.json"), "w"))
print("wrote geobuild/tree-cover.json")
