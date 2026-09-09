"""Authenticated, bounded Visby RGBI intake. Raw rasters remain in ignored cache.

python visbybuild/mapping/lm_ortho.py --plan visbybuild/cache/lm-ortho/plan.json
Use --probe-only for access checks, or --only hole-12-tees,hole-09-green.
Credentials use the existing LANTMATERIET_USERNAME/PASSWORD or BEARER_TOKEN.
Only metadata, hashes and aggregate band statistics belong in Git/artifacts.
"""
import argparse
import base64
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone


class IntakeError(RuntimeError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise IntakeError('Source redirects are not accepted')


def source_url(value):
    from urllib.parse import urlsplit
    p = urlsplit(value)
    if (p.scheme != 'https' or p.hostname != 'dl1.lantmateriet.se' or p.port not in (None, 443)
            or not p.path.startswith('/bild/data/orto/') or not p.path.endswith('.tif')
            or p.username or p.password or p.query or p.fragment):
        raise IntakeError('Unexpected orthophoto source URL')
    return value


def authorization(env=os.environ):
    values = [env.get(k, '') for k in ('LANTMATERIET_BEARER_TOKEN', 'LANTMATERIET_USERNAME', 'LANTMATERIET_PASSWORD')]
    if any(any(c in v for c in '\r\n\0') for v in values):
        raise IntakeError('Invalid credential configuration')
    token, username, password = values
    if token:
        return 'Bearer ' + token
    if username and password:
        return 'Basic ' + base64.b64encode((username + ':' + password).encode()).decode()
    raise IntakeError('Lantmateriet credentials are missing or incomplete')


def validate_header(status, content_range, data, expected_bytes):
    match = re.fullmatch(r'bytes 0-15/(\d+)', content_range or '')
    signature = data[:4] in (b'II*\x00', b'MM\x00*', b'II+\x00', b'MM\x00+')
    return (status == 206 and len(data) == 16 and signature and bool(match)
            and (expected_bytes is None or int(match[1]) == expected_bytes))


def probe_sources(sources, auth, opener=None):
    opener = opener or urllib.request.build_opener(NoRedirect())
    results = []
    for source in sources:
        request = urllib.request.Request(source_url(source['href']), headers={'Authorization': auth, 'Range': 'bytes=0-15'})
        status, readable, error = None, False, None
        try:
            with opener.open(request, timeout=25) as response:
                status = response.status
                # A 200 response may be an empty gateway page or a whole 460 MB
                # file. Never read it, and never count status alone as access.
                if status == 206:
                    readable = validate_header(status, response.headers.get('Content-Range'), response.read(17), source.get('bytes'))
        except urllib.error.HTTPError as exc:
            status = exc.code
            exc.close()
        except Exception:
            error = 'transport-or-redirect-error'
        results.append({'id': source['id'], 'status': status, 'readable': readable, 'error': error})
    return {'authorized': bool(results) and all(r['readable'] for r in results), 'assets': results}


def digest(file):
    with open(file, 'rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def acquire_window(plan, window, cache, auth):
    import numpy as np
    import rasterio
    from rasterio.merge import merge
    from rasterio.transform import array_bounds
    sources = [s for s in plan['sources'] if s['id'] in window['sourceIds']]
    out = cache / (window['id'] + '.tif')
    ledger = out.with_suffix('.json')
    request_hash = hashlib.sha256(json.dumps({'window': window, 'sources': sources,
        'resolution': plan['resolutionMetres']}, sort_keys=True).encode()).hexdigest()
    if out.exists() and ledger.exists():
        previous = json.loads(ledger.read_text())
        if previous.get('requestSha256') == request_hash and previous.get('sha256') == digest(out):
            return previous
    # Disable GDAL diagnostics; even failures must not print Authorization.
    environment = dict(GDAL_HTTP_HEADERS='Authorization: ' + auth, GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',
        CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif', GDAL_HTTP_TIMEOUT='45', GDAL_HTTP_MAX_RETRY='2',
        CPL_CURL_VERBOSE=False, CPL_DEBUG=False, GDAL_HTTP_UNSAFESSL=False,
        GDAL_HTTP_NETRC='NO', GDAL_HTTP_MULTIRANGE='YES', GDAL_TIFF_INTERNAL_MASK=True,
        GDAL_HTTP_AUTH_HEADER_ALLOWED_IF_REDIRECT='IF_SAME_HOST')
    resolution = plan['resolutionMetres']
    with rasterio.Env(**environment), contextlib.ExitStack() as stack:
        datasets = []
        for source in sources:
            src = stack.enter_context(rasterio.open('/vsicurl/' + source_url(source['href'])))
            if (src.crs.to_epsg() != 3006 or src.count != 4 or src.width != source['width'] or src.height != source['height']
                    or not np.allclose(src.bounds, source['boundsEpsg3006'], atol=1e-6, rtol=0)
                    or not np.allclose(src.res, [resolution, resolution], atol=1e-8, rtol=0)
                    or src.transform.b != 0 or src.transform.d != 0):
                raise IntakeError('Source raster no longer matches the pinned RGBI grid')
            datasets.append(src)
        pixels, transform = merge(datasets, bounds=window['boundsEpsg3006'], res=resolution, masked=True)
        height, width = pixels.shape[1:]
        bounds = list(array_bounds(height, width, transform))
        if ((width, height) != (window['width'], window['height']) or
                not np.allclose(bounds, window['boundsEpsg3006'], atol=1e-6, rtol=0)):
            raise IntakeError('Returned pixel grid differs from the review window')
        valid = ~np.ma.getmaskarray(pixels).any(axis=0)
        if not valid.any() or all(float(pixels[b][valid].std()) == 0 for b in range(3)):
            raise IntakeError('Source window contains no usable image variation')
        temporary = out.with_suffix('.partial.tif')
        with rasterio.open(temporary, 'w', driver='GTiff', width=width, height=height, count=4,
                           dtype=pixels.dtype, crs='EPSG:3006', transform=transform,
                           tiled=True, compress='deflate', blockxsize=256, blockysize=256) as dst:
            dst.write(pixels.filled(0))
            dst.write_mask(valid.astype('uint8') * 255)
        temporary.replace(out)
        record = dict(id=window['id'], requestSha256=request_hash, sha256=digest(out), bytes=out.stat().st_size,
            rasterFile=out.name, boundsEpsg3006=bounds, width=width, height=height,
            geoTransform=list(transform.to_gdal()), validFraction=float(valid.mean()),
            sources=[{'id': s['id'], 'capturedAt': s['capturedAt']} for s in sources],
            acquiredAt=datetime.now(timezone.utc).isoformat(),
            bands=[dict(band=b+1, minimum=float(pixels[b][valid].min()), maximum=float(pixels[b][valid].max()),
                        mean=float(pixels[b][valid].mean()), standardDeviation=float(pixels[b][valid].std())) for b in range(4)])
    ledger.write_text(json.dumps(record, indent=2) + '\n')
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', required=True, type=Path)
    parser.add_argument('--cache', type=Path, default=Path('visbybuild/cache/lm-ortho'))
    parser.add_argument('--out', type=Path, default=Path('visbybuild/cache/lm-ortho/acquisition.json'))
    parser.add_argument('--only', default='')
    parser.add_argument('--probe-only', action='store_true')
    args = parser.parse_args()
    plan = json.loads(args.plan.read_text())
    if plan.get('groundId') != 'visby' or plan.get('horizontalCrs') != 'EPSG:3006':
        raise IntakeError('Expected a Visby EPSG:3006 review plan')
    windows = plan['windows']
    if args.only:
        selected = set(args.only.split(','))
        windows = [w for w in windows if w['id'] in selected]
        if len(windows) != len(selected):
            raise IntakeError('Unknown or repeated review window selection')
    for w in windows:
        if not re.fullmatch('[a-z0-9]+(?:-[a-z0-9]+)*', w['id']) or not 0 < w['width'] * w['height'] <= 16e6:
            raise IntakeError('Invalid or oversized review window')
    report = dict(schemaVersion=1, groundId='visby', kind='authenticated-orthophoto-acquisition',
        observedAt=datetime.now(timezone.utc).isoformat(), sourceCommit=os.environ.get('GITHUB_SHA'),
        planSha256=digest(args.plan), collection=plan['collection'], selectedWindows=[w['id'] for w in windows],
        state='pending', access=None, windows=[], rawImageryRedistributed=False,
        geometryChanged=False)
    args.cache.mkdir(parents=True, exist_ok=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    save = lambda: args.out.write_text(json.dumps(report, indent=2) + '\n')
    exit_code = 0
    try:
        auth = authorization()
        report['access'] = probe_sources(plan['sources'], auth)
        if not report['access']['authorized']:
            raise IntakeError('Orthophoto byte access did not pass; inspect per-asset HTTP status')
        report['state'] = 'access-verified'
        save()
        if not args.probe_only:
            for window in windows:
                record = acquire_window(plan, window, args.cache, auth)
                report['windows'].append(record)
                save()
                print(json.dumps({'window': window['id'], 'width': record['width'], 'height': record['height'], 'validFraction': record['validFraction']}), flush=True)
            report['state'] = 'acquired-for-review'
    except IntakeError as exc:
        report['state'], report['error'], exit_code = 'blocked', str(exc), 2
    except Exception:
        # No library exception/log may serialize provider authentication.
        report['state'], report['error'], exit_code = 'failed', 'Raster acquisition failed; no runtime geometry changed', 1
    save()
    print(json.dumps({'state': report['state'], 'acquiredWindows': len(report['windows']), 'access': report['access']}))
    return exit_code


if __name__ == '__main__':
    raise SystemExit(main())
