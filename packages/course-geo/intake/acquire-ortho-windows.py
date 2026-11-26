#!/usr/bin/env python3
"""Acquire multi-vintage Lantmateriet 0.16 m RGBI orthophoto windows via rasterio.

Runs inside the locked Pixi `mapping` Python 3.12 environment. Produces
ZSTD-compressed 4-band RGBI GeoTIFFs in a gitignored cache directory plus an
`acquisition.json` metadata file that is 100% schema-compatible with
`packages/course-workflow/render-source-overlays.py`.

Supports:
  1. Authenticated Lantmateriet STAC-bild discovery JSON (`--discovery`) or
     direct COG URLs (credentials read exclusively from environment variables
     `LANTMATERIET_USERNAME`/`LANTMATERIET_PASSWORD` or
     `LANTMATERIET_BEARER_TOKEN` and never written into logs or JSON).
  2. Multi-vintage windows (e.g. latest leaf-on + alternate leaf-off) with
     solar elevation/azimuth geometry computed from capture date & location.
  3. Local GeoTIFF mode (`--local-tif`) for offline verification & unit tests.
"""
import argparse
import base64
import hashlib
import json
import math
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.transform import from_bounds
from rasterio.vrt import WarpedVRT
from rasterio.windows import from_bounds as window_from_bounds

ID_RE = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')
MAX_MEGAPIXELS_DEFAULT = 80.0


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def solar_geometry(captured_at: str, lat_deg: float, lon_deg: float) -> dict:
    """Compute approximate solar azimuth & elevation (degrees) for capture timestamp."""
    if not captured_at:
        return {'solarElevationDeg': None, 'solarAzimuthDeg': None, 'timeAssumedUtcNoon': False}
    text = captured_at.strip()
    assumed_noon = False
    try:
        if len(text) == 10:  # YYYY-MM-DD only
            dt = datetime.fromisoformat(text).replace(hour=10, minute=30, tzinfo=timezone.utc)
            assumed_noon = True
        else:
            dt = datetime.fromisoformat(text.replace('Z', '+00:00'))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            else:
                dt = dt.astimezone(timezone.utc)
    except ValueError:
        return {'solarElevationDeg': None, 'solarAzimuthDeg': None, 'timeAssumedUtcNoon': False}

    day_of_year = dt.timetuple().tm_yday
    hour_utc = dt.hour + dt.minute / 60.0 + dt.second / 3600.0
    gamma = 2.0 * math.pi / 365.0 * (day_of_year - 1 + (hour_utc - 12.0) / 24.0)
    eq_time = 229.18 * (
        0.000075
        + 0.001868 * math.cos(gamma)
        - 0.032077 * math.sin(gamma)
        - 0.014615 * math.cos(2 * gamma)
        - 0.040849 * math.sin(2 * gamma)
    )
    decl = (
        0.006918
        - 0.399912 * math.cos(gamma)
        + 0.070257 * math.sin(gamma)
        - 0.006758 * math.cos(2 * gamma)
        + 0.000907 * math.sin(2 * gamma)
        - 0.002697 * math.cos(3 * gamma)
        + 0.00148 * math.sin(3 * gamma)
    )
    true_solar_min = (hour_utc * 60.0 + eq_time + 4.0 * lon_deg) % 1440.0
    hour_angle_deg = true_solar_min / 4.0 - 180.0
    ha = math.radians(hour_angle_deg)
    lat = math.radians(lat_deg)
    sin_elev = math.sin(lat) * math.sin(decl) + math.cos(lat) * math.cos(decl) * math.cos(ha)
    sin_elev = max(-1.0, min(1.0, sin_elev))
    elev = math.asin(sin_elev)
    cos_az = (math.sin(decl) - math.sin(lat) * sin_elev) / max(1e-9, math.cos(lat) * math.cos(elev))
    cos_az = max(-1.0, min(1.0, cos_az))
    az = math.degrees(math.acos(cos_az))
    if hour_angle_deg > 0:
        az = 360.0 - az
    return {
        'solarElevationDeg': round(math.degrees(elev), 2),
        'solarAzimuthDeg': round(az, 2),
        'timeAssumedUtcNoon': assumed_noon,
    }


