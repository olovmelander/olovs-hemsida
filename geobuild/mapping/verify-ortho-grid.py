#!/usr/bin/env python3
"""Verify every acquired tile's native grid and sample exact source pixels.

python geobuild/mapping/verify-ortho-grid.py --env-file .env
Writes numerical georegistration evidence only; sampled source RGBI values stay
in memory. Confirms source-to-crop registration, not source surveying accuracy.
"""
import argparse
import contextlib
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys

import numpy as np
import rasterio
from rasterio.windows import Window

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'visbybuild/mapping'))
from lm_ortho import authorization, digest, source_url


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', type=Path)
    args = parser.parse_args()
    if args.env_file:
        for line in args.env_file.read_text(encoding='utf-8-sig').splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                key, value = line.split('=', 1)
                if key.strip().startswith('LANTMATERIET_'):
                    os.environ.setdefault(key.strip(), value.strip().strip('\"\''))
    metadata = ROOT / 'geo_data/course-v2/veckefjarden/acquisition'
    plan = json.loads((metadata / 'ortho-plan.json').read_text())
    receipt = json.loads((metadata / 'ortho-review.json').read_text(encoding='utf-8'))
    assert receipt['state'] == 'acquired-for-review'
    assert len(receipt['windows']) == len(plan['windows'])
    auth = authorization()
    records, grids = [], []
    env = dict(GDAL_HTTP_HEADERS='Authorization: ' + auth, GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',
               CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif', GDAL_HTTP_TIMEOUT='60', GDAL_HTTP_MAX_RETRY='2',
               CPL_CURL_VERBOSE=False, CPL_DEBUG=False, GDAL_HTTP_NETRC='NO',
               GDAL_HTTP_AUTH_HEADER_ALLOWED_IF_REDIRECT='IF_SAME_HOST')
    with rasterio.Env(**env), contextlib.ExitStack() as stack:
        sources = {}
        for item in plan['sources']:
            src = stack.enter_context(rasterio.open('/vsicurl/' + source_url(item['href'])))
            assert src.crs.to_epsg() == 3006 and src.count == 4 and src.dtypes == ('uint8',) * 4
            assert np.allclose(src.bounds, item['boundsEpsg3006'], rtol=0, atol=1e-8)
            assert src.transform.a == .16 and src.transform.e == -.16
            assert src.transform.b == src.transform.d == 0
            sources[item['id']] = src
            grids.append(dict(id=item['id'], width=src.width, height=src.height,
                              geoTransform=list(src.transform.to_gdal()), crs=src.crs.to_string(),
                              dtypes=list(src.dtypes), colorInterpretation=[c.name for c in src.colorinterp]))
        for window in plan['windows']:
            path = ROOT / receipt['sourceRasterDirectory'] / (window['id'] + '.tif')
            record = next(r for r in receipt['windows'] if r['id'] == window['id'])
            assert digest(path) == record['sha256']
            with rasterio.open(path) as tile:
                assert np.allclose(tile.bounds, window['boundsEpsg3006'], rtol=0, atol=1e-8)
                assert tile.crs.to_epsg() == 3006 and tile.count == 4
                assert tile.width == window['width'] and tile.height == window['height']
                assert tile.transform.a == .16 and tile.transform.e == -.16
                assert tile.transform.b == tile.transform.d == 0
                samples = []
                for row, col in [(0, 0), (0, tile.width-1), (tile.height-1, 0),
                                 (tile.height-1, tile.width-1), (tile.height//2, tile.width//2)]:
                    easting, northing = tile.xy(row, col)
                    source_id = next(key for key, src in sources.items()
                                     if src.bounds.left <= easting < src.bounds.right and src.bounds.bottom < northing <= src.bounds.top)
                    src = sources[source_id]
                    source_row, source_col = src.index(easting, northing)
                    source_e, source_n = src.xy(source_row, source_col)
                    centre_error = float(np.hypot(source_e-easting, source_n-northing))
                    assert centre_error < 1e-8
                    assert np.array_equal(tile.read(window=Window(col,row,1,1)),
                                          src.read(window=Window(source_col,source_row,1,1)))
                    samples.append(dict(row=row, column=col, easting=easting, northing=northing,
                                        sourceId=source_id, sourceRow=source_row, sourceColumn=source_col,
                                        centreErrorMetres=centre_error, fourBandPixelsIdentical=True))
                records.append(dict(id=window['id'], sha256=record['sha256'],
                                    nativeGridVerified=True, sampleChecks=samples))
                print(window['id'] + ': native coordinates and 5 RGBI source samples verified', flush=True)
    report = dict(schemaVersion=1, groundId='veckefjarden', verifiedAt=datetime.now(timezone.utc).isoformat(),
                  planSha256=digest(metadata / 'ortho-plan.json'), sourceGrids=grids, windows=records,
                  summary=dict(windows=len(records), identicalFourBandSourceSamples=sum(len(r['sampleChecks']) for r in records),
                               sourceToCropRegistrationVerified=True, sourceAbsoluteHorizontalAccuracyMetres=None),
                  limitation='Exact source-to-crop pixel registration is not a survey of source absolute positional accuracy.')
    (metadata / 'ortho-grid-verification.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8', newline='\n')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'state': 'failed', 'errorType': type(exc).__name__}), file=sys.stderr)
        raise SystemExit(1)
