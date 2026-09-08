"""The registration objective: the contrast between a footprint's interior and a
2-5 m collar, maximised over a shift, exactly the objective Johannesberg's
building work found to be the one that works (CLAUDE.md, Johannesberg section).

Contrast is the distance between the interior's median (L, ExG, R/G) vector and
the collar's, in the whitening of the whole capture - so it is one number with
one unit for a dark roof over grass and a pale roof over asphalt alike, and it
does not change meaning between one shift and the next.
"""
import numpy as np
from scipy import ndimage as nd
import _bldg_lib as B
import lm2025 as L

STEP = 0.5           # the grid the objective is evaluated on, metres
SEARCH = 10.0        # half-width of the shift search, metres
COARSE = 1.0         # coarse shift quantum, metres
FINE = 0.5
INSET = 1.0          # interior is the footprint eroded by this
COLLAR = (2.0, 5.0)  # the collar, metres outside the footprint


def _sampler(E, N, sample_px):
    EE, NN = np.meshgrid(E, N)
    return B.whiten(sample_px(EE, NN))


def score_ring(ring, holes, sample_px, search=SEARCH):
    margin = COLLAR[1] + search + 2 * STEP
    E, N = B.local_grid(ring, margin, STEP)
    if len(E) * len(N) > 4_000_000:
        return None
    W = _sampler(E, N, sample_px)
    inside, interior, collar = B.masks(ring, holes, E, N, INSET, COLLAR[0], COLLAR[1], STEP)
    ri, ci = np.nonzero(interior)
    rc, cc = np.nonzero(collar)
    if len(ri) < 12 or len(rc) < 24:
        return None
    H, Wd = W.shape[:2]

    def obj(dE, dN):
        dc = int(round(dE / STEP)); dr = int(round(-dN / STEP))
        a = W[ri + dr, ci + dc]
        b = W[rc + dr, cc + dc]
        return float(np.linalg.norm(np.median(a, 0) - np.median(b, 0)))

    ks = int(round(search / COARSE))
    grid = np.zeros((2 * ks + 1, 2 * ks + 1))
    for i, dN in enumerate(np.arange(ks, -ks - 1, -1) * COARSE):
        for j, dE in enumerate(np.arange(-ks, ks + 1) * COARSE):
            grid[i, j] = obj(dE, dN)
    zero = obj(0.0, 0.0)
    pi, pj = np.unravel_index(np.argmax(grid), grid.shape)
    bE = (pj - ks) * COARSE; bN = (ks - pi) * COARSE
    onEdge = pi in (0, grid.shape[0] - 1) or pj in (0, grid.shape[1] - 1)
    # a second, finer pass around the coarse peak, then a parabolic refinement
    best = grid[pi, pj]; fE, fN = bE, bN
    if not onEdge:
        for dN in np.arange(bN - COARSE, bN + COARSE + 1e-9, FINE):
            for dE in np.arange(bE - COARSE, bE + COARSE + 1e-9, FINE):
                v = obj(dE, dN)
                if v > best:
                    best, fE, fN = v, dE, dN
        # parabolic vertex on the coarse grid (sub-quantum, smooth peak only)
        try:
            gx = grid[pi, pj - 1: pj + 2]; gy = grid[pi - 1: pi + 2, pj]
            dx = 0.5 * (gx[0] - gx[2]) / (gx[0] - 2 * gx[1] + gx[2])
            dy = 0.5 * (gy[0] - gy[2]) / (gy[0] - 2 * gy[1] + gy[2])
            if abs(dx) <= 1 and abs(dy) <= 1:
                pE = bE + dx * COARSE; pN = bN - dy * COARSE
            else:
                pE, pN = fE, fN
        except Exception:
            pE, pN = fE, fN
    else:
        pE, pN = bE, bN
    # how localised the peak is: the share of the coarse grid within 90% of it
    span = grid.max() - grid.min()
    flat = float((grid >= grid.max() - 0.1 * span).mean()) if span > 0 else 1.0
    return {'zero': zero, 'best': float(best), 'peak': float(grid.max()),
            'shiftE': float(pE), 'shiftN': float(pN),
            'coarseE': float(bE), 'coarseN': float(bN),
            'boundary': bool(onEdge), 'flatFraction': flat,
            'range': float(span), 'interiorCells': int(len(ri)),
            'collarCells': int(len(rc))}
