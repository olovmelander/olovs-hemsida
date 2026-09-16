"""Read and validate locally acquired orthophoto windows for existing tracers."""
import hashlib
import json
import math
from pathlib import Path

import numpy as np

FRAME_E, FRAME_N = 687748.5, 6370951.5
DEFAULT_CACHE = Path(__file__).resolve().parent.parent / 'cache' / 'lm-ortho'


def read_window(cx, cz, size, metres=0.16, cache=DEFAULT_CACHE, *, bands=(1, 2, 3)):
    """Read RGB by default; request bands=(1, 2, 3, 4) for RGB + near infrared.

    Band selection happens on the verified source, before reprojection. The
    infrared samples are image digital numbers, not calibrated reflectance.
    """
    import rasterio
    from rasterio.transform import from_origin
    from rasterio.warp import reproject, Resampling
    bands = tuple(bands)
    if not bands or len(set(bands)) != len(bands) or any(type(b) is not int or b not in (1, 2, 3, 4) for b in bands):
        raise ValueError('bands must be distinct RGBI band numbers from 1 to 4')
    if not all(math.isfinite(v) for v in [cx, cz, size, metres]) or size <= 0 or metres < 0.16:
        raise ValueError('Expected finite crop coordinates and resolution of at least 0.16 m')
    count = round(size / metres)
    if count <= 0 or count * count > 16e6:
        raise ValueError('Review crop must contain between 1 and 16 million pixels')
    x0, z0 = cx - size / 2, cz - size / 2
    west, north = FRAME_E + x0, FRAME_N - z0
    east, south = west + count * metres, north - count * metres
    cache = Path(cache).resolve()
    report = json.loads((cache / 'acquisition.json').read_text())
    if report.get('groundId') != 'visby' or not report.get('access', {}).get('authorized'):
        raise ValueError('No verified Visby orthophoto acquisition is available')
    matches = [r for r in report['windows'] if r['boundsEpsg3006'][0] <= west and r['boundsEpsg3006'][1] <= south
               and r['boundsEpsg3006'][2] >= east and r['boundsEpsg3006'][3] >= north]
    if not matches:
        raise ValueError('Crop is outside the acquired windows; acquire a covering review window first')
    record = min(matches, key=lambda r: r['width'] * r['height'])
    file = (cache / record['rasterFile']).resolve()
    if file.parent != cache:
        raise ValueError('Image path escapes the acquisition cache')
    with file.open('rb') as handle:
        if hashlib.file_digest(handle, 'sha256').hexdigest() != record['sha256']:
            raise ValueError('Acquired image checksum differs from its evidence')
    transform = from_origin(west, north, metres, metres)
    output = np.zeros((len(bands), count, count), dtype=np.uint8)
    valid = np.zeros((count, count), dtype=np.uint8)
    with rasterio.open(file) as src:
        if (src.crs.to_epsg() != 3006 or src.count != 4 or src.width != record['width'] or src.height != record['height']
                or not np.allclose(src.transform.to_gdal(), record['geoTransform'], atol=1e-8, rtol=0)):
            raise ValueError('Acquired image grid differs from its evidence')
        for index, band in enumerate(bands):
            reproject(rasterio.band(src, band), output[index], src_transform=src.transform, src_crs=src.crs,
                      dst_transform=transform, dst_crs=src.crs, resampling=Resampling.bilinear)
        reproject(src.dataset_mask(), valid, src_transform=src.transform, src_crs=src.crs,
                  dst_transform=transform, dst_crs=src.crs, resampling=Resampling.nearest)
    if not np.all(valid):
        raise ValueError('Requested tracing crop intersects missing source pixels')
    return np.moveaxis(output, 0, -1), dict(x0=x0, z0=z0, metres=metres, cols=count, rows=count,
        source='lm-download', sourceSha256=record['sha256'], sourceWindow=record['id'], bands=list(bands),
        sourceCaptureDates=[s['capturedAt'] for s in record['sources']],
        resampling='bilinear onto requested review grid', geoTransform=list(transform.to_gdal()))
