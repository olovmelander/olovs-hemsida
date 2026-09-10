"""Render contact sheets from the checked-in curated photo manifest."""
import json, math
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw, ImageFont

manifest=json.loads(Path('angsobuild/facilities/photo-sources.json').read_text(encoding='utf-8'))
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',17)
for start in range(0,len(manifest['photos']),9):
    items=manifest['photos'][start:start+9]
    canvas=Image.new('RGB',(1680,math.ceil(len(items)/3)*400),(236,238,233))
    draw=ImageDraw.Draw(canvas)
    for i,item in enumerate(items):
        x=(i%3)*560;y=(i//3)*400
        with Image.open(item['local']) as source:
            if list(source.size)!=item['dimensions']:
                raise ValueError(f"Dimension mismatch {item['id']}: {source.size} != {item['dimensions']}")
            im=ImageOps.contain(ImageOps.exif_transpose(source).convert('RGB'),(544,325))
        canvas.paste(im,(x+8+(544-im.width)//2,y+8+(325-im.height)//2))
        draw.text((x+8,y+342),item['id'],fill=(18,29,24),font=font)
        draw.text((x+8,y+366),item['kind']+' | capture date unknown' if not item.get('documentDate') else item['kind']+' | '+item['documentDate'],fill=(70,80,75),font=font)
    output=manifest['contactSheets'][start//9]
    canvas.save(output,quality=93)
    print(output)
