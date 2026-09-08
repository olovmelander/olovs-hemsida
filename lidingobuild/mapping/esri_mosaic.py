"""Sample the cached Esri z18 tiles at EPSG:3006 coordinates.

A tile's coordinates ARE its georeference, so pixel -> world is exact and a
reading taken here needs no registration. Kept separate from any detector so
the two capture dates can be run through the identical rule.
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
Image.MAX_IMAGE_PIXELS = None
_to4326 = Transformer.from_crs(3006, 4326, always_xy=True)


class EsriMosaic:
    def __init__(self, directory='lidingobuild/cache/esri-z18'):
        self.dir = ROOT / directory
        self.meta = json.loads((self.dir / 'tiles.json').read_text())
        r = self.meta['tileRange']
        self.x0, self.x1, self.y0, self.y1 = r['x0'], r['x1'], r['y0'], r['y1']
        self.z = self.meta['zoom']
        w = (self.x1 - self.x0 + 1) * 256
        h = (self.y1 - self.y0 + 1) * 256
        self.image = np.zeros((h, w, 3), np.uint8)
        for t in self.meta['index']:
            tile = np.asarray(Image.open(self.dir / f"{t['z']}-{t['y']}-{t['x']}.jpg").convert('RGB'))
            py = (t['y'] - self.y0) * 256
            px = (t['x'] - self.x0) * 256
            self.image[py:py + 256, px:px + 256] = tile
        self.metresPerPixel = self.meta['groundResolutionMetres']

    def pixel(self, easting, northing):
        """EPSG:3006 -> float pixel column/row in the assembled mosaic."""
        lon, lat = _to4326.transform(np.asarray(easting), np.asarray(northing))
        n = 2.0 ** self.z
        gx = (lon + 180.0) / 360.0 * n
        rad = np.radians(lat)
        gy = (1.0 - np.log(np.tan(rad) + 1.0 / np.cos(rad)) / np.pi) / 2.0 * n
        return (gx - self.x0) * 256.0, (gy - self.y0) * 256.0

    def sample(self, easting, northing):
        """Nearest-neighbour RGB. Nearest, not bilinear: a detector must read
        the pixel the capture actually holds, not a blend of two."""
        cx, cy = self.pixel(easting, northing)
        c = np.clip(np.round(cx).astype(int), 0, self.image.shape[1] - 1)
        r = np.clip(np.round(cy).astype(int), 0, self.image.shape[0] - 1)
        return self.image[r, c].astype(np.float32)


def indices(rgb):
    """The three readings every rule here is built from."""
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return 0.299 * R + 0.587 * G + 0.114 * B, 2 * G - R - B, R / np.maximum(G, 1)
