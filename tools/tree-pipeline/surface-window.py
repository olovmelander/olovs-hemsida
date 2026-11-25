#!/usr/bin/env python3
"""Lantmäteriet's surface model matched from aerial photos (Ythöjdmodell, dsm-cog), cut to a tree window.

Called by tools/tree-pipeline/surface-models.mjs, which finds and pins the items and passes the credentials in the
environment (never on the command line, never printed). For one flight year it reads every pinned item's part of
the window at its native 0.25 m, takes the highest of each 2 x 2 cells (a canopy surface keeps its tops, as the
laser canopy model does), and writes on the laser canopy model's own 0.5 m grid:

    dsm-photo-<year>-050.bin     the surface, RH 2000 (float32, NaN where nothing was matched)
    chm-photo-<year>-050.bin     the surface less the 1 m terrain (bilinear), so heights above ground

each with a .json descriptor like the pipeline's other rasters. The model is matched from the same photos as that
year's orthophoto, so it stands where the photo shows the tree; crown edges are smoothed and a small or isolated
tree may not be matched at all.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import from_bounds

ROOT = Path(__file__).resolve().parents[2]


def gdal_auth():
    """GDAL options for Lantmäteriet's download host, from the environment only."""
    bearer, user, password = (os.environ.get(k) for k in ('LANTMATERIET_BEARER_TOKEN', 'LANTMATERIET_USERNAME', 'LANTMATERIET_PASSWORD'))
    for value in (bearer, user, password):
        if value and any(c in value for c in '\r\n\0'):
            raise SystemExit('a credential contains a forbidden control character')
    if bearer:
        return dict(GDAL_HTTP_HEADERS=f'Authorization: Bearer {bearer}')
    if user and password:
        return dict(GDAL_HTTP_USERPWD=f'{user}:{password}', GDAL_HTTP_AUTH='BASIC')
    raise SystemExit('no Lantmäteriet credentials in the environment: run through node --env-file=.env')


def terrain_sampler(spec):
    """Bilinear heights from a north-up float32 terrain grid whose samples are cell centres (the trace config's terrain)."""
    side = spec['side']
    grid = np.fromfile(ROOT / spec['path'], dtype=np.float32).reshape(side, side)
    e0, n0 = spec['firstEasting'], spec['firstNorthing']

    def at(east, north):
        c, r = east - e0, n0 - north
        c0, r0 = np.floor(c).astype(np.int64), np.floor(r).astype(np.int64)
        fc, fr = c - c0, r - r0
        c0, r0 = np.clip(c0, 0, side - 2), np.clip(r0, 0, side - 2)
        top = grid[r0, c0] * (1 - fc) + grid[r0, c0 + 1] * fc
        bottom = grid[r0 + 1, c0] * (1 - fc) + grid[r0 + 1, c0 + 1] * fc
        return top * (1 - fr) + bottom * fr
    return at


