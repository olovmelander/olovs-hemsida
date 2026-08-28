#!/usr/bin/env python3
"""Trace real course geometry for all 18 holes off the club's own hole plans.

The plans are drawn on aerial photography, which makes them geodata that nobody has
digitised yet. Two anchors per plan are already known in both frames -- the back tee
disc and the pin, whose world positions the reconciler fixed from the survey and the
card -- and two point pairs fully determine a similarity transform, so every pixel of
a plan has a world coordinate.

What makes the tracing trustworthy rather than hopeful is that twelve holes are also
surveyed in OpenStreetMap. They are used twice: their known outlines CALIBRATE the
colour classifier (sample the plan under the OSM green and you know what "green"
looks like in this cartography, no guessing), and then they VALIDATE the whole chain
-- register, classify, trace -- by comparing the traced green against the surveyed
one. The six unmapped holes are traced by exactly the machinery the twelve verified.

Run:  python3 geobuild/trace-plans.py
Reads geobuild/plan-anchors.json, writes geobuild/traced-holes.json.
"""
import json, math, os, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
model = json.load(open(os.path.join(ROOT, "geobuild/course-model.json")))
anchors = json.load(open(os.path.join(ROOT, "geobuild/plan-anchors.json")))
guide = json.load(open(os.path.join(ROOT, "geobuild/guide-holes.json")))["holes"]
inv_bunkers = {int(k): v.get("bunkers", []) for k, v in
               json.load(open(os.path.join(ROOT, "banguide/guide-inventory.json")))["holes"].items()}
osm = json.load(open(os.path.join(ROOT, "geobuild/osm-features.json")))
gps = json.load(open(os.path.join(ROOT, "geo_data/veckefjarden_clean.json")))
ORIGIN = model["origin"]
GPSPT = {}
for f in gps["features"]:
    pr = f["properties"]; lo, la = f["geometry"]["coordinates"]
    GPSPT.setdefault(int(pr["hole"]), {})[pr["name"]] = (
        (lo - ORIGIN["lon"]) * model["mPerLon"], -(la - ORIGIN["lat"]) * model["mPerLat"])

HOLES = {h["n"]: h for h in model["holes"]}
UNMAPPED = [n for n in range(1, 19) if HOLES[n]["green"]["prov"] != "osm"]
MAPPED = [n for n in range(1, 19) if HOLES[n]["green"]["prov"] == "osm"]
print("mapped (calibrate + validate):", MAPPED)
print("unmapped (to trace):", UNMAPPED)

# ---------------------------------------------------------------- registration
def refine_tee(im, px, py, r=45):
    """snap to the centroid of the orange tee disc near the given guess"""
    h, w, _ = im.shape
    x0, x1 = max(0, px - r), min(w, px + r)
    y0, y1 = max(0, py - r), min(h, py + r)
    c = im[y0:y1, x0:x1]
    R, G, B = c[:, :, 0].astype(int), c[:, :, 1].astype(int), c[:, :, 2].astype(int)
    m = (R > 190) & (G > 110) & (G < 205) & (B < 110) & (R > B + 80)
    if m.sum() < 8:
        return px, py, False
    ys, xs = np.nonzero(m)
    return x0 + int(xs.mean()), y0 + int(ys.mean()), True


class Reg:
    """similarity transform plan-pixels -> world metres, from the two anchors"""
    def __init__(self, teePx, pinPx, teeW, pinW):
        P1, P2 = complex(*teePx), complex(*pinPx)
        W1, W2 = complex(*teeW), complex(*pinW)
        self.a = (W2 - W1) / (P2 - P1)
        self.b = W1 - self.a * P1
        self.scale = abs(self.a)                      # metres per pixel

    def to_world(self, px, py):
        w = self.a * complex(px, py) + self.b
        return w.real, w.imag

    def to_px(self, x, z):
        p = (complex(x, z) - self.b) / self.a
        return p.real, p.imag


