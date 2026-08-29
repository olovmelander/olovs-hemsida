#!/usr/bin/env python3
"""Turn a raw engine still into the poster the chooser actually ships.

usage: python3 tools/make-posters.py [--check]

The shot harness writes 1600x900 PNGs, because that is what a screenshot is and
a parity comparison needs every bit of it. A chooser card is about 400x225 CSS
pixels, so even on a 2x display the poster is being handed four times the pixels
it can show, in a format chosen for exactness rather than for photographs. Six of
those is roughly 7 MB on the app's front door -- the first screen a phone on a
Swedish mobile network sees, and the brief for this app names Android and iOS
before it names desktop.

So the posters are built, not copied: downscale to 2x the card, then WebP. The
source stills stay in the harness, untouched and reproducible; this is the
derived artefact, the same relationship the packs have with the models.

WHAT THE SETTINGS COST, measured rather than asserted. Each poster was compared
against a lossless LANCZOS downscale of the same still, both sampled at the
card's own 400x225 -- which is where a person actually looks at it:

    resize alone            0.43-0.48 mean/255, worst 2-5
    jpeg q82   38-52 KB     2.41-3.15 mean,     worst 36-56
    jpeg q90   54-73 KB     2.00-2.62 mean,     worst 39-42
    webp q90   40-58 KB     1.93-2.28 mean,     worst 28-45
    webp q95   59-87 KB     1.65-1.90 mean,     worst 30-42

Two things that decides. The resize is nearly free, so essentially all the loss
is the codec -- these stills are full of fine foliage and micro-detail, which is
the hardest thing there is to compress. And WebP beats JPEG on BOTH axes at the
same quality number: less error and about 20% fewer bytes, so there is no reason
to ship the JPEG. q90 sits at the knee; q95 buys 0.4/255 for half again the size.

Note what is NOT claimed: not that the difference is invisible. At 2/255 mean on
a decorative poster in a dark UI it is very unlikely to be noticed, but that is
an expectation, and the numbers above are the measurement. If a poster ever needs
to be exact -- a parity reference, say -- it should come from the harness still,
not from here.

--check reports what the current posters cost without writing anything, so a
regression (someone dropping a raw screenshot in) is visible.
"""
import sys
import pathlib
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
COURSES = ROOT / 'apps/golf/public/courses'
WIDTH = 800          # 2x the ~400 px card; the card is never shown larger
QUALITY = 90         # the knee of the curve above

check = '--check' in sys.argv
total_before = total_after = 0
rows = []

for d in sorted(p for p in COURSES.iterdir() if p.is_dir()):
    png, webp = d / 'hero-1.png', d / 'hero-1.webp'
    src = png if png.exists() else webp
    if not src.exists():
        rows.append((d.name, 'MISSING', '', '', ''))
        continue
    im = Image.open(src)
    before = src.stat().st_size
    total_before += before
    if check:
        rows.append((d.name, src.name, f'{im.width}x{im.height}', f'{before/1024:.0f} KB', ''))
        total_after += before
        continue
    im = im.convert('RGB')
    h = round(im.height * WIDTH / im.width)
    im.resize((WIDTH, h), Image.LANCZOS).save(webp, 'WEBP', quality=QUALITY, method=6)
    after = webp.stat().st_size
    total_after += after
    if png.exists():
        png.unlink()                              # the raw still lives in the harness, not here
    rows.append((d.name, 'hero-1.webp', f'{WIDTH}x{h}', f'{before/1024:.0f} KB',
                 f'-> {after/1024:.0f} KB  ({before/after:.0f}x)'))

w = max(len(r[0]) for r in rows)
for r in rows:
    print(f'  {r[0]:<{w}}  {r[1]:<12} {r[2]:>9}  {r[3]:>9}  {r[4]}')
if check:
    print(f'\n  {len(rows)} posters, {total_after/1024:.0f} KB on the front door')
else:
    print(f'\n  {total_before/1024/1024:.2f} MB -> {total_after/1024:.0f} KB '
          f'({total_before/max(total_after,1):.0f}x smaller)')
