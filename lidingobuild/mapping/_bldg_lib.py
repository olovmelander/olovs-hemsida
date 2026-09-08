"""Shared helpers for the 2025 building check. Appended-to nothing: this is a new
module beside lm2025.py, which it imports and never edits."""
import json, math, sys
from pathlib import Path
import numpy as np
from scipy import ndimage as nd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lm2025 as L

ROOT = Path(__file__).resolve().parents[2]
CTX = ROOT / 'geo_data/course-v2/lidingo/reference/osm-context-epsg3006.geojson'


def buildings():
    ctx = json.loads(CTX.read_text(encoding='utf8'))
    out = []
    for f in ctx['features']:
        p = f['properties']
        if 'building' not in p['tags']:
            continue
        rings = L.rings_of(f['geometry'])
        out.append({'id': p['osmType'] + '/' + p['osmId'], 'tags': p['tags'],
                    'osmTimestamp': p['osmTimestamp'], 'ring': rings[0],
                    'holes': rings[1:]})
    return out


# --- the whitening the contrast is measured in --------------------------------
_WH = None


def whitener():
    """Mean and inverse-square-root covariance of (L, ExG, R/G) over the whole
    capture, subsampled 1:16 in each axis. Fixed once, so a contrast measured at
    one shift is comparable with the same contrast at another."""
    global _WH
    if _WH is None:
        img, _ = L.image()
        s = img[::16, ::16].reshape(-1, 3)
        lum, exg, rog = L.indices(s)
        X = np.stack([lum, exg, rog], 1).astype(np.float64)
        mu = X.mean(0)
        C = np.cov((X - mu).T)
        w, V = np.linalg.eigh(C)
        Wm = V @ np.diag(1.0 / np.sqrt(np.maximum(w, 1e-9))) @ V.T
        _WH = (mu, Wm, C)
    return _WH


def whiten(px):
    mu, Wm, _ = whitener()
    lum, exg, rog = L.indices(px)
    X = np.stack([lum, exg, rog], -1).astype(np.float64)
    return (X - mu) @ Wm


def local_grid(ring, margin, step):
    xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
    E = np.arange(min(xs) - margin, max(xs) + margin + step, step)
    N = np.arange(max(ys) + margin, min(ys) - margin - step, -step)
    return E, N


def masks(ring, holes, E, N, inset, collar_lo, collar_hi, step):
    EE, NN = np.meshgrid(E, N)
    inside = L.point_in_ring(EE, NN, ring)
    for h in holes:
        inside &= ~L.point_in_ring(EE, NN, h)
    ni = max(1, int(round(inset / step)))
    interior = nd.binary_erosion(inside, np.ones((3, 3)), iterations=ni)
    d_out = nd.distance_transform_edt(~inside) * step
    collar = (d_out >= collar_lo) & (d_out <= collar_hi)
    return inside, interior, collar
