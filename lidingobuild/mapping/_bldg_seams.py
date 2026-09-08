"""The mosaic's own seam polygons, from the Ortofoto_0.16_fs sidecar.

This is a SECOND, independent record of the image's geometry: the national
ortho over this ground is not one photograph but a mosaic of individual frames,
each labelled with its exposure timestamp, and relief displacement is radial
about EACH frame's nadir - not about one point for the whole window. Which
block a building falls in is therefore the thing that predicts which way it
leans, and it is read off the mosaic rather than fitted.
"""
import numpy as np
from scipy import ndimage as nd
from PIL import Image
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEAM = ROOT / 'lidingobuild/cache/lm-ortho-2025/seams.png'
BBOX = (676500.0, 6585000.0, 679000.0, 6587500.0)   # the request in acquire-lm-ortho.py
SIZE = 1400
MPP = (BBOX[2] - BBOX[0]) / SIZE

# read by eye off the rendered sidecar; the flight line through the course is the
# middle column, exposures four seconds apart
LABELS_READ = {
    'westColumn': ['10:18:56', '10:18:52', '10:18:48', '10:18:43', '10:18:39', '10:18:35'],
    'middleColumn': ['10:27:03', '10:27:07', '10:27:11', '10:27:15', '10:27:19', '10:27:23'],
    'eastColumn': ['10:45:47', '10:45:51', '10:45:55', '10:45:59', '10:46:03'],
}


def blocks(min_pixels=20000):
    a = np.asarray(Image.open(SEAM).convert('RGBA'))
    bg = a[..., 3] < 40
    lab, n = nd.label(bg, np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]]))
    out = []
    for i in range(1, n + 1):
        ys, xs = np.nonzero(lab == i)
        if len(ys) < min_pixels:
            continue
        e0 = BBOX[0] + xs.min() * MPP; e1 = BBOX[0] + (xs.max() + 1) * MPP
        n1 = BBOX[3] - ys.min() * MPP; n0 = BBOX[3] - (ys.max() + 1) * MPP
        clipped = (xs.min() == 0 or xs.max() == SIZE - 1
                   or ys.min() == 0 or ys.max() == SIZE - 1)
        out.append({'label': int(i), 'pixels': int(len(ys)),
                    'areaHectares': round(len(ys) * MPP * MPP / 1e4, 2),
                    'bboxEpsg3006': [round(e0, 1), round(n0, 1), round(e1, 1), round(n1, 1)],
                    'bboxCentre': [round((e0 + e1) / 2, 1), round((n0 + n1) / 2, 1)],
                    'pixelCentroid': [round(BBOX[0] + xs.mean() * MPP, 1),
                                      round(BBOX[3] - ys.mean() * MPP, 1)],
                    'clippedByRequest': bool(clipped)})
    return lab, out


def block_at(lab, E, N):
    c = int(round((E - BBOX[0]) / MPP)); r = int(round((BBOX[3] - N) / MPP))
    if not (0 <= r < SIZE and 0 <= c < SIZE):
        return 0
    v = int(lab[r, c])
    if v:
        return v
    # a point on a drawn seam line or a label glyph: take the commonest label nearby
    sub = lab[max(0, r - 4):r + 5, max(0, c - 4):c + 5].ravel()
    sub = sub[sub > 0]
    return int(np.bincount(sub).argmax()) if len(sub) else 0
