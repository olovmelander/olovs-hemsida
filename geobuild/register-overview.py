#!/usr/bin/env python3
"""Register the club's overview map to the OSM course frame.

The overview is the club's own drawing of its course, and for the six holes OSM never
mapped it is the only picture of them that exists. Registering it puts that picture in
the same metres as everything else, so the land cover under holes 1-5 and 7 can be read
off it at about 1.5 m per pixel instead of guessed.

Both frames are north-up, so the transform is a scale in metres per pixel plus a
translation -- three numbers. They are fitted by maximising agreement between the map's
WATER mask and the Veckefjarden shoreline that OSM gives us. Water is chosen because it
is the largest, darkest, least ambiguous thing in the picture and because it is
completely independent of the golf features the fit will later be judged on: the
championship greens never enter the objective, so their agreement afterwards is a real
check rather than a restatement.

Run:  python3 geobuild/register-overview.py [overview.jpg]
Writes geobuild/overview-fit.json and geobuild/overview-cover.json.
"""
import json, os, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
img_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "banguide/maps/oversikt.jpg")

osm = json.load(open(os.path.join(ROOT, "geobuild/osm-features.json")))
lake = max(osm["water"], key=lambda w: w["area"])
print("lake %s: %d pts, %.2f km2" % (lake.get("name"), len(lake["ring"]), lake["area"] / 1e6))

# ---------------------------------------------------------------- image masks
im = np.asarray(Image.open(img_path).convert("RGB"), dtype=np.int16)
H, W, _ = im.shape
R, G, B = im[:, :, 0], im[:, :, 1], im[:, :, 2]
mx = im.max(axis=2)
mn = im.min(axis=2)

# The page is drawn on white with a soft vignette; anything near-white is off-map.
paper = (mn > 205) & ((mx - mn) < 26)
water_img = (B > R + 14) & (B > G + 6) & (mx < 190) & ~paper
green_img = (G > R + 10) & (G > B + 6) & ~paper
dark_green = green_img & (G < 118)
print("image %dx%d  water %.1f%%  green %.1f%%  paper %.1f%%"
      % (W, H, 100 * water_img.mean(), 100 * green_img.mean(), 100 * paper.mean()))

# ---------------------------------------------------------------- world masks
CELL = 6.0
ring = np.array(lake["ring"], dtype=np.float64)
pad = 500.0
x0 = ring[:, 0].min() - pad; x1 = ring[:, 0].max() + pad
z0 = ring[:, 1].min() - pad; z1 = ring[:, 1].max() + pad
# widen to cover the whole course too, so the search cannot slide off the data
allpts = np.array([p for f in ("greens", "fairways", "tees") for r in osm[f] for p in r["ring"]])
x0 = min(x0, allpts[:, 0].min() - pad); x1 = max(x1, allpts[:, 0].max() + pad)
z0 = min(z0, allpts[:, 1].min() - pad); z1 = max(z1, allpts[:, 1].max() + pad)
NX = int((x1 - x0) / CELL) + 1
NZ = int((z1 - z0) / CELL) + 1
print("world grid %dx%d at %g m, x %.0f..%.0f z %.0f..%.0f" % (NX, NZ, CELL, x0, x1, z0, z1))


def rasterize(rings, nx=NX, nz=NZ, ox=None, oz=None, cell=CELL):
    """even-odd scanline fill of world rings into a boolean grid"""
    ox = x0 if ox is None else ox
    oz = z0 if oz is None else oz
    out = np.zeros((nz, nx), dtype=bool)
    for ring in rings:
        P = np.asarray(ring, dtype=np.float64)
        px = (P[:, 0] - ox) / cell
        pz = (P[:, 1] - oz) / cell
        n = len(P)
        jlo = max(0, int(np.floor(pz.min())))
        jhi = min(nz - 1, int(np.ceil(pz.max())))
        for j in range(jlo, jhi + 1):
            yc = j + 0.5
            xs = []
            for i in range(n):
                k = (i + 1) % n
                z1_, z2_ = pz[i], pz[k]
                if (z1_ > yc) != (z2_ > yc):
                    xs.append(px[i] + (yc - z1_) * (px[k] - px[i]) / (z2_ - z1_))
            xs.sort()
            for a in range(0, len(xs) - 1, 2):
                ia = max(0, int(np.ceil(xs[a] - 0.5)))
                ib = min(nx - 1, int(np.floor(xs[a + 1] - 0.5)))
                if ib >= ia:
                    out[j, ia:ib + 1] = True
    return out