# ------------------------------------------------------------- geometry helpers
def poly_len(L):
    return sum(math.hypot(L[i + 1][0] - L[i][0], L[i + 1][1] - L[i][1]) for i in range(len(L) - 1))

def dist_to_line(px, pz, L):
    best = 1e18
    for i in range(len(L) - 1):
        ax, az = L[i]; bx, bz = L[i + 1]
        dx, dz = bx - ax, bz - az
        L2 = dx * dx + dz * dz
        t = 0 if L2 == 0 else max(0, min(1, ((px - ax) * dx + (pz - az) * dz) / L2))
        best = min(best, math.hypot(px - (ax + dx * t), pz - (az + dz * t)))
    return best

def point_in_poly(x, z, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, zi = ring[i]; xj, zj = ring[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            inside = not inside
        j = i
    return inside

def centroid(ring):
    a = cx = cz = 0.0
    j = len(ring) - 1
    for i in range(len(ring)):
        f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
        a += f; cx += (ring[j][0] + ring[i][0]) * f; cz += (ring[j][1] + ring[i][1]) * f
        j = i
    if abs(a) < 1e-9:
        return (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))
    return (cx / (3 * a), cz / (3 * a))

def simplify(L, tol):
    if len(L) < 3:
        return L
    keep = [False] * len(L)
    keep[0] = keep[-1] = True
    stack = [(0, len(L) - 1)]
    while stack:
        a, b = stack.pop()
        far, fd = -1, tol
        ax, az = L[a]; bx, bz = L[b]
        for i in range(a + 1, b):
            dx, dz = bx - ax, bz - az
            L2 = dx * dx + dz * dz
            t = 0 if L2 == 0 else max(0, min(1, ((L[i][0] - ax) * dx + (L[i][1] - az) * dz) / L2))
            d = math.hypot(L[i][0] - (ax + dx * t), L[i][1] - (az + dz * t))
            if d > fd:
                fd, far = d, i
        if far > 0:
            keep[far] = True
            stack.append((a, far)); stack.append((far, b))
    return [p for p, k in zip(L, keep) if k]


# ------------------------------------------------- world-grid corridor sampling
CELL = 1.0

def corridor_grid(hole):
    line = hole["line"]
    xs = [p[0] for p in line]; zs = [p[1] for p in line]
    gx, gz = hole["green"]["c"]
    x0, x1 = min(min(xs), gx) - 70, max(max(xs), gx) + 70
    z0, z1 = min(min(zs), gz) - 70, max(max(zs), gz) + 70
    nx, nz = int((x1 - x0) / CELL) + 1, int((z1 - z0) / CELL) + 1
    return x0, z0, nx, nz

def feat(rgb):
    """chromaticity + brightness: the plans are vignetted, so raw RGB mixes 'what
    colour is this grass' with 'how far from the page centre is it'. Chromaticity is
    stable under that fade; brightness is kept as a third, weaker axis."""
    rgb = np.asarray(rgb, dtype=float)
    tot = rgb.sum(axis=-1, keepdims=True) + 1e-6
    r = rgb[..., 0:1] / tot * 255.0
    g = rgb[..., 1:2] / tot * 255.0
    v = tot / 3.0
    return np.concatenate([r, g, v * 0.45], axis=-1)


def sample_classes(im, reg, hole, cal):
    """classify every corridor cell of the plan into rough/fairway/green/sand"""
    h, w, _ = im.shape
    x0, z0, nx, nz = corridor_grid(hole)
    gx, gz = np.meshgrid(np.arange(nx), np.arange(nz))
    wx = x0 + gx * CELL
    wz = z0 + gz * CELL
    # inverse similarity, vectorised
    a, b = reg.a, reg.b
    W = wx + 1j * wz
    P = (W - b) / a
    px = np.round(P.real).astype(int)
    py = np.round(P.imag).astype(int)
    ok = (px >= 1) & (px < w - 1) & (py >= 1) & (py < h - 1)
    pxc = np.clip(px, 1, w - 2); pyc = np.clip(py, 1, h - 2)
    # 3x3 mean, cheap
    C = np.zeros((nz, nx, 3))
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            C += im[pyc + dy, pxc + dx]
    C /= 9.0
    F = feat(C)
    # nearest calibrated class by variance-scaled distance
    names = list(cal.keys())
    D = np.stack([(((F - cal[k]["mean"]) / cal[k]["std"]) ** 2).sum(axis=2) for k in names])
    cls = np.argmin(D, axis=0)
    # the page's own furniture is not ground: the white centre line, the distance
    # arcs, the vignette that fades everything to paper at the frame's edge
    paper = (C.min(axis=2) > 192) & (C.max(axis=2) - C.min(axis=2) < 46)
    cls[paper] = names.index("rough")
    cls[~ok] = names.index("rough")
    # only near the hole: everything else is a neighbouring hole's drawing
    line = hole["line"]
    near = np.zeros((nz, nx), bool)
    for j in range(nz):
        for i in range(0, nx, 4):
            if dist_to_line(x0 + i, z0 + j, line) < 62 or \
               math.hypot(x0 + i - hole["green"]["c"][0], z0 + j - hole["green"]["c"][1]) < 45:
                near[j, max(0, i - 2):i + 3] = True
    cls[~near] = names.index("rough")
    return cls, names, (x0, z0, nx, nz), C, F


def binary_clean(mask, close=2, open_=1):
    m = mask.copy()
    def dil(m):
        r = m.copy()
        r[1:, :] |= m[:-1, :]; r[:-1, :] |= m[1:, :]
        r[:, 1:] |= m[:, :-1]; r[:, :-1] |= m[:, 1:]
        return r
    def ero(m):
        r = m.copy()
        r[1:, :] &= m[:-1, :]; r[:-1, :] &= m[1:, :]
        r[:, 1:] &= m[:, :-1]; r[:, :-1] &= m[:, 1:]
        return r
    for _ in range(close):
        m = dil(m)
    for _ in range(close + open_):
        m = ero(m)
    for _ in range(open_):
        m = dil(m)
    return m


def components(mask):
    lab = np.zeros(mask.shape, int)
    cur = 0
    for j0, i0 in zip(*np.nonzero(mask & (lab == 0))):
        if lab[j0, i0]:
            continue
        cur += 1
        stack = [(j0, i0)]
        lab[j0, i0] = cur
        while stack:
            j, i = stack.pop()
            for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                jj, ii = j + dj, i + di
                if 0 <= jj < mask.shape[0] and 0 <= ii < mask.shape[1] \
                   and mask[jj, ii] and not lab[jj, ii]:
                    lab[jj, ii] = cur
                    stack.append((jj, ii))
    return lab, cur


def boundary(mask):
    """Moore boundary trace of the largest blob edge, as a pixel ring"""
    ys, xs = np.nonzero(mask)
    if not len(ys):
        return []
    start = (ys[0], xs[0])
    # walk to the top-left edge of the blob
    j, i = start
    while i > 0 and mask[j, i - 1]:
        i -= 1
    DIRS = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]
    ring = [(j, i)]
    d = 6                                            # came from the left
    cj, ci = j, i
    for _ in range(mask.size):
        found = False
        for k in range(8):
            nd = (d + 5 + k) % 8                      # backtrack + clockwise
            jj, ii = cj + DIRS[nd][0], ci + DIRS[nd][1]
            if 0 <= jj < mask.shape[0] and 0 <= ii < mask.shape[1] and mask[jj, ii]:
                cj, ci, d = jj, ii, nd
                found = True
                break
        if not found:
            break
        if (cj, ci) == ring[0] and len(ring) > 2:
            break
        ring.append((cj, ci))
    return ring


