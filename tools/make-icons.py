# The web-app manifest needs raster icons; PIL cannot render the SVG favicon, so
# the same three shapes are drawn directly. Keeping them in one script means the
# tab icon and the installed-app icon cannot drift apart by hand-editing one.
from PIL import Image, ImageDraw
import pathlib
OUT = pathlib.Path('apps/golf/public/icons'); OUT.mkdir(parents=True, exist_ok=True)
GROUND, TURF, GREEN, POLE = (11,26,19), (95,208,122), (30,92,51), (232,240,234)

def icon(px, maskable=False):
    S = px * 8                                   # supersample, then LANCZOS down
    im = Image.new('RGB', (S, S), GROUND); d = ImageDraw.Draw(im)
    # a maskable icon is cropped to a circle by the launcher, so its content has
    # to sit inside the safe zone -- 80% of the width, centred
    k = 0.62 if maskable else 0.80
    cx, cy, u = S/2, S/2, S*k/32                 # u = one unit of the 32-box
    if not maskable:                             # rounded square, like the svg
        im2 = Image.new('RGB', (S, S), GROUND); d = ImageDraw.Draw(im2); im = im2
    d.ellipse([cx-9.5*u, cy+6.4*u, cx+9.5*u, cy+11.6*u], fill=GREEN)
    d.rectangle([cx-1.4*u, cy-10*u, cx+0.5*u, cy+8*u], fill=POLE)
    d.polygon([(cx+0.5*u, cy-9.4*u), (cx+10*u, cy-5.6*u), (cx+0.5*u, cy-1.8*u)], fill=TURF)
    return im.resize((px, px), Image.LANCZOS)

for px in (192, 512):
    icon(px).save(OUT / f'icon-{px}.png')
    print(f'  icon-{px}.png')
icon(512, maskable=True).save(OUT / 'icon-maskable-512.png')
print('  icon-maskable-512.png')
