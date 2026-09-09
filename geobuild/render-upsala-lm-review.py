#!/usr/bin/env python3
"""Create ignored, exactly georeferenced orthophoto panels for manual review.

No fitted registration, color classification or automatic contouring is used.
An 800 px north-up panel covers an 80 m square around each existing green.
The sidecar records pixel-edge coordinates: E = west + x*resolution,
N = north - y*resolution. Source rasters stay in ignored acquisition cache.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pyproj import Transformer
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import reproject


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, nargs='+', required=True)
    parser.add_argument('--model', type=Path, default=Path('upsalabuild/course-model.json'))
    parser.add_argument('--holes', type=int, nargs='+', default=list(range(1, 19)))
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--metres', type=float, default=80)
    parser.add_argument('--pixels', type=int, default=800)
    parser.add_argument('--focus-source-id', help='Center a detail panel on this green or bunker source ID')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    model = json.loads(args.model.read_text(encoding='utf-8'))
    frame = {key: model[key] for key in ['origin', 'mPerLat', 'mPerLon']}
    forward = Transformer.from_crs('EPSG:4326', 'EPSG:3006', always_xy=True)
    def projected(point):
        x, z = point
        return forward.transform(frame['origin']['lon']+x/frame['mPerLon'], frame['origin']['lat']-z/frame['mPerLat'])
    source_records = []
    rasters = []
    for path in args.source:
        raster = rasterio.open(path)
        if str(raster.crs) != 'EPSG:3006':
            raise ValueError(f'Unexpected source CRS: {raster.crs}')
        rasters.append(raster)
        source_records.append({'path': path.as_posix(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'crs': str(raster.crs), 'width': raster.width, 'height': raster.height, 'geoTransform': list(raster.transform.to_gdal()), 'boundsEPSG3006': list(raster.bounds), 'resolutionM': list(raster.res)})
    panels = []
    try:
        font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 16)
    except OSError:
        font = ImageFont.load_default()
    for hole in model['holes']:
        if hole['n'] not in args.holes:
            continue
        focus = next((shape for shape in [hole['green']]+hole.get('bunkers', []) if shape.get('sourceId') == args.focus_source_id), None) if args.focus_source_id else hole['green']
        if focus is None:
            raise ValueError(f'H{hole["n"]}: missing focus source {args.focus_source_id}')
        center = focus.get('c') or [sum(p[axis] for p in focus['ring'])/len(focus['ring']) for axis in [0, 1]]
        e, n = projected(center)
        half = args.metres/2
        bounds = [e-half, n-half, e+half, n+half]
        west, south, east, north = bounds
        transform = from_bounds(*bounds, args.pixels, args.pixels)
        rgb = np.zeros((3, args.pixels, args.pixels), dtype=np.uint8)
        coverage = np.zeros((args.pixels, args.pixels), dtype=np.uint8)
        contributing = []
        for raster, source in zip(rasters, source_records):
            if raster.bounds.right < west or raster.bounds.left > east or raster.bounds.top < south or raster.bounds.bottom > north:
                continue
            contributing.append(source)
            reproject(source=raster.dataset_mask(), destination=coverage, src_transform=raster.transform, src_crs=raster.crs, dst_transform=transform, dst_crs='EPSG:3006', resampling=Resampling.nearest, src_nodata=0, dst_nodata=0, init_dest_nodata=False)
            for band in range(3):
                reproject(source=rasterio.band(raster, band+1), destination=rgb[band], src_transform=raster.transform, src_crs=raster.crs, dst_transform=transform, dst_crs='EPSG:3006', resampling=Resampling.bilinear, src_nodata=None, dst_nodata=0, init_dest_nodata=False)
        if not contributing:
            raise ValueError(f'H{hole["n"]}: no source intersects panel')
        if not np.all(coverage):
            raise ValueError(f'H{hole["n"]}: panel has {np.count_nonzero(coverage == 0)} uncovered pixels; request a smaller extent or more source coverage')
        resolution = args.metres/args.pixels
        def pixel(point):
            px, py = projected(point)
            return ((px-west)/resolution, (north-py)/resolution)
        plain = Image.fromarray(np.moveaxis(rgb, 0, -1))
        plain_path = args.out/f'hole-{hole["n"]:02d}-plain.png'
        plain.save(plain_path)
        overlay = plain.copy()
        draw = ImageDraw.Draw(overlay)
        for pos in range(0, args.pixels, 100):
            draw.line([(pos, 0), (pos, args.pixels)], fill='#ffffff55', width=1)
            draw.line([(0, pos), (args.pixels, pos)], fill='#ffffff55', width=1)
            draw.text((pos+3, 3), str(pos), fill='white', font=font, stroke_width=2, stroke_fill='black')
            if pos:
                draw.text((3, pos+3), str(pos), fill='white', font=font, stroke_width=2, stroke_fill='black')
        shapes = [('green', hole['green'])] + [('bunker', b) for b in hole.get('bunkers', [])]
        visible = []
        for kind, shape in shapes:
            ring = [pixel(p) for p in shape['ring']]
            if max(p[0] for p in ring) < 0 or min(p[0] for p in ring) > args.pixels or max(p[1] for p in ring) < 0 or min(p[1] for p in ring) > args.pixels:
                continue
            color = '#00ffff' if kind == 'green' else '#ff50ff'
            draw.line(ring+[ring[0]], fill=color, width=2)
            center = (sum(p[0] for p in ring)/len(ring),sum(p[1] for p in ring)/len(ring))
            draw.text(center, shape.get('sourceId','?'), fill=color, font=font, stroke_width=2, stroke_fill='black')
            visible.append({'kind': kind, 'sourceId': shape.get('sourceId'), 'originalShape': shape, 'originalShapePanelPixelRing': ring})
        overlay_path = args.out/f'hole-{hole["n"]:02d}-overlay.png'
        overlay.save(overlay_path)
        panel = {'hole': hole['n'], 'focusSourceId': focus.get('sourceId'), 'plainPath': plain_path.as_posix(), 'overlayPath': overlay_path.as_posix(), 'pixelSize': [args.pixels, args.pixels], 'extentEPSG3006': bounds, 'geoTransform': list(transform.to_gdal()), 'pixelCoordinateConvention': 'pixel edges; E=west+x*resolution, N=north-y*resolution', 'resampling': 'bilinear display only; native source retained', 'sources': contributing, 'shapes': visible}
        panels.append(panel)
    document = {'schemaVersion': 1, 'frame': frame, 'modelSha256': hashlib.sha256(args.model.read_bytes()).hexdigest(), 'projection': 'pyproj EPSG:4326 to EPSG:3006 through the declared legacy local frame; no fitted offset', 'panels': panels}
    path = args.out/'panels.json'
    path.write_text(json.dumps(document, indent=2)+'\n', encoding='utf-8')
    print(path)


if __name__ == '__main__':
    main()