def descriptor(layer, grid, data_path, meaning, extra):
    return dict(layer=layer, dtype='float32', width=grid['width'], height=grid['height'], sampleSpacingMetres=grid['spacing'],
                originEasting=grid['originEasting'], originNorthing=grid['originNorthing'],
                cellConvention='north-up; row 0 is the northern edge; cell edges on the origin', crs='EPSG:3006 / heights RH2000',
                sha256=hashlib.sha256(data_path.read_bytes()).hexdigest(), meaning=meaning, noData='NaN = nothing matched', **extra)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pins', type=Path, required=True)
    ap.add_argument('--year', type=int, required=True)
    ap.add_argument('--grid', type=Path, required=True, help='a .json descriptor of the laser canopy model whose 0.5 m grid to share')
    ap.add_argument('--terrain', type=Path, required=True, help='a trace-config.json whose "terrain" is the 1 m terrain grid')
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()
    pins = json.loads(args.pins.read_text(encoding='utf-8'))
    items = [i for i in pins['items'] if i['year'] == args.year]
    if not items:
        raise SystemExit(f'no pinned item for {args.year}')
    g = json.loads(args.grid.read_text(encoding='utf-8'))
    grid = dict(width=g['width'], height=g['height'], spacing=g['sampleSpacingMetres'], originEasting=g['originEasting'], originNorthing=g['originNorthing'])
    if grid['spacing'] != 0.5:
        raise SystemExit('the surface is pooled 2 x 2 from 0.25 m: the grid must be 0.5 m')
    e0, n1 = grid['originEasting'], grid['originNorthing']
    e1, n0 = e0 + grid['width'] * 0.5, n1 - grid['height'] * 0.5
    dsm = np.full((grid['height'], grid['width']), np.nan, dtype=np.float32)
    env = dict(GDAL_HTTP_USERAGENT='course-geo-toolchain', GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',
               GDAL_HTTP_MULTIRANGE='YES', GDAL_HTTP_MERGE_CONSECUTIVE_RANGES='YES', GDAL_HTTP_MAX_RETRY='5', GDAL_HTTP_RETRY_DELAY='3', **gdal_auth())
    read_cells = 0
    with rasterio.Env(**env):
        for item in items:
            try:
                src = rasterio.open(f"/vsicurl/{item['href']}")
            except rasterio.errors.RasterioIOError as error:
                if '403' in str(error):
                    raise SystemExit("Lantmäteriet refuses this account the surface model (HTTP 403): the laser and photos load, so the product "
                                     "'Ythöjdmodell' is not on the API account. Add it on Lantmäteriet's Geotorget, then run again.")
                raise
            with src:
                if src.res != (0.25, 0.25) or src.crs.to_epsg() not in (5845, 3006):
                    raise SystemExit(f"{item['id']}: not a 0.25 m SWEREF 99 TM surface ({src.res}, {src.crs})")
                b = src.bounds
                ie0, in0, ie1, in1 = max(e0, b.left), max(n0, b.bottom), min(e1, b.right), min(n1, b.top)
                if ie0 >= ie1 or in0 >= in1:
                    continue
                # whole 0.5 m cells of our grid, read in bands of rows to bound the memory
                c0, c1 = int(round((ie0 - e0) / 0.5)), int(round((ie1 - e0) / 0.5))
                r0, r1 = int(round((n1 - in1) / 0.5)), int(round((n1 - in0) / 0.5))
                for rs in range(r0, r1, 512):
                    re = min(r1, rs + 512)
                    win = from_bounds(e0 + c0 * 0.5, n1 - re * 0.5, e0 + c1 * 0.5, n1 - rs * 0.5, transform=src.transform).round_offsets().round_lengths()
                    data = src.read(1, window=win, masked=True).astype(np.float32).filled(np.nan)
                    h, w = (re - rs) * 2, (c1 - c0) * 2
                    data = data[:h, :w]
                    if data.shape != (h, w):
                        pad = np.full((h, w), np.nan, dtype=np.float32)
                        pad[:data.shape[0], :data.shape[1]] = data
                        data = pad
                    pooled = data.reshape(re - rs, 2, c1 - c0, 2)
                    with np.errstate(all='ignore'):
                        top = np.nanmax(np.nanmax(pooled, axis=3), axis=1)
                    target = dsm[rs:re, c0:c1]
                    dsm[rs:re, c0:c1] = np.where(np.isnan(target), top, np.fmax(target, top))
                    read_cells += h * w
            print(f"{item['id']}: read", flush=True)
    spec = json.loads(args.terrain.read_text(encoding='utf-8'))['terrain']
    at = terrain_sampler(spec)
    east = e0 + (np.arange(grid['width']) + 0.5) * 0.5
    chm = np.empty_like(dsm)
    for r in range(0, grid['height'], 512):
        rows = np.arange(r, min(grid['height'], r + 512))
        north = n1 - (rows + 0.5) * 0.5
        ee, nn = np.meshgrid(east, north)
        chm[rows[0]:rows[-1] + 1] = dsm[rows[0]:rows[-1] + 1] - at(ee, nn).astype(np.float32)
    args.out.mkdir(parents=True, exist_ok=True)
    year = args.year
    flown = sorted({i['datetime'][:10] for i in items})
    out = {}
    for layer, data, meaning in ((f'dsm-photo-{year}-050', dsm, 'surface matched from aerial photos, highest of 2 x 2 native 0.25 m cells, RH 2000'),
                                 (f'chm-photo-{year}-050', chm, 'that surface less the 1 m terrain (bilinear): height above ground')):
        path = args.out / f'{layer}.bin'
        data.astype('<f4').tofile(path)
        info = descriptor(layer, grid, path, meaning, dict(flown=flown, items=[i['id'] for i in items], terrain=dict(path=spec['path'], sha256=spec['sha256'])))
        (args.out / f'{layer}.json').write_text(json.dumps(info, indent=1) + '\n', encoding='utf-8', newline='\n')
        out[layer] = info['sha256']
    matched = np.isfinite(dsm)
    print(json.dumps(dict(year=year, flown=flown, cellsMatched=round(float(matched.mean()), 4), nativeCellsRead=read_cells,
                          canopyOver2m=round(float((chm[matched] > 2).mean()), 4), files=out), indent=1))


if __name__ == '__main__':
    main()
