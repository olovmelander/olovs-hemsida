"""Make bounded, georeferenced image panels for manual orthophoto review.

python nvgkbuild/mapping/lm-review-crop.py norrfallsviken-01-hole --max-size 1800
python nvgkbuild/mapping/lm-review-crop.py facilities-range --crop 0 0 1200 1000
Panel JSON uses displayed pixel edges, so tracing coordinates can be converted
without manually undoing crop offsets or preview scaling. --overlay selects the
pinned, uncorrected baseline outlines; --grid adds displayed pixel coordinates.
"""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'nvgkbuild/cache/lm-ortho'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('window')
    parser.add_argument('--crop', nargs=4, type=int, metavar=('LEFT','TOP','RIGHT','BOTTOM'))
    parser.add_argument('--max-size', type=int, default=1800)
    parser.add_argument('--overlay', action='store_true')
    parser.add_argument('--grid', action='store_true')
    parser.add_argument('--name')
    args = parser.parse_args()
    if Path(args.window).name != args.window or args.max_size < 64 or args.max_size > 4096:
        raise ValueError('Invalid window name or panel size')
    source = CACHE / (args.window + ('-overlay' if args.overlay else '') + '.png')
    record = json.loads((CACHE / (args.window + '.json')).read_text(encoding='utf-8'))
    image = Image.open(source)
    crop = args.crop or [0,0,image.width,image.height]
    left,top,right,bottom = crop
    if not 0 <= left < right <= image.width or not 0 <= top < bottom <= image.height:
        raise ValueError('Crop must remain inside acquired pixel extent')
    panel = image.crop(crop)
    panel.thumbnail((args.max_size,args.max_size),Image.Resampling.LANCZOS)
    resolution = record['resolutionMetres']
    min_e,_,_,max_n = record['boundsEpsg3006']
    affine = [min_e+left*resolution,(right-left)*resolution/panel.width,0,
              max_n-top*resolution,0,-(bottom-top)*resolution/panel.height]
    name = args.name or args.window + ('-overlay' if args.overlay else '') + ('-crop' if args.crop else '-panel')
    if Path(name).name != name:
        raise ValueError('Panel name must not include directories')
    target = CACHE / 'review' / (name+'.png')
    target.parent.mkdir(parents=True,exist_ok=True)
    if args.grid:
        draw=ImageDraw.Draw(panel)
        try:
            font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',14)
        except OSError:
            font=ImageFont.load_default()
        for x in range(0,panel.width,100):
            draw.line((x,0,x,panel.height),fill=(255,255,255,80),width=1)
            draw.text((x+2,2),str(x),font=font,fill='yellow',stroke_width=2,stroke_fill='black')
        for y in range(0,panel.height,100):
            draw.line((0,y,panel.width,y),fill=(255,255,255,80),width=1)
            draw.text((2,y+2),str(y),font=font,fill='yellow',stroke_width=2,stroke_fill='black')
    panel.save(target)
    metadata=dict(schemaVersion=1,kind='manual-orthophoto-review-panel',groundId='norrfallsviken',
                  sourceWindow=args.window,sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                  sourceCropPixelEdges=crop,displayWidth=panel.width,displayHeight=panel.height,
                  horizontalCrs='EPSG:3006',geoTransform=affine,
                  pixelConvention='E=geoTransform[0]+displayColumn*geoTransform[1]; N=geoTransform[3]+displayRow*geoTransform[5]; display pixel edges',
                  sourceResolutionMetres=resolution,baselineOverlay=args.overlay,
                  sourceCapture=record['sources'])
    target.with_suffix('.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(image=str(target.relative_to(ROOT)),width=panel.width,height=panel.height,geoTransform=affine)))


if __name__ == '__main__':
    main()