def trace_blobs(cls, names, frame, want, min_area, near_pt=None, near_r=None,
                max_keep=8, mask_override=None):
    x0, z0, nx, nz = frame
    mask = mask_override if mask_override is not None else (cls == names.index(want))
    if near_pt is not None:
        gx, gz = np.meshgrid(np.arange(nx), np.arange(nz))
        wx = x0 + gx * CELL
        wz = z0 + gz * CELL
        mask = mask & (np.hypot(wx - near_pt[0], wz - near_pt[1]) < near_r)
    mask = binary_clean(mask, close=2, open_=1)
    lab, n = components(mask)
    out = []
    for c in range(1, n + 1):
        m = lab == c
        area = int(m.sum()) * CELL * CELL
        if area < min_area:
            continue
        ring_px = boundary(m)
        ring = [(x0 + i * CELL, z0 + j * CELL) for j, i in ring_px]
        ring = simplify(ring, 1.3)
        if len(ring) < 4:
            continue
        out.append({"ring": [[round(x, 1), round(z, 1)] for x, z in ring],
                    "area": area, "c": [round(v, 1) for v in centroid(ring)]})
    out.sort(key=lambda r: -r["area"])
    return out[:max_keep]


# ------------------------------------------------------------------ calibration
print("\ncalibrating the classifier on the surveyed holes...")
samples = {"green": [], "fairway": [], "sand": [], "rough": []}
regs = {}
rot_err = {}

