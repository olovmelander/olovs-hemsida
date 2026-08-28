#!/usr/bin/env python3
"""Build the tree-cover raster from the eighteen hole plans.

The overview map was the first attempt at knowing where the trees stand and it fails
three ways at once: it is warped 40-70 m locally (relief displacement in a stitched
aerial no similarity can undo), its print makes the darkest real crowns bluer than its
water, and 42% of known mown turf lands in its dark-green class. The hole plans have
none of these problems -- they are real orthophoto at 0.11-0.37 m per pixel, and each
one is registered by its tee and pin with an error the blind test measured at 5-6 m.
Eighteen of them cover nearly the whole property, so the treelines between corridors
come from the imagery that actually resolves individual crowns.

Trees on an orthophoto are dark AND textured; mown grass is bright and smooth. Both
cues are calibrated per plan from ground truth in that frame -- the surveyed forest
rings and the model's turf -- because print exposure varies plan to plan.

Cells no plan covers fall back to the overview's dark-green class (far from the
corridors, where its warp matters least), and the model's own rings are burned in
last: known turf can never be trees, surveyed forest always is.

Run:  python3 geobuild/build-treecover.py     -> geobuild/tree-cover.json
"""
import base64, json, math, os
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
model = json.load(open(os.path.join(ROOT, "geobuild/course-model.json")))
anchors = json.load(open(os.path.join(ROOT, "geobuild/plan-anchors.json")))
HOLES = {h["n"]: h for h in model["holes"]}

# ---------------------------------------------------------------- raster frame
CELL = 3.0
pts = [p for h in model["holes"] for p in h["line"]]
xs = [p[0] for p in pts]; zs = [p[1] for p in pts]
X0, Z0 = min(xs) - 700, min(zs) - 700
NX = int((max(xs) + 700 - X0) / CELL) + 1
NZ = int((max(zs) + 700 - Z0) / CELL) + 1
print(f"tree-cover grid {NX}x{NZ} @ {CELL} m")

cover = np.zeros((NZ, NX), dtype=np.uint8)          # 0 unknown, 2 open, 3 trees
bestd = np.full((NZ, NX), 1e9)                      # nearest-plan-wins on overlap
# per-cell channel means from the owning plan, for the canopy post-pass
cellR = np.zeros((NZ, NX), dtype=np.float32)
cellG = np.zeros((NZ, NX), dtype=np.float32)
cellB = np.zeros((NZ, NX), dtype=np.float32)
cellY = np.zeros((NZ, NX), dtype=np.float32)        # gray

# ---------------------------------------------------------------- per-plan pass
def box_std(gray, k=2):
    """local std via box filters, no scipy"""
    pad = np.pad(gray, k, mode="edge")
    n = (2 * k + 1) ** 2
    s = np.zeros_like(gray, dtype=np.float64)
    s2 = np.zeros_like(gray, dtype=np.float64)
    for dy in range(-k, k + 1):
        for dx in range(-k, k + 1):
            w = pad[k + dy:k + dy + gray.shape[0], k + dx:k + dx + gray.shape[1]]
            s += w; s2 += w * w
    m = s / n
    return np.sqrt(np.maximum(0, s2 / n - m * m))

def ring_mask(rings, to_px, shape):
    """image-space mask of pixels under any of these world rings, drawn not tested"""
    m = Image.new("L", (shape[1], shape[0]), 0)
    d = ImageDraw.Draw(m)
    for ring in rings:
        pts = [to_px(x, z) for x, z in ring]
        if len(pts) >= 3:
            d.polygon(pts, fill=1)
    return np.asarray(m, dtype=bool)

forest_rings = model["vegetation"].get("forest", []) + model["vegetation"].get("wood", [])
def turf_rings_of(h):
    tr = [h["green"]["ring"]] + h["fairway"]["rings"] + [t["ring"] for t in h["tees"]["pads"]]
    return tr

# pooled fallback thresholds, refined per plan where ground truth is in frame
pool_dark, pool_txt = [], []