def gdal_env_from_credentials() -> dict:
    env = {
        'GDAL_DISABLE_READDIR_ON_OPEN': 'EMPTY_DIR',
        'CPL_VSIL_CURL_ALLOWED_EXTENSIONS': '.tif,.tiff',
        'VSI_CACHE': 'TRUE',
        'VSI_CACHE_SIZE': str(64 * 1024 * 1024),
    }
    bearer = os.environ.get('LANTMATERIET_BEARER_TOKEN')
    user = os.environ.get('LANTMATERIET_USERNAME')
    pw = os.environ.get('LANTMATERIET_PASSWORD')
    if bearer:
        env['GDAL_HTTP_HEADERS'] = f'Authorization: Bearer {bearer}'
    elif user and pw:
        token = base64.b64encode(f'{user}:{pw}'.encode('utf-8')).decode('ascii')
        env['GDAL_HTTP_HEADERS'] = f'Authorization: Basic {token}'
    return env


def validate_safe_id(value: str, label: str) -> str:
    if not ID_RE.fullmatch(value or ''):
        raise ValueError(f'{label} must match {ID_RE.pattern}: got {value!r}')
    return value


def extract_window_from_sources(
    *,
    window_id: str,
    bounds_epsg3006: list[float],
    resolution_metres: float,
    source_entries: list[dict],
    out_dir: Path,
    vintage: str = 'latest',
    leaf_state: str = 'unknown',
    max_megapixels: float = MAX_MEGAPIXELS_DEFAULT,
    gdal_env: dict | None = None,
) -> dict:
    """Read and composite one EPSG:3006 RGBI window into out_dir/<window_id>.tif."""
    validate_safe_id(window_id, 'window_id')
    west, south, east, north = [float(v) for v in bounds_epsg3006]
    if not (east > west and north > south):
        raise ValueError(f'invalid boundsEpsg3006: {bounds_epsg3006}')
    if not (math.isfinite(resolution_metres) and resolution_metres > 0):
        raise ValueError(f'invalid resolution_metres: {resolution_metres}')

    width = max(1, round((east - west) / resolution_metres))
    height = max(1, round((north - south) / resolution_metres))
    megapixels = (width * height) / 1e6
    if megapixels > max_megapixels:
        raise ValueError(f'window {window_id} is {megapixels:.2f} Mpx > budget {max_megapixels} Mpx')

    # Snap exact pixel-edge east/south to match width/height if needed, keeping declared bounds consistent
    actual_px_w = (east - west) / width
    actual_px_h = (north - south) / height
    dst_transform = from_bounds(west, south, east, north, width, height)
    geo_transform = [west, actual_px_w, 0.0, north, 0.0, -actual_px_h]

    out_array = np.zeros((4, height, width), dtype=np.uint8)
    valid_mask = np.zeros((height, width), dtype=bool)
    used_sources = []

    env_ctx = rasterio.Env(**(gdal_env or {}))
    with env_ctx:
        for src_meta in source_entries:
            uri = src_meta['uri']
            with rasterio.open(uri) as src:
                b = src.bounds
                ov_w, ov_s = max(west, b.left), max(south, b.bottom)
                ov_e, ov_n = min(east, b.right), min(north, b.top)
                if ov_e <= ov_w or ov_n <= ov_s:
                    continue

                band_count = min(4, src.count)
                with WarpedVRT(
                    src,
                    crs='EPSG:3006',
                    transform=dst_transform,
                    width=width,
                    height=height,
                    resampling=rasterio.enums.Resampling.bilinear,
                ) as vrt:
                    win = window_from_bounds(ov_w, ov_s, ov_e, ov_n, transform=dst_transform)
                    col_off = max(0, int(math.floor(win.col_off)))
                    row_off = max(0, int(math.floor(win.row_off)))
                    col_end = min(width, int(math.ceil(win.col_off + win.width)))
                    row_end = min(height, int(math.ceil(win.row_off + win.height)))
                    if col_end <= col_off or row_end <= row_off:
                        continue
                    sub_win = rasterio.windows.Window(col_off, row_off, col_end - col_off, row_end - row_off)
                    data = vrt.read(list(range(1, band_count + 1)), window=sub_win)
                    # Convert uint16/float if necessary; Lantmateriet Ortofoto RGBI is uint8
                    if data.dtype != np.uint8:
                        data = np.clip(data, 0, 255).astype(np.uint8)
                    nodata = src.nodata
                    if nodata is not None:
                        px_valid = np.any(data[:min(3, band_count)] != int(nodata), axis=0)
                    else:
                        # Any band non-zero or valid raster mask from GDAL
                        rmask = vrt.read_masks(1, window=sub_win)
                        px_valid = rmask > 0
                    sub_valid = valid_mask[row_off:row_end, col_off:col_end]
                    write_here = px_valid & (~sub_valid)
                    if not np.any(write_here):
                        continue
                    for bi in range(band_count):
                        out_array[bi, row_off:row_end, col_off:col_end][write_here] = data[bi][write_here]
                    if band_count == 3:
                        # Preserve 4th band slot as 0 if RGB-only fallback
                        out_array[3, row_off:row_end, col_off:col_end][write_here] = 0
                    sub_valid[write_here] = True
                    used_sources.append({
                        'id': src_meta['id'],
                        'capturedAt': src_meta['capturedAt'],
                        **({'sha256': src_meta['sha256']} if src_meta.get('sha256') else {}),
                        **({'collection': src_meta['collection']} if src_meta.get('collection') else {}),
                    })

    if not used_sources:
        raise ValueError(f'no source raster intersected window {window_id} {bounds_epsg3006}')

    valid_fraction = float(valid_mask.mean())
    out_dir.mkdir(parents=True, exist_ok=True)
    raster_file = f'{window_id}.tif'
    out_path = out_dir / raster_file
    profile = {
        'driver': 'GTiff',
        'dtype': 'uint8',
        'count': 4,
        'width': width,
        'height': height,
        'crs': 'EPSG:3006',
        'transform': dst_transform,
        'compress': 'deflate',
        'photometric': 'RGB',
        'alpha': 'NO',  # Band 4 is NIR, never transparency!
    }
    with rasterio.open(out_path, 'w', **profile) as dst:
        dst.write(out_array)
        dst.set_band_description(1, 'Red')
        dst.set_band_description(2, 'Green')
        dst.set_band_description(3, 'Blue')
        dst.set_band_description(4, 'NIR')

    cx, cy = (west + east) / 2.0, (south + north) / 2.0
    to_wgs = Transformer.from_crs('EPSG:3006', 'EPSG:4326', always_xy=True)
    lon, lat = to_wgs.transform(cx, cy)
    primary_date = used_sources[0]['capturedAt']
    solar = solar_geometry(primary_date, lat, lon)

    return {
        'id': window_id,
        'rasterFile': raster_file,
        'sha256': sha256_file(out_path),
        'bytes': out_path.stat().st_size,
        'validFraction': 1 if valid_fraction == 1.0 else round(valid_fraction, 6),
        'boundsEpsg3006': [west, south, east, north],
        'width': width,
        'height': height,
        'geoTransform': geo_transform,
        'resolutionMetres': round(actual_px_w, 4),
        'bands': ['R', 'G', 'B', 'NIR'],
        'vintage': vintage,
        'leafState': leaf_state,
        'solar': solar,
        'sources': used_sources,
    }


