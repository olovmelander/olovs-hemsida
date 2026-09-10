"""Acquire bounded native 2026 RGBI crops around the legacy routing references.

Coordinates locate review windows only. They do not approve current tee colours
or golf-surface geometry. Original imagery and review PNGs stay in ignored cache.
Supply the existing LANTMATERIET_* environment variables; secrets are never logged.
"""
import contextlib
import hashlib
import json
import math
from pathlib import Path
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'visbybuild/mapping'))
from lm_ortho import authorization, probe_sources, source_url


def main():
    import numpy as np
    import rasterio
    from rasterio.merge import merge
    from rasterio.transform import array_bounds
    from pyproj import Transformer
    from PIL import Image

    discovery = json.loads((ROOT / 'geo_data/course-v2/tortuna/acquisition/d2-discovery.json').read_text())
    routing_path = ROOT / 'tortunabuild/reference/routing-golftraxx.json'
    routing = json.loads(routing_path.read_text())
    ortho = discovery['orthophoto']
    if ortho['collection'] != 'orto-n2-2026' or not ortho['coverage']['complete']:
        raise ValueError('Expected complete pinned 2026 campaign')
    auth = authorization()
    access = probe_sources([dict(id=i['id'], href=i['assets']['data']['href'], bytes=i['assets']['data']['bytes']) for i in ortho['items']], auth)
    if not access['authorized']:
        raise ValueError('Authenticated orthophoto range access failed')
    cache = ROOT / 'tortunabuild/cache/orthophoto/crops'
    cache.mkdir(parents=True, exist_ok=True)
    transform = Transformer.from_crs(4326, 3006, always_xy=True)
    windows = []
    for hole in routing['holes']:
        for key in ['teeBack', 'greenCenter']:
            e, n = transform.transform(*hole[key])
            # Align every edge to the source's 0.16 m pixel lattice.
            west, south = (math.floor((v - 64) / .16) * .16 for v in [e, n])
            windows.append(dict(id=f"hole-{hole['number']:02d}-{'tee' if key == 'teeBack' else 'green'}",
                referenceKey=key, referenceEpsg3006=[e, n], bounds=[west, south, west + 128, south + 128]))
    environment = dict(GDAL_HTTP_HEADERS='Authorization: ' + auth, GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',
        CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif', GDAL_HTTP_TIMEOUT='60', GDAL_HTTP_MAX_RETRY='3',
        CPL_CURL_VERBOSE=False, CPL_DEBUG=False, GDAL_HTTP_NETRC='NO',
        GDAL_HTTP_AUTH_HEADER_ALLOWED_IF_REDIRECT='IF_SAME_HOST')
    report = dict(schemaVersion=1, groundId='tortuna', acquiredAt=datetime.now(timezone.utc).isoformat(),
        state='native-orthophoto-review-windows-acquired', horizontalCrs='EPSG:3006',
        collection=ortho['collection'], resolutionMetres=.16, resampling='none; native source pixel copy',
        routingReferenceSha256=hashlib.sha256(routing_path.read_bytes()).hexdigest(),
        routingRole='legacy references locate crop windows; they do not approve current geometry',
        attribution='Ortofoto Nedladdning © Lantmäteriet, bearbetad information, CC BY 4.0.',
        rawImageryRedistributed=False, access=access, windows=[])
    with rasterio.Env(**environment), contextlib.ExitStack() as stack:
        sources = []
        for item in ortho['items']:
            src = stack.enter_context(rasterio.open('/vsicurl/' + source_url(item['assets']['data']['href'])))
            if (src.crs.to_epsg() != 3006 or src.count != 4 or src.dtypes != ('uint8',) * 4 or
                not np.allclose(src.bounds, item['projBbox'], rtol=0, atol=1e-6) or
                not np.allclose(src.res, [.16, .16], rtol=0, atol=1e-8)):
                raise ValueError('Pinned RGBI grid changed')
            sources.append((item, src))
        for window in windows:
            w, s, e, n = window['bounds']
            selected = [(item, src) for item, src in sources if src.bounds.left < e and src.bounds.right > w and src.bounds.bottom < n and src.bounds.top > s]
            pixels, affine = merge([src for _, src in selected], bounds=window['bounds'], res=.16, masked=True)
            bounds = list(array_bounds(pixels.shape[1], pixels.shape[2], affine))
            valid = ~np.ma.getmaskarray(pixels).any(axis=0)
            if pixels.shape != (4, 800, 800) or not valid.all() or not np.allclose(bounds, window['bounds'], atol=1e-6, rtol=0):
                raise ValueError('Incomplete native crop')
            tif = cache / (window['id'] + '.tif')
            with rasterio.open(tif, 'w', driver='GTiff', width=800, height=800, count=4, dtype='uint8',
                    crs=3006, transform=affine, compress='deflate', tiled=True) as dst:
                dst.write(pixels.filled(0))
            Image.fromarray(np.moveaxis(pixels.filled(0)[:3], 0, 2)).save(cache / (window['id'] + '.png'))
            record = dict(id=window['id'], file=tif.relative_to(ROOT).as_posix(), boundsEpsg3006=bounds,
                geoTransform=list(affine.to_gdal()), width=800, height=800, resolutionMetres=.16,
                referenceKey=window['referenceKey'], referenceEpsg3006=window['referenceEpsg3006'],
                validFraction=float(valid.mean()), sourceIds=[i['id'] for i, _ in selected],
                bytes=tif.stat().st_size, sha256=hashlib.sha256(tif.read_bytes()).hexdigest())
            report['windows'].append(record)
            print(json.dumps(dict(crop=window['id'], completed=len(report['windows']), total=len(windows))), flush=True)
    (ROOT / 'geo_data/course-v2/tortuna/acquisition/orthophoto-native-crops.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps(dict(state='failed', errorType=type(exc).__name__)), file=sys.stderr)
        raise SystemExit(1)