plans = []
for n in range(1, 19):
    A = anchors[str(n)]
    h = HOLES[n]
    p1 = complex(*A["teePx"]); p2 = complex(*A["pinPx"])
    w1 = complex(*h["line"][0]); w2 = complex(*h["pin"])
    a = (w2 - w1) / (p2 - p1); b = w1 - a * p1
    im = np.asarray(Image.open(os.path.join(ROOT, f"banguide/maps/hole_{n:02d}.jpg")).convert("RGB"),
                    dtype=np.float64)
    Him, Wim, _ = im.shape
    gray = im.mean(axis=2)
    R, G, B = im[..., 0], im[..., 1], im[..., 2]
    paper = (im.min(axis=2) > 200) & (im.max(axis=2) - im.min(axis=2) < 42)
    veg = (G > R - 16) & (G > B - 10) & ~paper
    # crowns are dark AND green; dry brown rough is dark and textured but R > G,
    # and it was landing in the trees class on hole 5 until this gate
    grn = (G > R - 6) & (G > B - 10) & ~paper
    # texture at roughly crown scale: 2 m worth of pixels
    k = max(2, int(round(2.0 / abs(a))))
    txt = box_std(gray[::2, ::2], k=max(1, k // 2))
    txt = np.repeat(np.repeat(txt, 2, axis=0), 2, axis=1)[:Him, :Wim]

    # calibrate: dark/texture split between crowns and mown in THIS plan's exposure
    to_px = lambda x, z: (((complex(x, z) - b) / a).real, ((complex(x, z) - b) / a).imag)
    fmask = ring_mask(forest_rings, to_px, (Him, Wim)) & ~paper if forest_rings else np.zeros((Him, Wim), bool)
    tmask = ring_mask(turf_rings_of(h), to_px, (Him, Wim)) & ~paper
    if fmask.sum() > 4000 and tmask.sum() > 4000:
        fg, tg = gray[fmask], gray[tmask]
        ft, tt = txt[fmask], txt[tmask]
        dark_thr = (np.percentile(fg, 65) + np.percentile(tg, 25)) / 2
        txt_thr = (np.percentile(ft, 35) + np.percentile(tt, 75)) / 2
        pool_dark.append(dark_thr); pool_txt.append(txt_thr)
    else:
        dark_thr, txt_thr = None, None
    plans.append((n, a, b, im, gray, txt, veg, grn, paper, dark_thr, txt_thr, (Him, Wim)))

fall_dark = float(np.median(pool_dark)); fall_txt = float(np.median(pool_txt))
print(f"calibrated on {len(pool_dark)} plans: fallback dark<{fall_dark:.0f}, texture>{fall_txt:.1f}")

def box_mean(mask, k=1):
    pad = np.pad(mask.astype(np.float32), k, mode="edge")
    out = np.zeros(mask.shape, dtype=np.float32)
    for dy in range(-k, k + 1):
        for dx in range(-k, k + 1):
            out += pad[k + dy:k + dy + mask.shape[0], k + dx:k + dx + mask.shape[1]]
    return out / (2 * k + 1) ** 2

for (n, a, b, im, gray, txt, veg, grn, paper, dark_thr, txt_thr, shape) in plans:
    h = HOLES[n]
    dk = dark_thr if dark_thr is not None else fall_dark
    tx_ = txt_thr if txt_thr is not None else fall_txt
    trees_img = grn & ((gray < dk) | ((txt > tx_) & (gray < dk * 1.25)))
    open_img = veg & ~trees_img
    tmean = box_mean(trees_img); omean = box_mean(open_img)
    Him, Wim = shape
    line = np.array(h["line"], dtype=float)
    i0 = max(0, int((line[:, 0].min() - 260 - X0) / CELL)); i1 = min(NX - 1, int((line[:, 0].max() + 260 - X0) / CELL))
    j0 = max(0, int((line[:, 1].min() - 260 - Z0) / CELL)); j1 = min(NZ - 1, int((line[:, 1].max() + 260 - Z0) / CELL))
    ii, jj = np.meshgrid(np.arange(i0, i1 + 1), np.arange(j0, j1 + 1))
    wx = X0 + (ii + 0.5) * CELL
    wz = Z0 + (jj + 0.5) * CELL
    # distance to the line decides which plan owns an overlapped cell
    d = np.full(wx.shape, 1e9)
    for k_ in range(len(line) - 1):
        ax, az = line[k_]; bx, bz = line[k_ + 1]
        dx, dz = bx - ax, bz - az
        L2 = dx * dx + dz * dz or 1.0
        t = np.clip(((wx - ax) * dx + (wz - az) * dz) / L2, 0, 1)
        d = np.minimum(d, np.hypot(wx - (ax + dx * t), wz - (az + dz * t)))
    ar, ai_, br_, bi_ = a.real, a.imag, b.real, b.imag
    den = ar * ar + ai_ * ai_
    px = ((( wx - br_) * ar + (wz - bi_) * ai_) / den).astype(np.int32)
    py = ((-(wx - br_) * ai_ + (wz - bi_) * ar) / den).astype(np.int32)
    ok = (px >= 1) & (px < Wim - 1) & (py >= 1) & (py < Him - 1)
    pxc = np.clip(px, 0, Wim - 1); pyc = np.clip(py, 0, Him - 1)
    ok &= ~paper[pyc, pxc]
    ok &= d < bestd[j0:j1 + 1, i0:i1 + 1]
    wt = tmean[pyc, pxc]; wo = omean[pyc, pxc]
    tree_c = ok & (wt > 0.45)
    open_c = ok & ~tree_c & (wo > 0.45)
    sub_cover = cover[j0:j1 + 1, i0:i1 + 1]
    sub_best = bestd[j0:j1 + 1, i0:i1 + 1]
    sub_cover[tree_c] = 3
    sub_cover[open_c] = 2
    upd = tree_c | open_c
    sub_best[upd] = d[upd]
    R, G, B = im[..., 0], im[..., 1], im[..., 2]
    for arr, src in ((cellR, R), (cellG, G), (cellB, B), (cellY, gray)):
        sub = arr[j0:j1 + 1, i0:i1 + 1]
        sub[upd] = src[pyc, pxc][upd]

covered = (cover > 0).mean()
print(f"plan imagery decided {covered * 100:.1f}% of cells")

# ------------------------------------------------- canopy post-pass on tree cells
# Shadowed conifer and dark mottled rough are indistinguishable pixel by pixel in
# this imagery (both sit near gray 60-70), so tree cells are judged by what their
# 12 m tree-cell neighbourhood looks like: conifer is green-dark (G<92, R<48),
# sunlit canopy is high-contrast (bright crowns against their own shadows), the
# blurred deciduous shore band is blue-dark (B<30). Rough is none of these.
# Verified against the eyeballed probe set: all true-tree probes satisfy a keep,
# all five confirmed rough/heath false positives satisfy none.
def box_sum(a, k):
    pad = np.pad(a, k, mode="constant")
    out = np.zeros(a.shape, dtype=np.float64)
    for dy in range(-k, k + 1):
        for dx in range(-k, k + 1):
            out += pad[k + dy:k + dy + a.shape[0], k + dx:k + dx + a.shape[1]]
    return out

treem = (cover == 3).astype(np.float64)
K = 4                                                # 12 m neighbourhood
cnt = np.maximum(box_sum(treem, K), 1)
mR = box_sum(cellR * treem, K) / cnt
mG = box_sum(cellG * treem, K) / cnt
mB = box_sum(cellB * treem, K) / cnt
mY = box_sum(cellY * treem, K) / cnt
sY = np.sqrt(np.maximum(0, box_sum(cellY * cellY * treem, K) / cnt - mY * mY))
# darkest tree cell in the window: canopy contrast comes with real crown shadows,
# red-green heath mottle is just as varied but never gets that dark
def box_min(a, k):
    pad = np.pad(a, k, mode="constant", constant_values=1e9)
    out = np.full(a.shape, 1e9)
    for dy in range(-k, k + 1):
        for dx in range(-k, k + 1):
            np.minimum(out, pad[k + dy:k + dy + a.shape[0], k + dx:k + dx + a.shape[1]], out=out)
    return out
loY = box_min(np.where(treem > 0, cellY, 1e9), K)
fmask_w = Image.new("L", (NX, NZ), 0)
dw = ImageDraw.Draw(fmask_w)
for ring in forest_rings:
    pts = [((x - X0) / CELL, (z - Z0) / CELL) for x, z in ring]
    if len(pts) >= 3:
        dw.polygon(pts, fill=1)
osm_near = box_sum(np.asarray(fmask_w, dtype=np.float64), 3) > 0     # within ~9 m
keep = osm_near | ((mG < 92) & (mR < 48)) | ((sY >= 26) & (loY <= 45)) | (mB < 30)
drop = (cover == 3) & ~keep
cover[drop] = 2
print(f"canopy post-pass reclassified {drop.sum()} tree cells ({drop.sum()*CELL*CELL/1e4:.1f} ha) as open rough")

# ---------------------------------------------------------------- overview fallback
ov = json.load(open(os.path.join(ROOT, "geobuild/overview-cover.json")))
raw = np.frombuffer(base64.b64decode(ov["b64"]), dtype=np.uint8)
bits = np.unpackbits(raw, bitorder="little")
og = (bits[0::2] + 2 * bits[1::2])[:ov["nx"] * ov["nz"]].reshape(ov["nz"], ov["nx"])
fell = 0
for j in range(NZ):
    z = Z0 + (j + 0.5) * CELL
    oj = int((z - ov["z0"]) / ov["cell"])
    if not (0 <= oj < ov["nz"]):
        continue
    for i in range(NX):
        if cover[j, i]:
            continue
        x = X0 + (i + 0.5) * CELL
        oi = int((x - ov["x0"]) / ov["cell"])
        if 0 <= oi < ov["nx"] and og[oj, oi] == 3:
            cover[j, i] = 3
            fell += 1
print(f"overview supplied {fell} far cells no plan covers")

# ---------------------------------------------------------------- burn ground truth
def burn(rings, val):
    m = Image.new("L", (NX, NZ), 0)
    d = ImageDraw.Draw(m)
    for ring in rings:
        pts = [((x - X0) / CELL, (z - Z0) / CELL) for x, z in ring]
        if len(pts) >= 3:
            d.polygon(pts, fill=1)
    cover[np.asarray(m, dtype=bool)] = val

all_turf = []
for h in model["holes"]:
    all_turf += turf_rings_of(h) + [b_["ring"] for b_ in h["bunkers"]]
for k in ("fairways", "greens", "tees", "grass", "range", "bunkers"):
    all_turf += model["scenery"].get(k, [])
burn(forest_rings, 3)
burn(all_turf, 2)
for w in model["water"]:
    burn([w["ring"]], 2)                             # trees do not stand on water
for b_ in model["infra"]["buildings"]:
    burn([b_["ring"]], 2)

frac = np.bincount(cover.ravel(), minlength=4) / cover.size
print(f"final: unknown {frac[0]*100:.1f}%  open {frac[2]*100:.1f}%  trees {frac[3]*100:.1f}%")

packed = np.packbits(np.unpackbits(cover.reshape(-1, 1), axis=1, count=2, bitorder="little").reshape(-1),
                     bitorder="little")   # crumb k lives at byte k>>2, shift (k&3)*2 -- the page's decode
json.dump({"cell": CELL, "x0": float(X0), "z0": float(Z0), "nx": int(NX), "nz": int(NZ),
           "b64": base64.b64encode(packed.tobytes()).decode(),
           "legend": {"0": "unknown", "2": "open", "3": "trees"},
           "source": "hole plans (per-hole tee+pin registration, per-plan calibrated dark+texture); "
                     "overview dark-green only where no plan reaches; model rings burned last"},
          open(os.path.join(ROOT, "geobuild/tree-cover.json"), "w"))
print("wrote geobuild/tree-cover.json")
