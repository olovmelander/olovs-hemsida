"""Create bounded, georeferenced display panels from acquired Ängsö imagery."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'angsobuild/cache/lm-ortho'
OUT = CACHE / 'review-panels'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--holes', nargs='+', type=int, required=True)
    parser.add_argument('--replan', action='store_true', help='Replace pinned baseline crop definitions')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    model = json.loads((ROOT/'angsobuild/course-model.json').read_text(encoding='utf-8'))
    project = Transformer.from_crs(4326, 3006, always_xy=True)
    sources = {}
    for n in args.holes:
        stem = f'angso-{n:02}-hole'
        ledger = json.loads((CACHE/(stem+'.json')).read_text(encoding='utf-8'))
        native = Image.open(CACHE/(stem+'.png')).convert('RGB')
        t = ledger['geoTransform']
        def pixel(p):
            e, north = project.transform(model['origin']['lon']+p[0]/model['mPerLon'], model['origin']['lat']-p[1]/model['mPerLat'])
            return [(e-t[0])/t[1], (north-t[3])/t[5]]
        hole = next(h for h in model['holes'] if h['n'] == n)
        features = [('green', hole['green']['ring'])]
        features += [('bunker', b['ring']) for b in hole['bunkers']]
        features += [('tee', b['ring']) for b in hole['tees']['pads']]
        features += [('fairway', ring) for ring in hole['fairway']['rings']]
        gc = pixel(hole['green']['c'])
        half = 50/t[1]
        definitions = [('hole', [0,0,native.width,native.height], 0.5),
                       ('green', [gc[0]-half,gc[1]-half,gc[0]+half,gc[1]+half], 1)]
        definition_file = OUT/f'definitions-{n:02}.json'
        if definition_file.exists() and not args.replan:
            definitions = json.loads(definition_file.read_text())
        else:
            definition_file.write_text(json.dumps(definitions,indent=2)+'\n')
        for kind, box, scale in definitions:
            box = [max(0, int(box[0])), max(0,int(box[1])), min(native.width,int(box[2])+1), min(native.height,int(box[3])+1)]
            plain = native.crop(box)
            if scale != 1:
                plain = plain.resize((round(plain.width*scale),round(plain.height*scale)), Image.Resampling.LANCZOS)
            sx, sy = (box[2]-box[0])/plain.width, (box[3]-box[1])/plain.height
            affine = [t[0]+box[0]*t[1], t[1]*sx, 0, t[3]+box[1]*t[5], 0, t[5]*sy]
            key = f'h{n:02}-{kind}'
            path = OUT/(key+'.png')
            plain.save(path)
            record = dict(horizontalCrs='EPSG:3006', sha256=sha(path),
                          requestSha256=hashlib.sha256(json.dumps([ledger['sha256'],box,scale]).encode()).hexdigest(),
                          sourceIds=[s['id'] for s in ledger['sources']], width=plain.width, height=plain.height,
                          geoTransform=affine, boundsEpsg3006=[affine[0],affine[3]+plain.height*affine[5],affine[0]+plain.width*affine[1],affine[3]],
                          rasterFile=path.relative_to(ROOT).as_posix(), nativeRasterSha256=ledger['sha256'],
                          nativeRasterFile=(CACHE/(stem+'.tif')).relative_to(ROOT).as_posix(),
                          capturedAt='2025-04-24', resampling='Lanczos display' if scale != 1 else 'native crop')
            sources[key] = record
            overlay = plain.copy()
            draw = ImageDraw.Draw(overlay)
            for feature, ring in features:
                points = [((p[0]-box[0])/sx,(p[1]-box[1])/sy) for p in map(pixel, ring)]
                draw.line(points+[points[0]], fill={'green':'cyan','bunker':'yellow','tee':'white','fairway':'magenta'}[feature],width=2)
            for x in range(0,plain.width,100):
                draw.text((x+2,2),str(x),fill='white',stroke_width=1,stroke_fill='black')
            for y in range(100,plain.height,100):
                draw.text((2,y),str(y),fill='white',stroke_width=1,stroke_fill='black')
            overlay.save(OUT/(key+'-overlay.png'))
    (OUT/('sources-'+ '-'.join(map(str,args.holes))+'.json')).write_text(json.dumps(sources,indent=2)+'\n',encoding='utf-8')
    print(f'Wrote {len(sources)} panels to {OUT}')


if __name__ == '__main__':
    main()
