"""The 2019 municipal capture, sampled in EPSG:3006, for ONE job: telling a
footprint that is in the wrong place from a roof that is leaning in one
photograph. Nothing is adopted from it. It is EPSG:3011 native, so the
transform is pyproj's and is applied per sample point."""
import json
from pathlib import Path
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parents[2]
_img = None
_w = None
_tr = None
META = json.loads((ROOT / 'geo_data/course-v2/lidingo/discovery/municipal-ortho-2019-native.json').read_text())


def _load():
    global _img, _w, _tr
    if _img is None:
        _img = np.asarray(Image.open(ROOT / META['path']).convert('RGB'))
        _w = [float(x) for x in (ROOT / META['worldfilePath']).read_text().split()]
        from pyproj import Transformer
        _tr = Transformer.from_crs(3006, 3011, always_xy=True)
    return _img, _w, _tr


def sample(EE, NN):
    img, w, tr = _load()
    e, n = tr.transform(np.asarray(EE), np.asarray(NN))
    c = np.clip(np.round((e - w[4]) / w[0]).astype(np.int32), 0, img.shape[1] - 1)
    r = np.clip(np.round((n - w[5]) / w[3]).astype(np.int32), 0, img.shape[0] - 1)
    return img[r, c]


def free():
    global _img
    _img = None