for n in range(1, 19):
    A = anchors[str(n)]
    img_path = os.path.join(ROOT, f"banguide/maps/hole_{n:02d}.jpg")
    im = np.asarray(Image.open(img_path).convert("RGB"), dtype=np.int16)
    tx, ty, snapped = refine_tee(im, *A["teePx"])
    h = HOLES[n]
    reg = Reg((tx, ty), tuple(A["pinPx"]), tuple(h["line"][0]), tuple(h["pin"]))
    regs[n] = (reg, im)
    # the compass rose is an independent witness to the rotation
    up = guide[str(n)]["upDeg"]
    v = reg.a * complex(0, -1)                        # image "up" in world
    got = math.degrees(math.atan2(v.real, -v.imag))   # bearing convention: atan2(dx,-dz)
    err = (got - up + 540) % 360 - 180
    rot_err[n] = err
    flag = "" if abs(err) < 25 else "  <-- SUSPECT REGISTRATION"
    print(f"  hole {n:2d}: {reg.scale:.3f} m/px, rose disagrees {err:+.0f} deg, tee-snap {'y' if snapped else 'n'}{flag}")

for n in MAPPED:
    reg, im = regs[n]
    h = HOLES[n]
    def sample_ring(rings, into, inset_ok):
        for ring in rings:
            xs = [p[0] for p in ring]; zs = [p[1] for p in ring]
            for x in np.arange(min(xs), max(xs), 2.5):
                for z in np.arange(min(zs), max(zs), 2.5):
                    if point_in_poly(x, z, ring):
                        px, py = reg.to_px(x, z)
                        px, py = int(px), int(py)
                        if 1 < px < im.shape[1] - 1 and 1 < py < im.shape[0] - 1:
                            into.append(im[py, px])
    sample_ring([h["green"]["ring"]], samples["green"], True)
    sample_ring(h["fairway"]["rings"], samples["fairway"], True)
    sample_ring([b["ring"] for b in h["bunkers"] if b.get("prov") != "guide"], samples["sand"], True)
    # rough: a ring of points 35-50 m off the line, away from every feature
    for f in np.arange(0.15, 0.95, 0.1):
        # walk the line
        line = h["line"]; tot = poly_len(line); d = f * tot
        for i in range(len(line) - 1):
            seg = math.hypot(line[i+1][0]-line[i][0], line[i+1][1]-line[i][1])
            if d <= seg:
                t = d / seg
                x = line[i][0] + (line[i+1][0]-line[i][0]) * t
                z = line[i][1] + (line[i+1][1]-line[i][1]) * t
                b = math.atan2(line[i+1][0]-line[i][0], line[i+1][1]-line[i][1])
                for side in (-1, 1):
                    rx, rz = -math.cos(b) * side, math.sin(b) * side
                    px, py = reg.to_px(x + rx * 42, z + rz * 42)
                    px, py = int(px), int(py)
                    if 1 < px < im.shape[1] - 1 and 1 < py < im.shape[0] - 1:
                        samples["rough"].append(im[py, px])
                break
            d -= seg