water_world = rasterize([w["ring"] for w in osm["water"]])
green_world = rasterize([g["ring"] for g in osm["greens"]])
print("world water %.1f%% of grid" % (100 * water_world.mean()))

# ---------------------------------------------------------------- fit
# map pixel (px, py) -> world (x, z):  x = tx + s*px,  z = tz + s*py   (north-up, y down = +z)
gx, gz = np.meshgrid(np.arange(NX), np.arange(NZ))
wx = x0 + (gx + 0.5) * CELL
wz = z0 + (gz + 0.5) * CELL


# The map is a vignette: it fades to white well before the far side of the lake, so an
# area overlap can never score well no matter how good the alignment is. What IS fully
# visible is the stretch of SHORELINE the course sits on, so the fit is done on that
# curve instead. Each shoreline vertex gets two probes, one 22 m into the lake and one
# 22 m inland; a correct alignment puts the first on water pixels and the second on
# land pixels, and only a correct one satisfies both at once.
LR = np.array(lake["ring"], dtype=np.float64)
_cx, _cz = LR[:, 0].mean(), LR[:, 1].mean()
_nx = LR[:, 0] - _cx
_nz = LR[:, 1] - _cz
_L = np.hypot(_nx, _nz)
_nx /= _L
_nz /= _L
PROBE = 22.0
wet_x, wet_z = LR[:, 0] - _nx * PROBE, LR[:, 1] - _nz * PROBE
dry_x, dry_z = LR[:, 0] + _nx * PROBE, LR[:, 1] + _nz * PROBE
land_img = ~water_img & ~paper


def shore_score(s, tx, tz):
    wpx = ((wet_x - tx) / s).astype(np.int32); wpy = ((wet_z - tz) / s).astype(np.int32)
    dpx = ((dry_x - tx) / s).astype(np.int32); dpy = ((dry_z - tz) / s).astype(np.int32)
    ok = ((wpx >= 0) & (wpx < W) & (wpy >= 0) & (wpy < H) &
          (dpx >= 0) & (dpx < W) & (dpy >= 0) & (dpy < H))
    if ok.sum() < 60:
        return 0.0
    wet_ok = water_img[np.clip(wpy, 0, H - 1), np.clip(wpx, 0, W - 1)][ok]
    dry_ok = land_img[np.clip(dpy, 0, H - 1), np.clip(dpx, 0, W - 1)][ok]
    # both probes must be right; weight by how much shoreline is actually on the map
    return float((wet_ok & dry_ok).mean()) * min(1.0, ok.sum() / (0.35 * len(LR)))


best = (0, None)
for s in np.arange(1.05, 2.30, 0.025):
    for tx in np.arange(-2800, -300, 40):
        for tz in np.arange(-2400, 300, 40):
            v = shore_score(s, tx, tz)
            if v > best[0]:
                best = (v, (s, tx, tz))
print("coarse shoreline score %.3f at s=%.3f tx=%.0f tz=%.0f" % (best[0], *best[1]))

s, tx, tz = best[1]
step = np.array([0.025, 40.0, 40.0])
for _ in range(10):
    improved = True
    while improved:
        improved = False
        for k, d in ((0, step[0]), (1, step[1]), (2, step[2])):
            for sgn in (-1, 1):
                c = [s, tx, tz]
                c[k] += sgn * d
                v = shore_score(c[0], c[1], c[2])
                if v > best[0]:
                    best = (v, tuple(c))
                    s, tx, tz = c
                    improved = True
    step *= 0.5
print("refined shoreline score %.3f at s=%.4f m/px  tx=%.1f  tz=%.1f" % (best[0], s, tx, tz))


def score(s, tx, tz, mask_img, mask_world):
    px = (wx - tx) / s
    py = (wz - tz) / s
    ok = (px >= 0) & (px < W - 1) & (py >= 0) & (py < H - 1)
    samp = np.zeros_like(mask_world)
    xi = np.clip(px.astype(np.int32), 0, W - 1)
    yi = np.clip(py.astype(np.int32), 0, H - 1)
    samp[ok] = mask_img[yi[ok], xi[ok]]
    inter = (samp & mask_world).sum()
    union = (samp | mask_world).sum()
    return inter / union if union else 0.0


