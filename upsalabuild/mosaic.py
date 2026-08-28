# Stitch cached Esri tiles into georeferenced mosaics/crops for tracing.
#
#   python3 nvgkbuild/mosaic.py overview out.png          # whole z17 frame, half res
#   python3 nvgkbuild/mosaic.py crop out.png x0 z0 x1 z1  # z18 full res, world metres
#
# Every output is stamped with its world-frame georeference in a sidecar JSON:
# px <-> world is affine (Mercator locally linear at this scale), so a trace made
# in crop pixels converts to metres exactly like a tile does — no registration.
import json, math, os, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SAT = os.path.join(HERE, 'cache', 'sat')
LAT0, LON0 = 59.83900, 17.49520
M_PER_LAT = 111320.0
M_PER_LON = 111320.0 * math.cos(math.radians(LAT0))

def tile_of(x, z, Z):
    lon = x / M_PER_LON + LON0
    lat = LAT0 - z / M_PER_LAT
    n = 2 ** Z
    tx = (lon + 180) / 360 * n
    ty = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return tx, ty

def world_of(tx, ty, Z):
    n = 2 ** Z
    lon = tx / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * ty / n))))
    return (lon - LON0) * M_PER_LON, (LAT0 - lat) * M_PER_LAT

def stitch(Z, x0, z0, x1, z1):
    tx0, ty0 = tile_of(x0, z0, Z)
    tx1, ty1 = tile_of(x1, z1, Z)
    ix0, iy0 = int(tx0), int(ty0)
    ix1, iy1 = int(tx1), int(ty1)
    W, H = (ix1 - ix0 + 1) * 256, (iy1 - iy0 + 1) * 256
    im = Image.new('RGB', (W, H), (10, 10, 14))
    missing = 0
    for iy in range(iy0, iy1 + 1):
        for ix in range(ix0, ix1 + 1):
            f = os.path.join(SAT, f'{Z}_{ix}_{iy}.jpg')
            if not os.path.exists(f):
                missing += 1; continue
            im.paste(Image.open(f), ((ix - ix0) * 256, (iy - iy0) * 256))
    if missing: print(f'({missing} tiles missing)', file=sys.stderr)
    # crop to the requested world window
    px0 = (tx0 - ix0) * 256; py0 = (ty0 - iy0) * 256
    px1 = (tx1 - ix0) * 256; py1 = (ty1 - iy0) * 256
    im = im.crop((int(px0), int(py0), int(px1), int(py1)))
    # georeference of the crop: world at pixel (0,0) and metres per pixel
    wx0, wz0 = world_of(ix0 + px0 / 256 if False else tx0, ty0, Z)
    wx1, wz1 = world_of(tx1, ty1, Z)
    geo = { 'z': Z, 'x0': wx0, 'z0': wz0, 'x1': wx1, 'z1': wz1,
            'mppx': (wx1 - wx0) / im.width, 'mppy': (wz1 - wz0) / im.height,
            'w': im.width, 'h': im.height }
    return im, geo

cmd = sys.argv[1]
out = sys.argv[2]
if cmd == 'overview':
    im, geo = stitch(17, -1500, -1500, 1200, 1600)
    im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
    geo['mppx'] *= 2; geo['mppy'] *= 2; geo['w'] = im.width; geo['h'] = im.height
elif cmd == 'crop':
    x0, z0, x1, z1 = map(float, sys.argv[3:7])
    im, geo = stitch(18, x0, z0, x1, z1)
else:
    raise SystemExit('overview|crop')
im.save(out)
with open(out + '.json', 'w') as f: json.dump(geo, f)
print(out, im.size, f"{geo['mppx']:.3f} m/px", 'world', round(geo['x0'],1), round(geo['z0'],1), '->', round(geo['x1'],1), round(geo['z1'],1))