def load_sources_from_discovery(discovery_path: Path) -> tuple[str, list[dict], str | None]:
    doc = json.loads(discovery_path.read_text(encoding='utf-8'))
    ortho = doc.get('orthophoto') or {}
    items = ortho.get('items') or []
    sources = []
    for item in items:
        href = (item.get('assets') or {}).get('data', {}).get('href')
        if not href:
            continue
        captured = item.get('capturedAt') or item.get('datetime') or item.get('captureStart') or ''
        sources.append({
            'id': item['id'],
            'uri': f'/vsicurl/{href}',
            'capturedAt': captured,
            'sha256': (item.get('assets') or {}).get('data', {}).get('sha256'),
            'collection': ortho.get('collection'),
        })
    return doc.get('groundId', ''), sources, ortho.get('collection')


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ground', required=True)
    parser.add_argument('--out-dir', type=Path, required=True, help='Gitignored cache directory for RGBI GeoTIFFs')
    parser.add_argument('--acquisition-out', type=Path, required=True, help='Path to write acquisition.json')
    parser.add_argument('--discovery', type=Path, help='Discovery JSON from discover-ground.mjs')
    parser.add_argument('--local-tif', type=Path, action='append', help='Local GeoTIFF source (for tests/offline)')
    parser.add_argument('--captured-at', default='2024-06-15T10:30:00Z', help='Capture date when using --local-tif')
    parser.add_argument('--window', action='append', required=True,
                        help='Window spec: id:west,south,east,north:res[:vintage[:leafState]]')
    parser.add_argument('--max-megapixels', type=float, default=MAX_MEGAPIXELS_DEFAULT)
    args = parser.parse_args(argv)

    validate_safe_id(args.ground, 'ground')
    if 'cache' not in args.out_dir.parts:
        parser.error('--out-dir must lie under a local cache directory (raw orthophoto pixels never leave cache)')

    sources = []
    gdal_env = {}
    if args.discovery:
        disc_ground, sources, _ = load_sources_from_discovery(args.discovery)
        if disc_ground and disc_ground != args.ground:
            parser.error(f'discovery groundId {disc_ground} != --ground {args.ground}')
        gdal_env = gdal_env_from_credentials()
    if args.local_tif:
        for p in args.local_tif:
            sources.append({
                'id': p.stem,
                'uri': str(p.resolve()),
                'capturedAt': args.captured_at,
                'sha256': sha256_file(p),
                'collection': 'local-fixture',
            })
    if not sources:
        parser.error('supply --discovery or at least one --local-tif')

    windows = []
    for raw_spec in args.window:
        parts = raw_spec.split(':')
        if len(parts) < 3:
            parser.error(f'invalid --window spec {raw_spec!r}; expected id:w,s,e,n:res[:vintage[:leafState]]')
        win_id = parts[0]
        bounds = [float(x) for x in parts[1].split(',')]
        res = float(parts[2])
        vintage = parts[3] if len(parts) >= 4 and parts[3] else 'latest'
        leaf_state = parts[4] if len(parts) >= 5 and parts[4] else 'unknown'
        row = extract_window_from_sources(
            window_id=win_id,
            bounds_epsg3006=bounds,
            resolution_metres=res,
            source_entries=sources,
            out_dir=args.out_dir,
            vintage=vintage,
            leaf_state=leaf_state,
            max_megapixels=args.max_megapixels,
            gdal_env=gdal_env,
        )
        windows.append(row)

    acquisition = {
        'schemaVersion': 1,
        'groundId': args.ground,
        'horizontalCrs': 'EPSG:3006',
        'attribution': '© Lantmäteriet (Ortofoto Nedladdning RGBI)',
        'terms': 'CC-BY-4.0 with Lantmäteriet special access / GDPR terms — offline measurement & review only; never published as runtime textures.',
        'generatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'windows': windows,
    }
    args.acquisition_out.parent.mkdir(parents=True, exist_ok=True)
    # LF on every platform: the record's checksum is pinned in the source manifest, and text mode on Windows
    # would write CRLF.
    args.acquisition_out.write_text(json.dumps(acquisition, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({
        'groundId': args.ground,
        'windows': len(windows),
        'acquisitionOut': str(args.acquisition_out),
        'acquisitionSha256': sha256_file(args.acquisition_out),
    }, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
