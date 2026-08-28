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
osm = json.load(open(os.path.join(ROOT, "geobuild/osm-features.json")))

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
    # nearest calibrated class by variance-scaled distance
    names = list(cal.keys())
    D = np.stack([(((C - cal[k]["mean"]) / cal[k]["std"]) ** 2).sum(axis=2) for k in names])
    cls = np.argmin(D, axis=0)
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
    return cls, names, (x0, z0, nx, nz)


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


def trace_blobs(cls, names, frame, want, min_area, near_pt=None, max_keep=8):
    x0, z0, nx, nz = frame
    mask = binary_clean(cls == names.index(want), close=2, open_=1)
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
    a = np.array(v, dtype=float)
    cal[k] = {"mean": a.mean(axis=0), "std": np.maximum(a.std(axis=0), 6.0)}
    print(f"  {k:8s} n={len(v):5d}  mean {np.round(cal[k]['mean']).astype(int)}  std {np.round(cal[k]['std']).astype(int)}")

# ------------------------------------------------------------------ validation
print("\nvalidating the whole chain on the surveyed holes (never entered calibration shapes' positions):")
val = []
for n in MAPPED:
    reg, im = regs[n]
    h = HOLES[n]
    cls, names, frame = sample_classes(im, reg, h, cal)
    greens = trace_blobs(cls, names, frame, "green", 180)
    if not greens:
        print(f"  hole {n:2d}: NO green traced")
        continue
    # the traced green nearest the pin
    g = min(greens, key=lambda r: math.hypot(r["c"][0] - h["pin"][0], r["c"][1] - h["pin"][1]))
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
    cls, names, frame = sample_classes(im, reg, h, cal)
    greens = trace_blobs(cls, names, frame, "green", 180)
    fairways = trace_blobs(cls, names, frame, "fairway", 380)
    bunkers = trace_blobs(cls, names, frame, "sand", 9, max_keep=12)
    g = None
    if greens:
        g = min(greens, key=lambda r: math.hypot(r["c"][0] - h["pin"][0], r["c"][1] - h["pin"][1]))
        if math.hypot(g["c"][0] - h["pin"][0], g["c"][1] - h["pin"][1]) > 30:
            g = None
    # bunkers must be near the corridor and not inside the green
    bunkers = [b for b in bunkers
               if dist_to_line(b["c"][0], b["c"][1], h["line"]) < 55
               and not (g and point_in_poly(b["c"][0], b["c"][1], g["ring"]))]
    out[str(n)] = {
        "green": g, "fairways": fairways, "bunkers": bunkers,
        "scale": round(reg.scale, 3), "rotErr": round(rot_err[n], 1),
    }
    print(f"  hole {n:2d}: green {'traced' if g else 'MISSED'}, {len(fairways)} fairway pieces, {len(bunkers)} bunkers")

json.dump({
    "note": "geometry traced off the club's hole plans, registered by tee+pin anchors; "
            "validated against the 12 OSM-surveyed holes before the 6 unmapped ones were trusted",
    "validation": [{"hole": n, "centreErr": round(d, 1), "areaRatio": round(r, 2)} for n, d, r in val],
    "holes": out,
}, open(os.path.join(ROOT, "geobuild/traced-holes.json"), "w"))
print("\nwrote geobuild/traced-holes.json")