cal = {}
for k, v in samples.items():
    a = feat(np.array(v, dtype=float))
    # a wide std makes a class a catch-all under variance-scaled distance: rough's
    # sample mixes forest with heath and would otherwise swallow every pixel
    cal[k] = {"mean": a.mean(axis=0),
              "std": np.clip(a.std(axis=0), [3.0, 3.0, 9.0], [10.0, 12.0, 22.0])}
    print(f"  {k:8s} n={len(v):5d}  mean {np.round(cal[k]['mean'],1)}  std {np.round(cal[k]['std'],1)}")

def grow(C, F, frame, seeds, tol, rmax_pt=None, rmax=None):
    """Region-grow a mask from colour seeds. Each seed contributes its own local
    colour, read off THIS plan at a place that is known to be the target surface --
    the pin for a green, the centre line for a fairway -- so the classifier
    recalibrates itself per plan and the vignette and per-page grading stop
    mattering. The white centre line splits every green it crosses, so seeds are
    planted on both sides and the halves are closed back together afterwards."""
    x0, z0, nx, nz = frame
    paper = (C.min(axis=2) > 192) & (C.max(axis=2) - C.min(axis=2) < 46)
    mask = np.zeros((nz, nx), bool)
    tol = np.asarray(tol, dtype=float)
    for (sx, sz) in seeds:
        i0, j0 = int((sx - x0) / CELL), int((sz - z0) / CELL)
        if not (0 <= i0 < nx and 0 <= j0 < nz) or paper[j0, i0]:
            continue
        # seed colour: a small disc around the seed, paper excluded
        ii, jj = np.meshgrid(np.arange(max(0, i0 - 4), min(nx, i0 + 5)),
                             np.arange(max(0, j0 - 4), min(nz, j0 + 5)))
        sel = ~paper[jj, ii]
        if sel.sum() < 4:
            continue
        seed_mean = F[jj[sel], ii[sel]].mean(axis=0)
        ok = ((np.abs(F - seed_mean) / tol) ** 2).sum(axis=2) < 1.0
        ok &= ~paper
        if rmax_pt is not None:
            gx, gz = np.meshgrid(np.arange(nx), np.arange(nz))
            ok &= np.hypot(x0 + gx * CELL - rmax_pt[0], z0 + gz * CELL - rmax_pt[1]) < rmax
        if not ok[j0, i0]:
            continue
        stack = [(j0, i0)]
        seen = mask
        add = np.zeros_like(mask)
        add[j0, i0] = True
        while stack:
            j, i = stack.pop()
            for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                jn, in_ = j + dj, i + di
                if 0 <= jn < nz and 0 <= in_ < nx and ok[jn, in_] and not add[jn, in_] and not mask[jn, in_]:
                    add[jn, in_] = True
                    stack.append((jn, in_))
        mask |= add
    return mask


TOL_GREEN = [12.5, 13.5, 48.0]
TOL_FAIR = [10.5, 12.0, 40.0]

