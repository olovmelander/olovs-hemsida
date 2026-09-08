#!/usr/bin/env python3
"""Reproduce before/after source overlays from the pinned 2025 ortho cache."""
import json
import sys
from hashlib import sha256
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT = Path(__file__).resolve().parents[2]
review = json.loads((ROOT/'lidingobuild/mapping/putting-cuts-2025.json').read_text(encoding='utf8'))
source = ROOT/review['sourceCapture']['path']
assert sha256(source.read_bytes()).hexdigest() == review['sourceCapture']['sha256']
Image.MAX_IMAGE_PIXELS = None
image = Image.open(source).convert('RGB')
out = ROOT/'lidingobuild/cache/alignment-review'
out.mkdir(parents=True,exist_ok=True)
sheet = Image.new('RGB',(1600,7*450),'#17221e')
for index, feature in enumerate(review['features']):
    crop = feature['sourceCrop']; w = crop['worldfile']
    base = image.crop((crop['left'],crop['top'],crop['left']+crop['width'],crop['top']+crop['width']))
    for col,key in enumerate(['beforeGeometry','geometry']):
        panel = base.copy(); draw = ImageDraw.Draw(panel)
        xy = [((e-w[4])/w[0]-crop['left'],(n-w[5])/w[3]-crop['top']) for e,n in feature[key]['coordinates'][0]]
        draw.line(xy,fill='#ff966a' if col==0 else '#63fff1',width=2)
        draw.text((10,10),f"Hole {feature['hole']} - {'before' if col==0 else 'reviewed 2025'}",fill='white',stroke_width=2,stroke_fill='black')
        panel.save(out/f"putting-{feature['hole']:02d}-{'before' if col==0 else 'after'}.png")
        sheet.paste(panel,((index%2)*800+col*400,(index//2)*450))
sheet.save(out/'putting-before-after.png')
print(out/'putting-before-after.png')
approaches = json.loads((ROOT/'lidingobuild/mapping/approaches-2025.geojson').read_text(encoding='utf8'))
approach_sheet = Image.new('RGB',(1350,1160),'#17221e')
for index, feature in enumerate(approaches['features']):
    p = feature['properties']; crop = p['sourceCrop']; w = crop['worldfile']
    base = image.crop((crop['left'],crop['top'],crop['left']+crop['width'],crop['top']+crop['height']))
    panel = base.resize((crop['displayWidth'],crop['displayHeight']),Image.Resampling.LANCZOS)
    draw = ImageDraw.Draw(panel)
    xy = [((e-w[4])/w[0]-crop['left'],(n-w[5])/w[3]-crop['top']) for e,n in feature['geometry']['coordinates'][0]]
    xy = [(x*panel.width/crop['width'],y*panel.height/crop['height']) for x,y in xy]
    draw.line(xy,fill='#ffb744',width=2)
    draw.text((8,8),f"Hole {p['hole']} - mown approach",fill='white',stroke_width=2,stroke_fill='black')
    approach_sheet.paste(panel,((index%3)*450+10,(index//3)*560+10))
approach_sheet.save(out/'approaches-2025.png')
if '--publish' in sys.argv:
    credit = 'Datakalla Lantmateriets Min karta; (c) Lantmateriet; bearbetad; CC BY 4.0. Capture 2025-05-31; review provisional.'
    for name, canvas in [('putting-cut-review-2025',sheet),('approach-cut-review-2025',approach_sheet)]:
        ImageDraw.Draw(canvas).text((10,canvas.height-25),credit,fill='white')
        canvas.save(ROOT/f'lidingobuild/mapping/{name}.jpg',quality=87,optimize=True)
