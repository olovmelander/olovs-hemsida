"""Private orthophoto crops with explicit pixel-edge coordinates for tracing."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer
import rasterio
from rasterio.windows import from_bounds

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'tortunabuild/cache/orthophoto'
OUT = ROOT / 'tortunabuild/cache/mapping-review'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--holes', default='1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18')
    parser.add_argument('--kind', choices=['green', 'tee', 'hole'], default='green')
    args = parser.parse_args()
    wanted = {int(v) for v in args.holes.split(',')}
    source = json.loads((ROOT / 'tortunabuild/reference/routing-golftraxx.json').read_text(encoding='utf8'))
    trans = Transformer.from_crs(4326, 3006, always_xy=True)
    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    images = []
    for hole in source['holes']:
        n = hole['number']
        if n not in wanted:
            continue
        green = trans.transform(*hole['greenCenter'])
        tee = trans.transform(*hole['teeBack'])
        target = trans.transform(*hole['teeTarget'])
        centre = green if args.kind == 'green' else tee if args.kind == 'tee' else ((green[0]+tee[0])/2, (green[1]+tee[1])/2)
        span = 128 if args.kind != 'hole' else max(abs(green[0]-tee[0]), abs(green[1]-tee[1])) + 160
        bounds = [centre[0]-span/2, centre[1]-span/2, centre[0]+span/2, centre[1]+span/2]
        # Use a common explicit grid and mosaic north/south only where available.
        size = 512
        rgb = np.zeros((size, size, 3), dtype='uint8')
        from rasterio.warp import reproject, Resampling
        dst_transform = rasterio.transform.from_bounds(*bounds, size, size)
        used = []
        for half in ['south', 'north']:
            file = CACHE / (half + '.tif')
            if not file.exists() or file.stat().st_size < 1024:
                continue
            with rasterio.open(file) as src:
                if bounds[2] <= src.bounds.left or bounds[0] >= src.bounds.right or bounds[3] <= src.bounds.bottom or bounds[1] >= src.bounds.top:
                    continue
                for band in range(3):
                    reproject(rasterio.band(src, band+1), rgb[:, :, band], src_transform=src.transform,
                              src_crs=src.crs, dst_transform=dst_transform, dst_crs='EPSG:3006',
                              resampling=Resampling.bilinear, init_dest_nodata=False)
                used.append(half)
        if not used:
            continue
        img = Image.fromarray(rgb)
        file = OUT / f'{args.kind}-{n:02}.png'
        img.save(file)
        labelled = Image.new('RGB', (512, 542), '#102c24')
        labelled.paste(img, (0, 30))
        draw = ImageDraw.Draw(labelled)
        draw.text((8, 8), f'H{n} {args.kind} | {span:.1f} m square | north up', fill='white')
        # Routing marks are on the review copy only, not the raw tracing image.
        for label, point in [('G', green), ('T', tee), ('L', target)]:
            x, y = (point[0]-bounds[0])/span*size, (bounds[3]-point[1])/span*size+30
            if 0 <= x < size and 30 <= y < 542:
                draw.ellipse((x-3, y-3, x+3, y+3), outline='red', width=1)
                draw.text((x+5, y), label, fill='red')
        labelled.save(OUT / f'{args.kind}-{n:02}-labelled.png')
        images.append(labelled)
        index.append({'hole': n, 'kind': args.kind, 'file': file.relative_to(ROOT).as_posix(),
                      'boundsEpsg3006': bounds, 'width': size, 'height': size,
                      'pixelMeaning': 'edge; E=west+x*span/width, N=north-y*span/height',
                      'sourceWindows': used, 'displayResampling': 'bilinear',
                      'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
    (OUT / f'{args.kind}-index.json').write_text(json.dumps(index, indent=2)+'\n', encoding='utf8')
    for start in range(0, len(images), 6):
        sheet = Image.new('RGB', (1536, 1084), '#102c24')
        for j, img in enumerate(images[start:start+6]):
            sheet.paste(img, ((j%3)*512, (j//3)*542))
        sheet.save(OUT / f'{args.kind}-sheet-{start//6+1}.png')
    print(json.dumps({'crops': len(index), 'kind': args.kind, 'output': str(OUT)}))


if __name__ == '__main__':
    main()