def trace_green(C, F, frame, h):
    """The green is the greenest contiguous ground at the pin. The pin cell itself is
    useless as a seed -- the flag icon and the centre line's end are drawn right on
    it -- so the seed colour is read statistically instead: of the ground within 18 m
    of the pin, the top third by green-chromaticity is the putting surface (the
    collar and fringe are what dilute the rest), and its mean colour defines the
    surface that is then grown and traced."""
    x0, z0, nx, nz = frame
    px, pz = h["pin"]
    gx, gz = np.meshgrid(np.arange(nx), np.arange(nz))
    wx = x0 + gx * CELL
    wz = z0 + gz * CELL
    dpin = np.hypot(wx - px, wz - pz)
    paper = (C.min(axis=2) > 192) & (C.max(axis=2) - C.min(axis=2) < 46)
    reddish = (C[:, :, 0] > C[:, :, 1] + 30)          # the flag cloth
    seedable = (dpin < 18) & ~paper & ~reddish
    if seedable.sum() < 30:
        return None
    gch = F[:, :, 1]
    cut = np.percentile(gch[seedable], 58)
    core = seedable & (gch >= cut)
    seed_mean = F[core].mean(axis=0)
    tol = np.asarray(TOL_GREEN)
    ok = (((F - seed_mean) / tol) ** 2).sum(axis=2) < 1.0
    ok &= (dpin < 42)
    # The plan draws its own furniture over the green: a four-metre-wide white centre
    # line, the flag, NEXT TEE labels. Those cells are not evidence against the green,
    # they are just covered, so they may join the mask when the ground around them
    # does: a covered cell within the pin disc whose neighbourhood is mostly mask
    # gets filled, iteratively, before components are counted.
    covered = (paper | reddish) & (dpin < 42)
    ok &= ~paper & ~reddish
    m = binary_clean(ok, close=2, open_=1)
    for _ in range(6):
        nb = np.zeros(m.shape, dtype=int)
        nb[1:, :] += m[:-1, :]; nb[:-1, :] += m[1:, :]
        nb[:, 1:] += m[:, :-1]; nb[:, :-1] += m[:, 1:]
        nb[1:, 1:] += m[:-1, :-1]; nb[:-1, :-1] += m[1:, 1:]
        nb[1:, :-1] += m[:-1, 1:]; nb[:-1, 1:] += m[1:, :-1]
        grownew = covered & (nb >= 3) & ~m
        if not grownew.any():
            break
        m = m | grownew
    m = binary_clean(m, close=2, open_=1)
    lab, n = components(m)
    cands = []
    for c in range(1, n + 1):
        blob = lab == c
        area = int(blob.sum())
        if area < 110:
            continue
        ring_px = boundary(blob)
        ring = simplify([(x0 + i * CELL, z0 + j * CELL) for j, i in ring_px], 1.2)
        if len(ring) < 4:
            continue
        cx, cz = centroid(ring)
        cands.append({"ring": [[round(x, 1), round(z, 1)] for x, z in ring],
                      "area": area, "c": [round(cx, 1), round(cz, 1)],
                      "d": math.hypot(cx - px, cz - pz)})
    if os.environ.get("TRACE_DEBUG"):
        print(f"    [green] ok={int(ok.sum())} m={int(m.sum())} comps={n} cands="
              + str([(c['area'], round(c['d'], 1)) for c in cands]))
    cands = [c for c in cands if c["d"] < 30]
    if not cands:
        return None
    # the line and the labels can leave the green in two or three pieces even after
    # healing; the pieces near the pin are one green, so trace their union
    if len(cands) > 1:
        um = np.zeros(m.shape, bool)
        for c in range(1, n + 1):
            blob = lab == c
            area = int(blob.sum())
            if area < 90:
                continue
            js, is_ = np.nonzero(blob)
            cx = x0 + is_.mean() * CELL; cz = z0 + js.mean() * CELL
            if math.hypot(cx - px, cz - pz) < 30:
                um |= blob
        um = binary_clean(um, close=4, open_=1)
        lab2, n2 = components(um)
        sizes = [(int((lab2 == c).sum()), c) for c in range(1, n2 + 1)]
        if sizes:
            blob = lab2 == max(sizes)[1]
            ring_px = boundary(blob)
            ring = simplify([(x0 + i * CELL, z0 + j * CELL) for j, i in ring_px], 1.2)
            if len(ring) >= 4:
                cx, cz = centroid(ring)
                if math.hypot(cx - px, cz - pz) < 30:
                    return {"ring": [[round(x, 1), round(z, 1)] for x, z in ring],
                            "area": int(blob.sum()), "c": [round(cx, 1), round(cz, 1)]}
    best = max(cands, key=lambda c: c["area"])
    best.pop("d", None)
    return best


