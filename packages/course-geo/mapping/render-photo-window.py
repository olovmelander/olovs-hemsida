#!/usr/bin/env python3
"""One window of the photo, with a metre grid and any mapped layers drawn on it: the tool for reading coordinates.

    pixi run --manifest-path packages/course-geo/toolchain/pixi.toml -e mapping --frozen \
      python packages/course-geo/mapping/render-photo-window.py --config <build>/mapping/trace-config.json \
        --box E0 N0 E1 N1 --out <picture> [--compare <older-photo.tif> ...] [--grid 10] [--px 1200] [--infrared]
        [--layer <geojson>[@colour[@kind,kind]]] ... [--labels]

    --at E N --span 80    is a square window round a point, in place of --box.

Every decision a reviewer writes (a tee deck drawn by hand, a bend in a hole line, a seed for a green, a wall, a row
of carts) is a coordinate read off the photo. This draws the window to read it from. With --compare the older photo
is drawn beside it, which shows what was rebuilt between the two. A layer is any EPSG:3006 GeoJSON: the traced
surfaces, the water, the infrastructure, the OSM seed. The picture is a crop of the photo and stays private: write
it under the build's cache.
"""
import argparse
from pathlib import Path

from PIL import Image, ImageDraw

from photo_views import ROOT, Imagery, crop, draw_grid, font, load_json, pixel


def lines_of(geometry):
    kind, c = geometry['type'], geometry['coordinates']
    if kind == 'Polygon':
        return c
    if kind == 'MultiPolygon':
        return [ring for polygon in c for ring in polygon]
    if kind == 'LineString':
        return [c]
    if kind == 'MultiLineString':
        return c
    return []


def draw_layer(draw, spec, box, width, height, labels):
    parts = spec.split('@')
    kinds = set(parts[2].split(',')) if len(parts) > 2 else None
    colour = parts[1] if len(parts) > 1 else 'white'
    f = font(13)
    for feature in load_json(ROOT / parts[0] if not Path(parts[0]).is_absolute() else parts[0])['features']:
        props = feature.get('properties') or {}
        kind = props.get('kind') or (props.get('tags') or {}).get('golf') or ''
        if kinds and kind not in kinds:
            continue
        if feature['geometry']['type'] == 'Point':
            x, y = pixel(feature['geometry']['coordinates'], box, width, height)
            draw.ellipse([x - 4, y - 4, x + 4, y + 4], outline=colour, width=2)
            continue
        for line in lines_of(feature['geometry']):
            pts = [pixel(p, box, width, height) for p in line]
            if max(p[0] for p in pts) < 0 or min(p[0] for p in pts) > width or max(p[1] for p in pts) < 0 or min(p[1] for p in pts) > height:
                continue
            draw.line(pts, fill=colour, width=2)
            if labels and feature.get('id') is not None:
                cx, cy = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
                if 0 <= cx <= width and 0 <= cy <= height:
                    draw.text((cx, cy), str(feature['id']), fill=colour, font=f, stroke_width=2, stroke_fill='black')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--config', type=Path, required=True)
    ap.add_argument('--box', type=float, nargs=4, metavar=('E0', 'N0', 'E1', 'N1'))
    ap.add_argument('--at', type=float, nargs=2, metavar=('E', 'N'))
    ap.add_argument('--span', type=float, default=80)
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--compare', type=Path, nargs='*', default=[])
    ap.add_argument('--grid', type=int, default=10)
    ap.add_argument('--px', type=int, default=1200)
    ap.add_argument('--infrared', action='store_true')
    ap.add_argument('--layer', action='append', default=[])
    ap.add_argument('--labels', action='store_true')
    args = ap.parse_args()
    if not args.box and not args.at:
        ap.error('give --box E0 N0 E1 N1 or --at E N')
    box = tuple(args.box) if args.box else (args.at[0] - args.span / 2, args.at[1] - args.span / 2, args.at[0] + args.span / 2, args.at[1] + args.span / 2)
    if box[2] <= box[0] or box[3] <= box[1]:
        ap.error('the box is empty: E0 N0 is its south-west corner, E1 N1 its north-east')
    cfg = load_json(args.config)
    sources = [Imagery([ROOT / p for p in cfg['imagery']['rasters']])] + ([Imagery(args.compare)] if args.compare else [])
    width, height = args.px, max(1, round(args.px * (box[3] - box[1]) / (box[2] - box[0])))
    out = Image.new('RGB', (width * len(sources) + 4 * (len(sources) - 1), height), (0, 0, 0))
    for k, imagery in enumerate(sources):
        im = crop(imagery, box, width, height, infrared=args.infrared)
        d = ImageDraw.Draw(im)
        if args.grid:
            draw_grid(d, box, width, args.grid, height=height, labels_every=max(1, round(50 / args.grid)) if box[2] - box[0] > 400 else 1)
        for spec in args.layer:
            draw_layer(d, spec, box, width, height, args.labels)
        out.paste(im, (k * (width + 4), 0))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    out.save(args.out, quality=90)
    print(f'{args.out} {out.size[0]}x{out.size[1]}, {box[2] - box[0]:.0f} x {box[3] - box[1]:.0f} m, grid {args.grid} m')


if __name__ == '__main__':
    main()