best = (shore_score(s, tx, tz), (s, tx, tz))
print("water-area IoU at that fit: %.3f (expected low: the map is a vignette)"
      % score(s, tx, tz, water_img, water_world))

# independent checks -- these never entered the objective
g_iou = score(s, tx, tz, green_img, green_world)
print("CHECK green-mask IoU vs OSM greens: %.3f  (greens are small; coverage matters more)" % g_iou)
px = (green_world & (np.abs(np.arange(NZ)[:, None] * 0 + 1) > 0))
# coverage: what fraction of OSM green cells land on map-green pixels?
gxs = ((wx - tx) / s).astype(np.int32)
gys = ((wz - tz) / s).astype(np.int32)
inb = (gxs >= 0) & (gxs < W) & (gys >= 0) & (gys < H)
cov = green_img[np.clip(gys, 0, H - 1), np.clip(gxs, 0, W - 1)]
print("CHECK OSM green cells on map-green pixels: %.3f" % cov[green_world & inb].mean())
fair_world = rasterize([f["ring"] for f in osm["fairways"]])
print("CHECK OSM fairway cells on map-green pixels: %.3f" % cov[fair_world & inb].mean())

json.dump({"image": os.path.relpath(img_path, ROOT), "w": int(W), "h": int(H),
           "s": float(s), "tx": float(tx), "tz": float(tz), "shoreScore": float(best[0]),
           "greenCover": float(cov[green_world & inb].mean()),
           "fairwayCover": float(cov[fair_world & inb].mean()),
           "note": "world x = tx + s*px, world z = tz + s*py; both frames north-up"},
          open(os.path.join(ROOT, "geobuild/overview-fit.json"), "w"), indent=1)

# ---------------------------------------------------------------- land cover
# 0 other/rough, 1 water, 2 mown turf, 3 forest -- same convention the old page used.
COVER_CELL = 3.0
cx0, cx1 = allpts[:, 0].min() - 700, allpts[:, 0].max() + 700
cz0, cz1 = allpts[:, 1].min() - 700, allpts[:, 1].max() + 700
CNX = int((cx1 - cx0) / COVER_CELL) + 1
CNZ = int((cz1 - cz0) / COVER_CELL) + 1
cgx, cgz = np.meshgrid(np.arange(CNX), np.arange(CNZ))
cwx = cx0 + (cgx + 0.5) * COVER_CELL
cwz = cz0 + (cgz + 0.5) * COVER_CELL
cpx = np.clip(((cwx - tx) / s).astype(np.int32), 0, W - 1)
cpy = np.clip(((cwz - tz) / s).astype(np.int32), 0, H - 1)
inmap = ((cwx - tx) / s >= 0) & ((cwx - tx) / s < W) & ((cwz - tz) / s >= 0) & ((cwz - tz) / s < H)
cover = np.zeros((CNZ, CNX), dtype=np.uint8)
cover[green_img[cpy, cpx] & ~dark_green[cpy, cpx]] = 2
cover[dark_green[cpy, cpx]] = 3
cover[water_img[cpy, cpx]] = 1
cover[~inmap | paper[cpy, cpx]] = 0
packed = np.packbits(np.unpackbits(cover.reshape(-1, 1), axis=1, count=2, bitorder="little").reshape(-1))
json.dump({"cell": COVER_CELL, "x0": float(cx0), "z0": float(cz0), "nx": int(CNX), "nz": int(CNZ),
           "b64": __import__("base64").b64encode(packed.tobytes()).decode(),
           "legend": {"0": "other", "1": "water", "2": "turf", "3": "forest"}},
          open(os.path.join(ROOT, "geobuild/overview-cover.json"), "w"))
frac = np.bincount(cover.ravel(), minlength=4) / cover.size
print("cover %dx%d @%gm  other %.1f%% water %.1f%% turf %.1f%% forest %.1f%%"
      % (CNX, CNZ, COVER_CELL, *(100 * frac)))
print("wrote geobuild/overview-fit.json and geobuild/overview-cover.json")