def trace_fairway(C, F, frame, h):
    """seeded every 25 m down the middle of the hole, each seed with its own local
    colour; the union is the mown corridor as this plan draws it"""
    if h["par"] == 3:
        return []
    line = h["line"]
    tot = poly_len(line)
    seeds = []
    f = 120.0 / tot if tot > 260 else 0.35
    while f < 0.93:
        d = f * tot
        for i in range(len(line) - 1):
            seg = math.hypot(line[i+1][0]-line[i][0], line[i+1][1]-line[i][1])
            if d <= seg:
                t = d / seg
                cx = line[i][0] + (line[i+1][0]-line[i][0]) * t
                cz = line[i][1] + (line[i+1][1]-line[i][1]) * t
                b = math.atan2(line[i+1][0]-line[i][0], line[i+1][1]-line[i][1])
                # not ON the line: the centre line is painted white on every plan,
                # and a seed on paper grows nothing
                for off in (-14, -8, -4, 4, 8, 14):
                    seeds.append((cx + -math.cos(b) * off, cz + math.sin(b) * off))
                break
            d -= seg
        f += 25.0 / tot
    m = grow(C, F, frame, seeds, TOL_FAIR)
    # keep it a corridor: nothing past 45 m of the line survives into the fairway
    x0, z0, nx, nz = frame
    gx, gz = np.meshgrid(np.arange(nx), np.arange(nz))
    keep = np.zeros((nz, nx), bool)
    for j in range(nz):
        for i in range(0, nx, 3):
            if dist_to_line(x0 + i * CELL, z0 + j * CELL, line) < 45:
                keep[j, max(0, i - 1):i + 2] = True
    m &= keep
    m = binary_clean(m, close=3, open_=1)
    lab, n = components(m)
    out = []
    for c in range(1, n + 1):
        blob = lab == c
        area = int(blob.sum())
        if area < 420:
            continue
        ring_px = boundary(blob)
        ring = simplify([(x0 + i * CELL, z0 + j * CELL) for j, i in ring_px], 1.4)
        if len(ring) < 4:
            continue
        cx, cz = centroid(ring)
        out.append({"ring": [[round(x, 1), round(z, 1)] for x, z in ring],
                    "area": area, "c": [round(cx, 1), round(cz, 1)]})
    out.sort(key=lambda r: -r["area"])
    return out[:6]


# ------------------------------------------------------------------ validation# ------------------------------------------------------------------ validation
print("\nvalidating the whole chain on the surveyed holes (never entered calibration shapes' positions):")
val = []
for n in MAPPED:
    reg, im = regs[n]
    h = HOLES[n]
    cls, names, frame, C, F = sample_classes(im, reg, h, cal)
    g = trace_green(C, F, frame, h)
    if not g:
        print(f"  hole {n:2d}: NO green traced")
        continue
    dc = math.hypot(g["c"][0] - centroid(h["green"]["ring"])[0], g["c"][1] - centroid(h["green"]["ring"])[1])
    ratio = g["area"] / max(1, abs(sum(
        (h["green"]["ring"][j][0] + h["green"]["ring"][i][0]) * (h["green"]["ring"][j][1] - h["green"]["ring"][i][1])
        for i, j in zip(range(len(h["green"]["ring"])), [-1] + list(range(len(h["green"]["ring"]) - 1)))) / 2))
    val.append((n, dc, ratio))
    print(f"  hole {n:2d}: traced green centre {dc:5.1f} m off the survey, area x{ratio:4.2f}")
good = [v for v in val if v[1] < 12 and 0.5 < v[2] < 2.0]
print(f"  => {len(good)}/{len(val)} within 12 m and half-to-double area")

