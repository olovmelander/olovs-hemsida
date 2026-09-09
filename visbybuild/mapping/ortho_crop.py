"""A georeferenced orthophoto crop of the Visby frame with the model drawn over it.

`visbybuild/ortho-crop.mjs` does the same job through a headless Chromium, and
this container has no playwright at all. Drawing a few hundred polylines needs
no browser -- PIL is enough, and it is what the tracing pipeline here already
imports for the imagery. Same conventions as the Node tool: local metres in,
PNG under cache/crops/, a labelled metre grid, `--plain` for a bare frame
because an overlay hides the pixels it is meant to help you read.

  python3 visbybuild/mapping/ortho_crop.py <name> <cx> <cz> <size> [--gotland | --lm-download]
                                           [--plain] [--metres N] [--marks "x,z,label;..."]
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
import ortho_read as O                                          # noqa: E402

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, '..', 'cache', 'crops')


def draw(name, cx, cz, size, layer='lm016', metres=None, plain=False, marks=()):
    img, aff = O.window(cx, cz, size, layer, metres)
    frame = Image.fromarray(img)
    if not plain:
        pen = ImageDraw.Draw(frame, 'RGBA')
        model = json.load(open(os.path.join(HERE, '..', 'course-model.json')))
        px = lambda ring: [O.to_pixel(aff, x, z) for x, z in ring]
        step = 100 if size > 700 else 50 if size > 300 else 20
        lo_x, lo_z = cx - size / 2, cz - size / 2
        for x in range(int(np.ceil(lo_x / step)) * step, int(cx + size / 2) + 1, step):
            pen.line(px([(x, lo_z), (x, cz + size / 2)]), fill=(255, 255, 0, 90))
            pen.text(O.to_pixel(aff, x + 1, lo_z + 4), f'x{x}', fill=(255, 255, 0, 220))
        for z in range(int(np.ceil(lo_z / step)) * step, int(cz + size / 2) + 1, step):
            pen.line(px([(lo_x, z), (cx + size / 2, z)]), fill=(255, 255, 0, 90))
            pen.text(O.to_pixel(aff, lo_x + 4, z + 1), f'z{z}', fill=(255, 255, 0, 220))
        for water in model['water']:
            pen.line(px(water['ring'] + water['ring'][:1]), fill=(0, 180, 255, 200), width=2)
        for building in model['infra']['buildings']:
            pen.line(px(building['ring'] + building['ring'][:1]), fill=(255, 80, 80, 220), width=2)
        for road in model['infra']['roads'] + model['infra']['paths']:
            pen.line(px(road['line']), fill=(255, 160, 40, 180), width=2)
        for hole in model['holes']:
            pen.line(px(hole['line']), fill=(255, 255, 255, 230), width=2)
            pen.line(px(hole['green']['ring'] + hole['green']['ring'][:1]), fill=(60, 255, 60, 240), width=2)
            for ring in hole['fairway']['rings']:
                pen.line(px(ring + ring[:1]), fill=(120, 255, 160, 150), width=2)
            for pad in hole['tees']['pads']:
                pen.line(px(pad['ring'] + pad['ring'][:1]), fill=(255, 60, 255, 240), width=2)
            for bunker in hole.get('bunkers', []):
                pen.line(px(bunker['ring'] + bunker['ring'][:1]), fill=(255, 255, 120, 220), width=2)
            pen.text(O.to_pixel(aff, *hole['pin']), str(hole['n']), fill=(255, 255, 255, 255))
        for bunker in model['scenery']['bunkers']:
            ring = bunker['ring'] if isinstance(bunker, dict) else bunker
            pen.line(px(ring + ring[:1]), fill=(255, 200, 60, 200), width=2)
        for x, z, label in marks:
            u, v = O.to_pixel(aff, x, z)
            pen.ellipse([u - 6, v - 6, u + 6, v + 6], outline=(255, 0, 0, 255), width=2)
            if label:
                pen.text((u + 8, v - 6), label, fill=(255, 0, 0, 255))
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'{name}{"-plain" if plain else ""}.png')
    frame.save(path)
    if layer == 'lm-download':
        with open(path + '.json', 'w') as handle:
            json.dump(dict(layer=layer, affine=aff, rawImageRedistributed=False), handle, indent=2)
    print(f'{path} {frame.size[0]}x{frame.size[1]}px, {aff["metres"]} m/px, {layer}')
    return path


if __name__ == '__main__':
    argv = sys.argv[1:]
    has = lambda flag: f'--{flag}' in argv
    def value(flag, fallback=None):
        return argv[argv.index(f'--{flag}') + 1] if f'--{flag}' in argv else fallback
    flags = {'--gotland', '--plain', '--lm-download'}
    if has('gotland') and has('lm-download'):
        raise SystemExit('Select one image source')
    skip = set()
    for flag in ('metres', 'marks'):
        if f'--{flag}' in argv:
            skip |= {argv.index(f'--{flag}'), argv.index(f'--{flag}') + 1}
    positional = [item for index, item in enumerate(argv) if item not in flags and index not in skip]
    if len(positional) < 4:
        print(__doc__)
        raise SystemExit(2)
    name, cx, cz, size = positional[0], float(positional[1]), float(positional[2]), float(positional[3])
    marks = []
    for piece in (value('marks') or '').split(';'):
        if piece.strip():
            parts = piece.split(',')
            marks.append((float(parts[0]), float(parts[1]), parts[2] if len(parts) > 2 else ''))
    draw(name, cx, cz, size, 'lm-download' if has('lm-download') else 'gotland' if has('gotland') else 'lm016',
         float(value('metres')) if value('metres') else None, has('plain'), marks)
