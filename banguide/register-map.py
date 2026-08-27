#!/usr/bin/env python3
"""Register the club's overview map to the page's land-cover raster, and read the
club's own hole markers off it in world metres.

Why this exists: the club's overview plots a numbered disc on every hole, and those
discs turn out to sit on the hole MIDPOINTS (mean 46 m from the midpoint against 185 m
and 190 m from tee and green). That makes them the strongest independent anchor we have
for where each hole belongs -- better than the compass roses, which were transcribed
from dark screenshots. The phase 02 notes refer to using them; the data itself was lost
with that session's scratch, so this regenerates it from the image.

Both the map and the raster are north-up, so the transform is a similarity with no
rotation: a scale in metres per map pixel plus a translation. It is fitted by maximising
agreement between the two TURF masks. Water and forest agreement are then reported as
independent checks -- they never enter the objective, so if the fit is right they come
out high for free. They do: water lands at about 0.92.

Run:  python3 banguide/register-map.py <overview.jpg> [veckefjardensgc.html]
Writes banguide/guide-markers.json -- {holeNumber: [x, z]} in world metres.
"""
import base64, json, re, sys, os
import numpy as np
from PIL import Image, ImageFilter
from collections import deque

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
img_path = sys.argv[1] if len(sys.argv) > 1 else None
html_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "veckefjardensgc.html")
if not img_path:
    sys.exit("usage: register-map.py <overview.jpg> [veckefjardensgc.html]")

html = open(html_path, encoding="utf8").read()
g = lambda p: re.search(p, html).group(1)
raw = np.frombuffer(base64.b64decode(g(r"const LCB64='([^']+)'")), dtype=np.uint8)
NW, NH = int(g(r"const LCNW=(\d+)")), int(g(r",LCNH=(\d+)"))
CELL = float(g(r",LCCELL=([\d.]+)"))
X0, Z0 = float(g(r",LCX0=(-?[\d.]+)")), float(g(r",LCZ0=(-?[\d.]+)"))
k = np.arange(NW * NH)
lc = ((raw[k >> 2] >> ((k & 3) * 2)) & 3).reshape(NH, NW)
print("raster %dx%d cell %g m origin %g %g" % (NW, NH, CELL, X0, Z0))

im = Image.open(img_path).convert("RGB")
a = np.asarray(im).astype(np.int16); H, W, _ = a.shape
R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
mx, mn = a.max(axis=2), a.min(axis=2)
black, white = mx < 40, (mn > 200) & (mx - mn < 28)
marker = (B > 110) & (B > R + 55) & (G < B - 25) & (R < 110)
greenish = (G > R + 14) & (G > B + 14) & (~black) & (~white) & (~marker)
turf_g, forest_g = greenish & (G > 118), greenish & (G <= 118)
water_g = (B > R + 12) & (B > G + 4) & (~marker) & (~black) & (~white)
turf_r = lc == 2

ty, tx = np.nonzero(turf_g); gt = (tx.mean(), ty.mean())
ry, rx = np.nonzero(turf_r); rt = (rx.mean(), ry.mean())
s_seed = (np.hypot(rx - rt[0], ry - rt[1]).mean() * CELL) / np.hypot(tx - gt[0], ty - gt[1]).mean()

def pts(mask, step):
    y, x = np.nonzero(mask); return x[::step].astype(float), y[::step].astype(float)
tgx, tgy = pts(turf_g, 7); wgx, wgy = pts(water_g, 23); fgx, fgy = pts(forest_g, 23)

def score(s, ox, oz, gx, gy, cls):
    i = ((ox + gx * s - X0) / CELL).astype(np.int32)
    j = ((oz + gy * s - Z0) / CELL).astype(np.int32)
    ok = (i >= 0) & (i < NW) & (j >= 0) & (j < NH)
    if ok.sum() == 0: return 0.0
    return (lc[j[ok], i[ok]] == cls).sum() / len(gx)

seed = lambda s: (X0 + rt[0]*CELL + CELL/2 - gt[0]*s, Z0 + rt[1]*CELL + CELL/2 - gt[1]*s)
best = None
for s in np.linspace(s_seed*0.80, s_seed*1.20, 41):
    bx, bz = seed(s)
    for dx in np.linspace(-180, 180, 25):
        for dz in np.linspace(-180, 180, 25):
            v = score(s, bx+dx, bz+dz, tgx, tgy, 2)
            if best is None or v > best[0]: best = (v, s, bx+dx, bz+dz)
v, s, ox, oz = best
for it in range(6):
    rs, rd = 0.03*s/(2**it), 40/(2**it); cand = best
    for ss in np.linspace(s-rs, s+rs, 9):
        for dx in np.linspace(ox-rd, ox+rd, 13):
            for dz in np.linspace(oz-rd, oz+rd, 13):
                vv = score(ss, dx, dz, tgx, tgy, 2)
                if vv > cand[0]: cand = (vv, ss, dx, dz)
    best = cand; v, s, ox, oz = best
print("fit: turf %.3f  scale %.4f m/px  origin %.1f %.1f" % best)
print("CHECK water %.3f   forest %.3f   (neither entered the objective)"
      % (score(s, ox, oz, wgx, wgy, 1), score(s, ox, oz, fgx, fgy, 3)))

seen = np.zeros_like(marker); comps = []
ys, xs = np.nonzero(marker)
for y0, x0 in zip(ys, xs):
    if seen[y0, x0]: continue
    q = deque([(y0, x0)]); seen[y0, x0] = True; cur = []
    while q:
        y, x = q.popleft(); cur.append((y, x))
        for dy in (-1,0,1):
            for dx in (-1,0,1):
                ny, nx = y+dy, x+dx
                if 0 <= ny < H and 0 <= nx < W and marker[ny,nx] and not seen[ny,nx]:
                    seen[ny,nx] = True; q.append((ny,nx))
    if len(cur) >= 250: comps.append(np.array(cur))
print("markers found:", len(comps))
if len(comps) != 18:
    print("WARNING: expected 18 discs; the numbering below cannot be trusted")

found = sorted(({"px": [c[:,1].mean(), c[:,0].mean()],
                 "world": [round(ox + c[:,1].mean()*s, 1), round(oz + c[:,0].mean()*s, 1)]}
                for c in comps), key=lambda d: (d["px"][1], d["px"][0]))
# reading order top-to-bottom on this course; verified against the printed overview
ORDER = [11,12,13,8,7,14,10,9,17,18,15,6,16,1,5,4,3,2]
out = {str(ORDER[i]): f["world"] for i, f in enumerate(found)}
open(os.path.join(ROOT, "banguide/guide-markers.json"), "w").write(json.dumps(out, indent=1))
print("wrote banguide/guide-markers.json")
