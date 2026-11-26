"""Measured surface tracing from RGBI orthophotos and the 1 m laser terrain.

Reusable by every ground. Runs in the locked Pixi `mapping` environment. It
turns a reviewed decisions file (which green, which tee platform, which route)
into EPSG:3006 outlines whose edges are measured on the photo:

  * `classify_turf`   a quadratic softmax trained on verified outlines of the
                      same flight, so one reviewed course can label its sibling.
  * `extract_sand`    raked bunkers and unraked waste areas, islands kept.
  * `tee_platforms`   flat raised platforms read from the 1 m laser terrain.
  * `refine_ring`     snaps an approximate ring to the strongest inside/outside
                      edge on the photo. The channel is chosen per outline by a
                      Fisher discriminant, the ring by a closed dynamic program.

Nothing here decides what a surface IS: identity comes from the decisions file,
and every outline carries its own edge statistics so a weak one can be reviewed.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import rasterize, shapes
from rasterio.transform import from_origin
from rasterio.windows import from_bounds
from scipy import ndimage as nd
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, shape
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from shapely.validation import make_valid


# ---------------------------------------------------------------- imagery

class Imagery:
    """Best-resolution-first mosaic over cached RGBI GeoTIFFs (EPSG:3006)."""

    def __init__(self, paths):
        self.paths = [Path(p) for p in paths]
        for p in self.paths:
            with rasterio.open(p) as src:
                if src.crs is None or src.crs.to_epsg() != 3006 or src.count < 4:
                    raise ValueError(f'{p}: expected a 4-band EPSG:3006 RGBI raster')

    def read(self, e0, n0, e1, n1, res=0.16):
        w = int(round((e1 - e0) / res))
        h = int(round((n1 - n0) / res))
        out = np.zeros((4, h, w), np.uint8)
        have = np.zeros((h, w), bool)
        for p in self.paths:
            if have.all():
                break
            with rasterio.open(p) as src:
                b = src.bounds
                if b.right <= e0 or b.left >= e1 or b.top <= n0 or b.bottom >= n1:
                    continue
                win = from_bounds(e0, n0, e1, n1, src.transform)
                d = src.read([1, 2, 3, 4], window=win, out_shape=(4, h, w), boundless=True,
                             fill_value=0, resampling=Resampling.bilinear)
                ok = d.any(axis=0) & ~have
                out[:, ok] = d[:, ok]
                have |= ok
        return out, from_origin(e0, n1, res, res), have


def spectral(img):
    r, g, b, n = (img[i].astype(np.float32) for i in range(4))
    return dict(r=r, g=g, b=b, nir=n, br=(r + g + b) / 3, ndvi=(n - r) / (n + r + 1e-3), warm=r - b)


# ---------------------------------------------------------------- geometry

def largest(geom):
    geom = make_valid(geom) if not geom.is_valid else geom
    if geom.is_empty:
        return None
    if geom.geom_type == 'Polygon':
        return geom
    parts = [g for g in getattr(geom, 'geoms', []) if g.geom_type == 'Polygon']
    return max(parts, key=lambda g: g.area) if parts else None


def smooth_ring(xy, sigma_m, ds):
    """Circular Gaussian smoothing of an evenly sampled closed ring (no repeat point)."""
    s = sigma_m / ds
    return np.stack([nd.gaussian_filter1d(xy[:, k], s, mode='wrap') for k in range(2)], 1)


def resample_closed(coords, ds):
    xy = np.asarray(coords, float)
    if np.allclose(xy[0], xy[-1]):
        xy = xy[:-1]
    closed = np.vstack([xy, xy[:1]])
    seg = np.hypot(*np.diff(closed, axis=0).T)
    cum = np.concatenate([[0], np.cumsum(seg)])
    n = max(12, int(round(cum[-1] / ds)))
    t = np.linspace(0, cum[-1], n, endpoint=False)
    return np.stack([np.interp(t, cum, closed[:, k]) for k in range(2)], 1), cum[-1] / n


def polygon_from_mask(mask, transform, min_area, simplify=0.15):
    out = []
    for geom, v in shapes(mask.astype(np.uint8), mask=mask, transform=transform):
        p = shape(geom)
        if p.area >= min_area:
            out.append(p)
    return out


def ellipse(c, length, width, rot_deg, n=40, power=2.4):
    """Superellipse: between an ellipse and a rounded rectangle, as tee decks are mown."""
    a, b = length / 2, width / 2
    t = np.linspace(0, 2 * math.pi, n, endpoint=False)
    x = a * np.sign(np.cos(t)) * np.abs(np.cos(t)) ** (2 / power)
    y = b * np.sign(np.sin(t)) * np.abs(np.sin(t)) ** (2 / power)
    th = math.radians(rot_deg)
    return Polygon(np.stack([c[0] + x * math.cos(th) - y * math.sin(th),
                             c[1] + x * math.sin(th) + y * math.cos(th)], 1))


# ---------------------------------------------------------------- turf classifier

def turf_features(img, res):
    f = spectral(img)
    g = lambda a, m: nd.gaussian_filter(a, m / res)
    sd = lambda m: np.sqrt(np.maximum(g(f['br'] ** 2, m) - g(f['br'], m) ** 2, 0))
    bands = [f['r'], f['g'], f['b'], f['nir']]
    return np.stack([g(c, 0.6) for c in bands] + [g(c, 2.5) for c in bands] + [sd(1.0), sd(3.0)], 0).astype(np.float32)


def _quad(z, mu, sg, iu):
    z = (z - mu) / sg
    return np.concatenate([np.ones((len(z), 1), np.float32), z, z[:, iu[0]] * z[:, iu[1]]], 1)


class TurfModel:
    """Softmax over {green, fairway, other grass}; deterministic training."""

    def fit(self, samples, iterations=900, seed=1, settled=False):
        """`settled` fits to convergence (L-BFGS on the same weighted loss) instead of the fixed 900 momentum steps.

        The fixed steps are enough where the classes stand apart (a ground's verified outlines: 0.95 and up). Taught
        fairway against rough from hole lines on a drought photo, they never settle: the loss bounces between 0.5 and
        1.3 and the fairway share of the ground between 0.61 and 0.92 from one hundred steps to the next, so a hole
        line moved 2 m redrew the fairways (Tjusta, November 2026). Settled, three samples of the same labels agree on
        all but 0.9% of the ground. It is asked for by name, so every outline traced before it stays as it was."""
        x = np.concatenate(samples)
        y = np.concatenate([np.full(len(s), k) for k, s in enumerate(samples)])
        self.mu, self.sg = x.mean(0), x.std(0) + 1e-6
        self.iu = np.triu_indices(x.shape[1])
        q = _quad(x, self.mu, self.sg, self.iu)
        self.qm = np.abs(q).mean(0) + 1e-6
        q = q / self.qm
        k = len(samples)
        sw = np.array([1 / (y == c).mean() for c in range(k)])[y]
        sw = sw / sw.mean()
        onehot = np.eye(k)[y]
        w = np.zeros((q.shape[1], k))
        v = np.zeros_like(w)
        if settled:
            from scipy.optimize import minimize
            n, d = q.shape
            rows = np.arange(n)

            def loss(flat):
                wk = flat.reshape(d, k)
                z = q @ wk
                z -= z.max(1, keepdims=True)
                lse = np.log(np.exp(z).sum(1))
                p = np.exp(z - lse[:, None])
                return (float(((lse - z[rows, y]) * sw).mean() + 0.5e-4 * (wk * wk).sum()),
                        (q.T @ ((p - onehot) * sw[:, None]) / n + 1e-4 * wk).ravel())

            w = minimize(loss, w.ravel(), jac=True, method='L-BFGS-B',
                         options=dict(maxiter=4000, maxfun=8000, ftol=1e-12, gtol=1e-7)).x.reshape(d, k)
            iterations = 0
        for _ in range(iterations):
            p = q @ w
            p -= p.max(1, keepdims=True)
            p = np.exp(p)
            p /= p.sum(1, keepdims=True)
            v = 0.9 * v - 0.25 * (q.T @ ((p - onehot) * sw[:, None]) / len(y) + 1e-4 * w)
            w += v
        self.w = w
        self.accuracy = [float((((q @ w)[y == c]).argmax(1) == c).mean()) for c in range(k)]
        return self

    def predict(self, feats):
        _, h, w = feats.shape
        out = np.zeros((self.w.shape[1], h, w), np.float32)
        for r in range(0, h, 200):
            z = feats[:, r:r + 200].reshape(feats.shape[0], -1).T
            p = (_quad(z, self.mu, self.sg, self.iu) / self.qm) @ self.w
            p -= p.max(1, keepdims=True)
            p = np.exp(p)
            p /= p.sum(1, keepdims=True)
            out[:, r:r + 200] = p.T.reshape(self.w.shape[1], -1, w)
        return out


def vegetated(feats, ndvi_above=0.12):
    ndvi = (feats[7] - feats[4]) / (feats[7] + feats[4] + 1e-3)
    return (ndvi > ndvi_above) & ((feats[4] + feats[5] + feats[6]) / 3 > 58)


# ---------------------------------------------------------------- sand

INF = float('inf')
# What sand looks like on the photo, as numbers: brightness (mean of R, G, B), NDVI and warmth (R - B).
# A core pixel is inside every band; the patch grows over pixels inside the looser `grow` bands. These are
# Bro Hof's, measured on its June 2025 photo. A ground whose sand is another colour states its own,
# measured on its own photo, as `sand` in its trace-config.json (`sand_spec`), never by editing these.
SAND_BANDS = {
    # Crushed white marble and washed sand: bright, neutral, no vegetation signal.
    'bunker': dict(core=dict(brightness=[188, INF], ndviBelow=0.02, warmth=[2, 20]),
                   grow=dict(brightness=[158, INF], ndviBelow=0.06, warmth=[-INF, INF])),
    # Unraked waste sand: tan, darker, warmer; islands of fescue kept as holes.
    'waste_sand': dict(core=dict(brightness=[120, 188], ndviBelow=-0.12, warmth=[13, INF]),
                       grow=dict(brightness=[104, INF], ndviBelow=-0.02, warmth=[5, INF])),
}
SAND_SHAPE = {
    'bunker': dict(open=1, close=2, core_m2=3, min_m2=5, island_m2=1.2, res=0.16, tile=400, pad=60),
    'waste_sand': dict(open=2, close=3, core_m2=120, min_m2=250, island_m2=4, res=0.25, tile=500, pad=300),
}


def band_test(bands):
    lo, hi = (float(v) for v in bands['brightness'])
    wlo, whi = (float(v) for v in bands['warmth'])
    below = float(bands['ndviBelow'])
    return lambda br, nd_, w: (br > lo) & (br < hi) & (nd_ < below) & (w > wlo) & (w < whi)


def sand_spec(kind, measured=None):
    """The extraction spec for `kind`: the default bands, or a ground's own (`measured`, from its trace-config).

    `measured` replaces the bands it names (`core`, `grow`) and nothing else; the shape (opening, smallest
    patch, tile) stays the tracer's."""
    bands = {**SAND_BANDS[kind], **{k: v for k, v in (measured or {}).items() if k in ('core', 'grow')}}
    return dict(core=band_test(bands['core']), grow=band_test(bands['grow']), **SAND_SHAPE[kind])


SAND = {kind: sand_spec(kind) for kind in SAND_BANDS}


def extract_sand(imagery, box, kind, measured=None):
    """`pad` must exceed the widest object's reach past a tile, or a large waste area is cut at the window edge.

    `measured` is the ground's own sand bands for `kind` (see `sand_spec`), when it has them."""
    spec = sand_spec(kind, measured)
    res, tile, pad = spec['res'], spec['tile'], spec['pad']
    e0, n0, e1, n1 = box
    found = []
    for te in np.arange(e0, e1, tile):
        for tn in np.arange(n0, n1, tile):
            img, tr, have = imagery.read(te - pad, tn - pad, te + tile + pad, tn + tile + pad, res)
            if not have.any():
                continue
            f = spectral(img)
            br = nd.gaussian_filter(f['br'], 1.2)
            ndv = nd.gaussian_filter(f['ndvi'], 1.2)
            warm = nd.gaussian_filter(f['warm'], 1.5)
            core = have & spec['core'](br, ndv, warm)
            grow = have & spec['grow'](br, ndv, warm)
            grow = nd.binary_closing(nd.binary_opening(grow, iterations=spec['open']), iterations=spec['close'])
            lab, _ = nd.label(grow)
            keep = np.unique(lab[core & grow])
            keep = keep[keep > 0]
            if not len(keep):
                continue
            counts = nd.sum(core, lab, keep)
            objs = nd.find_objects(lab)
            for k, cc in zip(keep, counts):
                if cc * res * res < spec['core_m2']:
                    continue
                sl = objs[k - 1]
                sub = lab[sl] == k
                holes = nd.binary_fill_holes(sub) & ~sub
                hl, hn = nd.label(holes)
                for i in range(1, hn + 1):
                    if (hl == i).sum() * res * res < spec['island_m2']:
                        sub[hl == i] = True
                t2 = tr * rasterio.Affine.translation(sl[1].start, sl[0].start)
                for p in polygon_from_mask(sub, t2, spec['min_m2']):
                    c = p.representative_point()
                    if te <= c.x < te + tile and tn <= c.y < tn + tile:
                        found.append(p)
    out = []
    merged = unary_union([p.buffer(0) for p in found]) if found else MultiPolygon()
    for p in (merged.geoms if hasattr(merged, 'geoms') else [merged]):
        # Round the pixel staircase without moving the edge: the opening and closing cancel.
        q = largest(p.buffer(0.25).buffer(-0.45).buffer(0.2))
        if q is None or q.area < spec['min_m2']:
            continue
        out.append(largest(q.simplify(0.12, preserve_topology=True)))
    return sorted(out, key=lambda q: (-round(q.centroid.y, 1), round(q.centroid.x, 1)))


# ---------------------------------------------------------------- tee platforms

def tee_platforms(height, e_origin, n_origin, box):
    """Flat decks with a lower surround, from the 1 m terrain (north-up, sample centred).

    `e_origin`/`n_origin` are the easting and northing of sample [0, 0]."""
    e0, n0, e1, n1 = box
    r0, r1 = int(n_origin - n1), int(n_origin - n0)
    c0, c1 = int(e0 - e_origin), int(e1 - e_origin)
    z = height[r0:r1 + 1, c0:c1 + 1].astype(np.float64)
    zu = nd.zoom(z, 2, order=3)
    st = (z.shape[1] - 1) / (zu.shape[1] - 1)
    tr = from_origin(e_origin + c0 - st / 2, n_origin - r0 + st / 2, st, st)
    gy, gx = np.gradient(nd.gaussian_filter(zu, 1.0), st)
    slope = np.hypot(gx, gy)
    flat = nd.binary_opening(slope < 0.045, iterations=2)
    lab, n = nd.label(flat)
    sizes = nd.sum(flat, lab, range(1, n + 1)) * st * st
    out = []
    for i, (size, ob) in enumerate(zip(sizes, nd.find_objects(lab)), 1):
        if not 18 <= size <= 900:
            continue
        ys = slice(max(0, ob[0].start - 12), ob[0].stop + 12)
        xs = slice(max(0, ob[1].start - 12), ob[1].stop + 12)
        m = nd.binary_fill_holes(nd.binary_closing(lab[ys, xs] == i, iterations=2))
        d = nd.distance_transform_edt(~m) * st
        ring = (d > 2.0) & (d < 4.0)
        zz = zu[ys, xs]
        zi = zz[m]
        lower = float((zz[ring] < zi.mean() - 0.12).mean())
        a = np.c_[np.argwhere(m) * st, np.ones(int(m.sum()))]
        co = np.linalg.lstsq(a, zi, rcond=None)[0]
        rms = float(np.sqrt(((a @ co - zi) ** 2).mean()))
        if lower < 0.5 or rms > 0.10:
            continue
        ps = polygon_from_mask(m, tr * rasterio.Affine.translation(xs.start, ys.start), 15)
        if not ps:
            continue
        p = largest(max(ps, key=lambda q: q.area).buffer(0.8).buffer(-1.4).buffer(0.6))
        if p is None or p.area < 15 or 4 * math.pi * p.area / p.length ** 2 < 0.28:
            continue
        out.append(dict(polygon=p.simplify(0.25), area=float(p.area), slopePercent=float(100 * np.hypot(co[0], co[1])),
                        planarRms=rms, lowerSurround=lower, height=float(zi.mean())))
    return out


# ---------------------------------------------------------------- outline refinement

def refine_ring(imagery, ring, reach, *, ds=0.7, res=0.16, inside_m=1.0, gap_m=1.5, outside_m=4.5, avoid=None,
                smooth_m=0.6, stiffness=0.7, passes=2):
    """Snap a closed ring to the strongest inside/outside photo edge within `reach` metres.

    Returns (Polygon, stats) or (None, stats) when the two sides are not separable."""
    poly = largest(Polygon(ring)) if not isinstance(ring, Polygon) else largest(Polygon(ring.exterior))
    stats = {}
    for step in range(passes):
        r = reach if step == 0 else max(0.8, reach * 0.5)
        b = poly.buffer(r + outside_m + 2).bounds
        img, tr, have = imagery.read(b[0], b[1], b[2], b[3], res)
        f = spectral(img)
        g = lambda a, m: nd.gaussian_filter(a, m / res)
        chan = np.stack([g(f['r'], 0.3), g(f['g'], 0.3), g(f['b'], 0.3), g(f['nir'], 0.3),
                         np.sqrt(np.maximum(g(f['br'] ** 2, 0.5) - g(f['br'], 0.5) ** 2, 0))], 0)
        rast = lambda geom: rasterize([(geom, 1)], out_shape=have.shape, transform=tr, fill=0, dtype=np.uint8).astype(bool) \
            if geom is not None and not geom.is_empty else np.zeros(have.shape, bool)
        inner = poly.buffer(-inside_m)
        if inner.is_empty:
            inner = poly.buffer(-0.3)
        mi = rast(inner) & have
        outer = poly.buffer(outside_m).difference(poly.buffer(gap_m))
        if avoid is not None:
            outer = outer.difference(avoid)
        mo = rast(outer) & have
        if mi.sum() < 60 or mo.sum() < 60:
            return None, dict(reason='too few pixels')
        xi, xo = chan[:, mi].T, chan[:, mo].T
        med = np.median(xi, 0)
        keep = np.abs(xi - med).sum(1) < np.percentile(np.abs(xi - med).sum(1), 92)
        xi = xi[keep]
        sw = np.cov(xi.T) + np.cov(xo.T) + np.eye(5) * 0.5
        w = np.linalg.solve(sw, xi.mean(0) - xo.mean(0))
        pi, po = xi @ w, xo @ w
        dprime = float((pi.mean() - po.mean()) / math.sqrt(0.5 * (pi.var() + po.var()) + 1e-9))
        score = np.tensordot(w, chan, axes=1)
        scale = abs(pi.mean() - po.mean()) + 1e-6
        score = (score - po.mean()) / scale
        xy, d = resample_closed(poly.exterior.coords, ds)
        xy = smooth_ring(xy, 0.5, d)
        tan = np.roll(xy, -1, 0) - np.roll(xy, 1, 0)
        tan /= np.hypot(*tan.T)[:, None] + 1e-9
        nor = np.stack([tan[:, 1], -tan[:, 0]], 1)
        if Polygon(xy).exterior.is_ccw is False:
            nor = -nor
        step_o = 0.1
        offs = np.arange(-r - 1.2, r + 1.2 + 1e-6, step_o)
        prof = np.zeros((len(xy), len(offs)))
        for shift in (-0.4, 0.0, 0.4):
            px = xy[:, None, 0] + nor[:, None, 0] * offs[None] + tan[:, None, 0] * shift
            py = xy[:, None, 1] + nor[:, None, 1] * offs[None] + tan[:, None, 1] * shift
            col = (px - tr.c) / tr.a - 0.5
            row = (py - tr.f) / tr.e - 0.5
            prof += nd.map_coordinates(score, [row, col], order=1, mode='nearest') / 3
        k = int(round(0.8 / step_o))
        cs = np.concatenate([np.zeros((len(xy), 1)), np.cumsum(prof, 1)], 1)
        idx = np.arange(k, len(offs) - k)
        ins = (cs[:, idx] - cs[:, idx - k]) / k
        out = (cs[:, idx + k] - cs[:, idx]) / k
        edge = np.clip(ins - out, -0.5, 1.2)
        cand = offs[idx]
        sel = np.abs(cand) <= r
        edge, cand = edge[:, sel], cand[sel]
        cost = -edge + 0.12 * (cand / r) ** 2
        m, kk = cost.shape
        tw = stiffness * ((cand[:, None] - cand[None]) / d) ** 2
        best = np.tile(cost, (3, 1))
        acc = best[0].copy()
        back = np.zeros((3 * m, kk), np.int32)
        for i in range(1, 3 * m):
            tot = acc[None, :] + tw
            j = tot.argmin(1)
            back[i] = j
            acc = best[i] + tot[np.arange(kk), j]
        path = np.zeros(3 * m, np.int32)
        path[-1] = acc.argmin()
        for i in range(3 * m - 1, 0, -1):
            path[i - 1] = back[i, path[i]]
        mid = path[m:2 * m]
        o = cand[mid]
        strength = edge[np.arange(m), mid]
        new = xy + nor * o[:, None]
        new = smooth_ring(new, smooth_m, d)
        cand_poly = largest(Polygon(new).buffer(0))
        if cand_poly is None or cand_poly.area < 0.3 * poly.area:
            return None, dict(reason='collapsed')
        poly = cand_poly
        stats = dict(dPrime=round(dprime, 2), meanShift=round(float(o.mean()), 2), rmsShift=round(float(np.sqrt((o ** 2).mean())), 2),
                     weakShare=round(float((strength < 0.25).mean()), 2), meanEdge=round(float(strength.mean()), 2))
    return largest(poly.simplify(0.08)), stats


def _rounded_ring(coords, nd_):
    out = []
    for x, y in coords:
        p = [round(x, nd_), round(y, nd_)]
        if not out or p != out[-1]:   # two vertices rounding can merge
            out.append(p)
    return out


def round_coords(poly, nd_=2):
    poly = orient(poly, 1.0)
    rings = [_rounded_ring(poly.exterior.coords, nd_)]
    rings += [_rounded_ring(r.coords, nd_) for r in poly.interiors]
    return rings


def _revisits(rings):
    """True when a ring passes through one of its own vertices twice (a pinch), which a model compiler refuses."""
    vertices = [tuple(p) for r in rings for p in r[:-1]]
    return len(set(vertices)) != len(vertices)


def clean_rings(poly, nd_=2):
    """The rings of `poly`, rounded; a ring that touches itself at a point (a fairway pinched between two trees, a
    hole meeting the outline) is joined through a 1 cm neck (closed by 10 cm, opened by 9: an equal opening would
    cut the neck again), or else opened, until no vertex repeats. A polygon without a pinch comes back exactly as
    `round_coords` gives it."""
    rings = round_coords(poly, nd_)
    if not _revisits(rings):
        return rings
    for fix in (lambda p: p.buffer(0.1, join_style=2).buffer(-0.09, join_style=2), lambda p: p.buffer(-0.1, join_style=2).buffer(0.1, join_style=2)):
        q = largest(fix(poly))
        if q is not None and not q.is_empty:
            rings = round_coords(q.simplify(0.02), nd_)
            if not _revisits(rings):
                return rings
    raise ValueError('a ring that touches itself could not be cleaned')


def feature(fid, kind, poly, **props):
    return {'type': 'Feature', 'id': fid, 'properties': {'kind': kind, **props},
            'geometry': {'type': 'Polygon', 'coordinates': clean_rings(poly)}}


def collection(features, **extra):
    return {'type': 'FeatureCollection', 'crs': {'type': 'name', 'properties': {'name': 'EPSG:3006'}}, **extra, 'features': features}


def load_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')
