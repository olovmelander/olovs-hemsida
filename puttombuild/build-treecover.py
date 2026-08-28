#!/usr/bin/env python3
"""Build the tree-cover raster for Puttom from Esri z17 imagery.

Same job as geobuild/build-treecover.py, different calibration problem: OSM has
NO forest polygons here, so there is nothing mapped to calibrate canopy against.
Instead the classifier self-calibrates: mown turf comes from the course model's
own rings (bright, green, smooth), water is masked by the model's rings (the sea
ring included -- open water is near-black and would otherwise pollute every dark
percentile), and the canopy thresholds are read off the darkest-and-textured
remainder, which on this cape IS forest: the imagery is high summer here too, so canopy is green, dark and violently textured,
while the mown corridors and the farmland are pale/smooth.

Needs:  node nvgkbuild/fetch-sat.mjs        (tiles under nvgkbuild/cache/sat)
        node nvgkbuild/reconcile.mjs        (course-model.json for the masks)
Run:    python3 nvgkbuild/build-treecover.py   -> nvgkbuild/tree-cover.json     """
import base64, json, math, os
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
model = json.load(open(os.path.join(HERE, "course-model.json")))
SATDIR = os.path.join(HERE, "cache", "sat")
Z = 17
LAT0, LON0 = 63.29920, 18.94130
M_PER_LON = 111320.0 * math.cos(math.radians(LAT0))

# ---------------------------------------------------------------- raster frame
CELL = 3.0
X0, Z0 = -1300.0, -1400.0
NX = int((1300 - X0) / CELL) + 1
NZ = int((1400 - Z0) / CELL) + 1
print(f"tree-cover grid {NX}x{NZ} @ {CELL} m")

# ------------------------------------------------------------- satellite mosaic
def merc_px(x, z):
    lon = x / M_PER_LON + LON0
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
lon = wx / M_PER_LON + LON0
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

all_turf = []
for h in model["holes"]:
    all_turf += [h["green"]["ring"]] + h["fairway"]["rings"] + [t["ring"] for t in h["tees"]["pads"]]
for k in ("fairways", "greens", "tees", "grass", "range"):
    all_turf += model["scenery"].get(k, [])
tmask = rings_mask(all_turf)
wmask = rings_mask([w["ring"] for w in model["water"]])
bmask = rings_mask([b["ring"] for b in model["infra"]["buildings"]])
marsh = rings_mask(model["vegetation"].get("wetland", []))

gd = cG - np.maximum(cR, cB)                        # green dominance
land = ~wmask

# This capture is a drought summer and it INVERTS Veckefjärden's rules: the mown
# ground reads BROWN (range-field gd median -15) while the canopy is the greenest
# thing in frame (+6..+11). What still separates forest from everything else is
# TEXTURE -- measured on hand-picked ground-truth boxes, crown texture runs
# 15.5-16 where heath is 7.5, the marsh 8.2 and turf 5.2 -- plus a brightness
# ceiling (sunlit sand and turf are bright) and a deep-shadow floor that catches
# the north side of every dense stand.
txt_forest = 15.7   # SW + NW dense-forest texture median (this exposure)
txt_open = 7.8      # heath/marsh texture median
txt_thr = (txt_forest + txt_open) / 2
bright_cut = 118    # turf Y median 117 is already smooth; sand above this is open
dark_floor = 45     # forest Y p10 41; heath p10 45 -- below this on land is stand shadow
print(f"thresholds: texture>{txt_thr:.1f}, Y<{bright_cut}, shadow floor Y<{dark_floor}")

crowns = land & (cS > txt_thr) & (cY < bright_cut)
shadow = land & (cY < dark_floor) & (cS > 5.5)        # calm dark water is smoother still
trees = crowns | shadow

tv = box(trees.astype(np.float32), 1)
trees = tv > 0.5
cover = np.where(trees, 3, 2).astype(np.uint8)

# --------------------------------------------------------- burn known ground
for m in (tmask, wmask, bmask):
    cover[m] = 2

frac = np.bincount(cover.ravel(), minlength=4) / cover.size
inM = cover[marsh]
print(f"final: open {frac[2]*100:.1f}%  trees {frac[3]*100:.1f}%")
print(f"inside the marsh polygons the imagery sees trees on {(inM==3).mean()*100:.0f}% of cells")

packed = np.packbits(np.unpackbits(cover.reshape(-1, 1), axis=1, count=2, bitorder="little").reshape(-1),
                     bitorder="little")
json.dump({"cell": CELL, "x0": float(X0), "z0": float(Z0), "nx": int(NX), "nz": int(NZ),
           "b64": base64.b64encode(packed.tobytes()).decode(),
           "legend": {"0": "unknown", "2": "open", "3": "trees"},
           "source": "Esri World Imagery z17, self-calibrated: turf from model rings, water masked "
                     "by the model's rings (sea ring included), canopy thresholds from the dark+textured "
                     "land remainder; mown/water/building rings burned open"},
          open(os.path.join(HERE, "tree-cover.json"), "w"))
print("wrote puttombuild/tree-cover.json")

# a review overlay: cover painted over the mosaic at half strength
ov = im.astype(np.uint8).copy()
grid = np.zeros((NZ, NX), dtype=np.uint8)
grid[:] = cover
big = Image.fromarray(grid * 80).resize((im.shape[1], im.shape[0]), Image.NEAREST)
ba = np.asarray(big)
ov[..., 1] = np.where(ba == 240, np.minimum(255, ov[..., 1] * 0.5 + 110), ov[..., 1])
Image.fromarray(ov).save(os.path.join(HERE, "cache", "treecover-overlay.png"))
print("wrote cache/treecover-overlay.png (green wash = trees)")