# ------------------------------------------------------------------ tracing
print("\ntracing the unmapped holes:")
out = {}
for n in UNMAPPED:
    reg, im = regs[n]
    h = HOLES[n]
    cls, names, frame, C, F = sample_classes(im, reg, h, cal)
    g = trace_green(C, F, frame, h)
    fairways = trace_fairway(C, F, frame, h)
    fairways = [f for f in fairways
                if math.hypot(f["c"][0] - h["pin"][0], f["c"][1] - h["pin"][1]) > 30]
    bunkers = trace_blobs(cls, names, frame, "sand", 12, max_keep=14)
    # near the corridor, not on the green, not micro-noise; and the guide knows how
    # many this hole has, so the count is capped by its inventory rather than by hope
    bunkers = [b for b in bunkers
               if b["area"] <= 650
               and dist_to_line(b["c"][0], b["c"][1], h["line"]) < 48
               and not (g and point_in_poly(b["c"][0], b["c"][1], g["ring"]))]
    guide_n = len(inv_bunkers.get(n, []))
    bunkers.sort(key=lambda b: -b["area"])
    bunkers = bunkers[:max(guide_n + 1, 2)]
    # the survey knows this green's depth (front to back); a trace that disagrees
    # badly is a trace of something else, and the GPS ellipse serves instead
    note = "traced"
    if g:
        P = GPSPT[n]
        F_, B_ = P["Green Front"], P["Green Back"]
        depth_gps = math.hypot(B_[0] - F_[0], B_[1] - F_[1])
        ax = math.atan2(B_[0] - F_[0], B_[1] - F_[1])
        ext = [((q[0] - g["c"][0]) * math.sin(ax) + (q[1] - g["c"][1]) * math.cos(ax)) for q in g["ring"]]
        depth_traced = max(ext) - min(ext)
        if depth_gps > 6 and not (0.55 < depth_traced / depth_gps < 1.9):
            note = f"rejected (depth {depth_traced:.0f} m vs survey {depth_gps:.0f} m)"
            g = None
    out[str(n)] = {
        "green": g, "fairways": fairways, "bunkers": bunkers,
        "scale": round(reg.scale, 3), "rotErr": round(rot_err[n], 1),
    }
    print(f"  hole {n:2d}: green {note if g or 'rejected' in note else 'MISSED'}, {len(fairways)} fairway pieces, {len(bunkers)} bunkers")

# draw what was traced back onto each plan, for the eye
from PIL import ImageDraw
SHOTS = os.path.join(ROOT, "geobuild", "shots")
os.makedirs(SHOTS, exist_ok=True)
for n in UNMAPPED:
    reg, im = regs[n]
    img = Image.fromarray(im.astype(np.uint8))
    d = ImageDraw.Draw(img)
    def draw_ring(ring, col, wdt=4):
        pts = [reg.to_px(*q) for q in ring] + [reg.to_px(*ring[0])]
        d.line(pts, fill=col, width=wdt)
    tr = out[str(n)]
    for f in tr["fairways"]:
        draw_ring(f["ring"], (60, 120, 255))
    for b_ in tr["bunkers"]:
        draw_ring(b_["ring"], (255, 140, 0))
    if tr["green"]:
        draw_ring(tr["green"]["ring"], (255, 0, 255))
    img.resize((800, 1000), Image.LANCZOS).save(os.path.join(SHOTS, f"trace{n:02d}.png"))

json.dump({
    "note": "geometry traced off the club's hole plans, registered by tee+pin anchors; "
            "validated against the 12 OSM-surveyed holes before the 6 unmapped ones were trusted",
    "validation": [{"hole": n, "centreErr": round(d, 1), "areaRatio": round(r, 2)} for n, d, r in val],
    "holes": out,
}, open(os.path.join(ROOT, "geobuild/traced-holes.json"), "w"))
print("\nwrote geobuild/traced-holes.json")
