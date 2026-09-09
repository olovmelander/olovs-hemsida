"""Acquire pinned Tortuna 2026 imagery for private mapping review.

python tortunabuild/acquire-orthophoto.py
The runner retains only an RSA-OAEP/AES-GCM encrypted review bundle and public
grid/hash metadata. The private key never leaves the requesting workspace.
"""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import zipfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'visbybuild/mapping'))
from lm_ortho import authorization, probe_sources, source_url


def main():
    import numpy as np
    import rasterio
    from rasterio.merge import merge
    from rasterio.enums import Resampling
    from rasterio.transform import array_bounds
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    discovery = json.loads((ROOT / 'geo_data/course-v2/tortuna/acquisition/d2-discovery.json').read_text())
    ortho = discovery['orthophoto']
    if ortho['collection'] != 'orto-n2-2026' or not ortho['coverage']['complete']:
        raise ValueError('Expected the reviewed complete 2026 campaign')
    sources = [dict(id=i['id'], href=i['assets']['data']['href'], bytes=i['assets']['data']['bytes']) for i in ortho['items']]
    auth = authorization()
    access = probe_sources(sources, auth)
    if not access['authorized']:
        print(json.dumps(access))
        raise ValueError('Authenticated orthophoto byte access failed')
    cache = ROOT / 'tortunabuild/cache/orthophoto'
    cache.mkdir(parents=True, exist_ok=True)
    # Two adjacent windows cover both loops, practice facilities and surrounding
    # features. Pixel-edge extents and downsampling are recorded explicitly.
    windows = [dict(id='south', bounds=[596880, 6613600, 598160, 6614880], resolution=.32),
               dict(id='north', bounds=[596880, 6614880, 598160, 6616160], resolution=.32)]
    report = dict(schemaVersion=1, groundId='tortuna', state='acquiring',
                  acquiredAt=datetime.now(timezone.utc).isoformat(), sourceCommit=os.environ.get('GITHUB_SHA'),
                  horizontalCrs='EPSG:3006', nativeResolutionMetres=.16,
                  collection=ortho['collection'], sources=ortho['items'], access=access,
                  attribution='Ortofoto Nedladdning © Lantmäteriet, bearbetad information, CC BY 4.0.',
                  terms='https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/anvandningsvillkor_for_vardefulla_datamangder_pu.pdf',
                  rawImageryRedistributed=False, windows=[])
    environment = dict(GDAL_HTTP_HEADERS='Authorization: ' + auth, GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',
                       CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif', GDAL_HTTP_TIMEOUT='60', GDAL_HTTP_MAX_RETRY='3',
                       CPL_CURL_VERBOSE=False, CPL_DEBUG=False, GDAL_HTTP_NETRC='NO',
                       GDAL_HTTP_AUTH_HEADER_ALLOWED_IF_REDIRECT='IF_SAME_HOST')
    with rasterio.Env(**environment), contextlib.ExitStack() as stack:
        datasets = []
        for item in ortho['items']:
            src = stack.enter_context(rasterio.open('/vsicurl/' + source_url(item['assets']['data']['href'])))
            if (src.crs.to_epsg() != 3006 or src.count != 4 or src.dtypes != ('uint8',) * 4 or
                    not np.allclose(src.bounds, item['projBbox'], rtol=0, atol=1e-6) or
                    not np.allclose(src.res, [.16, .16], rtol=0, atol=1e-8)):
                raise ValueError('Pinned RGBI source grid changed')
            datasets.append(src)
        for window in windows:
            pixels, transform = merge(datasets, bounds=window['bounds'], res=window['resolution'],
                                      masked=True, resampling=Resampling.average)
            valid = ~np.ma.getmaskarray(pixels).any(axis=0)
            bounds = list(array_bounds(pixels.shape[1], pixels.shape[2], transform))
            if (pixels.shape != (4, 4000, 4000) or not valid.all() or
                    not np.allclose(bounds, window['bounds'], rtol=0, atol=1e-6)):
                raise ValueError('Incomplete or misaligned Tortuna review window')
            file = cache / (window['id'] + '.tif')
            with rasterio.open(file, 'w', driver='GTiff', width=4000, height=4000, count=4, dtype='uint8',
                               crs=3006, transform=transform, compress='deflate', tiled=True) as dst:
                dst.write(pixels.filled(0))
            record = dict(id=window['id'], file=file.name, boundsEpsg3006=bounds,
                          geoTransform=list(transform.to_gdal()), width=4000, height=4000,
                          resolutionMetres=.32, resampling='average from 0.16 m source', validFraction=float(valid.mean()),
                          bytes=file.stat().st_size, sha256=hashlib.sha256(file.read_bytes()).hexdigest())
            report['windows'].append(record)
            print(json.dumps(record), flush=True)
    report['state'] = 'acquired-for-private-review'
    public_report = ROOT / 'geo_data/course-v2/tortuna/acquisition/orthophoto-review.json'
    public_report.write_text(json.dumps(report, indent=2) + '\n')
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_STORED) as archive:
        archive.write(public_report, 'index.json')
        for window in report['windows']:
            archive.write(cache / window['file'], window['file'])
    public = serialization.load_pem_public_key((ROOT / 'tortunabuild/reference/review-public.pem').read_bytes())
    key, nonce = AESGCM.generate_key(bit_length=256), os.urandom(12)
    wrapped = public.encrypt(key, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    encrypted = AESGCM(key).encrypt(nonce, stream.getvalue(), b'banvy-tortuna-review-v1')
    output = ROOT / 'tortunabuild/cache/tortuna-review.enc'
    output.write_bytes(b'BVTORT01' + len(wrapped).to_bytes(2, 'big') + wrapped + nonce + encrypted)
    print(json.dumps(dict(encryptedBytes=output.stat().st_size, encryptedSha256=hashlib.sha256(output.read_bytes()).hexdigest())))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # Third-party raster errors can include HTTP headers; never log them.
        print(json.dumps({'state': 'failed', 'errorType': type(exc).__name__}), file=sys.stderr)
        raise SystemExit(1)
