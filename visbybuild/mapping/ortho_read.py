"""Read Lantmateriet's 0.16 m orthophoto over the Visby frame as pixels.

The 2026-04-10 national flight is the finest and newest imagery over Kronholmen
(0.16 m RGBI against Esri z18's 0.32 m from 2016 and the 0.5 m municipal image
this model's geometry was actually traced from). Its COG on dl1 answers 401
unauthenticated and 403 for this repo's account; the pixels are servable
through the viewing service Min karta proxies, which is the route that works.

Two request conventions, both measured, each costing a blank image if wrong:
WMS 1.3.0 with EPSG:3006 wants the bbox NORTHING first and returns pure white
easting-first, so this speaks 1.1.1 with SRS=; and the service caps a request
at 4096 x 4096, so a window wider than that is mosaicked.

The imagery is a TRACING SOURCE and never a runtime texture: what leaves this
module is derived vector geometry, never pixels.
"""
import hashlib
import io
import json
import os
import time
import urllib.request

import numpy as np
from PIL import Image

FRAME_E, FRAME_N = 687748.5, 6370951.5   # visbybuild/frame.mjs
CACHE = os.path.join(os.path.dirname(__file__), '..', 'cache', 'ortho')
MAX = 4096
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36'

LAYERS = {
    # the April 2026 national flight: finest, newest, leaf-off
    'lm016': dict(metres=0.16, url=(
        'https://minkarta.lantmateriet.se/map/ortofoto?SERVICE=WMS&VERSION=1.1.1'
        '&REQUEST=GetMap&LAYERS=Ortofoto_0.16&STYLES=&SRS=EPSG:3006'
        '&BBOX={w},{s},{e},{n}&WIDTH={cols}&HEIGHT={rows}&FORMAT=image/jpeg')),
    # Region Gotland's open summer capture: coarser, leaf-ON, so mow lines read
    'gotland': dict(metres=0.25, url=(
        'https://imageserver.gotland.se/arcgis/rest/services/Ortofoto/Ortofoto_2022'
        '/ImageServer/exportImage?bbox={w},{s},{e},{n}&bboxSR=3006&imageSR=3006'
        '&size={cols},{rows}&format=jpg&f=pjson')),
}


def _fetch(url, attempts=4):
    """Both services reset the connection under a burst -- eighteen windows in
    a row is a burst. Retry with a growing pause; a real refusal survives it."""
    last = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(request, timeout=180) as response:
                return response.read()
        except Exception as error:      # noqa: BLE001 - any transport failure retries
            last = error
            time.sleep(2 ** attempt)
    raise RuntimeError(f'{url.split("?")[0]} failed after {attempts} attempts: {last}')


def _get(url, layer):
    payload = _fetch(url)
    if layer == 'gotland':
        # f=image returns a two-tone tRNS artefact rather than imagery; the real
        # pixels are behind the href that f=pjson names.
        payload = _fetch(json.loads(payload)['href'])
    if len(payload) < 2048:
        raise RuntimeError(f'{layer} returned {len(payload)} bytes, which is a service exception rather than imagery')
    # decode before caching, or a truncated or error-page body is written to
    # disk once and then poisons every later run that trusts the cache
    Image.open(io.BytesIO(payload)).verify()
    return payload


def window(cx, cz, size, layer='lm016', metres=None):
    """A square window of `size` metres about local (cx, cz).

    Returns (pixels, affine) where pixels is HxWx3 uint8 and affine maps local
    metres to pixel coordinates: px = (x - x0) / m, py = (z - z0) / m.
    """
    spec = LAYERS[layer]
    m = metres or spec['metres']
    x0, z0 = cx - size / 2, cz - size / 2
    cols = rows = int(round(size / m))
    out = np.zeros((rows, cols, 3), dtype=np.uint8)
    os.makedirs(os.path.join(CACHE, layer), exist_ok=True)
    for row0 in range(0, rows, MAX):
        for col0 in range(0, cols, MAX):
            c, r = min(MAX, cols - col0), min(MAX, rows - row0)
            # local -> EPSG:3006 is a pure translation in this frame
            w = FRAME_E + x0 + col0 * m
            n = FRAME_N - (z0 + row0 * m)
            url = spec['url'].format(w=w, s=n - r * m, e=w + c * m, n=n, cols=c, rows=r)
            key = hashlib.sha256(url.encode()).hexdigest()[:24] + '.jpg'
            path = os.path.join(CACHE, layer, key)
            if not os.path.exists(path):
                with open(path, 'wb') as handle:
                    handle.write(_get(url, layer))
            with open(path, 'rb') as handle:
                piece = np.asarray(Image.open(io.BytesIO(handle.read())).convert('RGB'))
            out[row0:row0 + r, col0:col0 + c] = piece[:r, :c]
    return out, dict(x0=x0, z0=z0, metres=m, cols=cols, rows=rows)


def to_pixel(affine, x, z):
    return ((x - affine['x0']) / affine['metres'], (z - affine['z0']) / affine['metres'])


def to_local(affine, px, pz):
    return (affine['x0'] + px * affine['metres'], affine['z0'] + pz * affine['metres'])
