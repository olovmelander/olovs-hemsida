"""Make reference-only contact sheets without modifying source images."""
import json, math
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw, ImageFont

ROOT = Path('angsobuild/cache/facilities-2026-09-10/photos')
manifest = json.loads((ROOT / 'photo-candidates.json').read_text(encoding='utf-8'))
photos=[]
for item in manifest['images']:
    if item.get('error'): continue
    try:
        with Image.open(item['local']) as im:
            item['width'],item['height']=im.size
            item['exif']={str(k):str(v) for k,v in im.getexif().items() if k in (271,272,306,315,33432,36867,36868)}
        photos.append(item)
    except Exception as error:
        item['decodeError']=str(error)
try: font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',17)
except OSError: font=ImageFont.load_default()
for start in range(0,len(photos),12):
    items=photos[start:start+12]
    canvas=Image.new('RGB',(1680,math.ceil(len(items)/3)*380),(236,238,233))
    draw=ImageDraw.Draw(canvas)
    for i,item in enumerate(items):
        x=(i%3)*560;y=(i//3)*380
        with Image.open(item['local']) as source:
            im=ImageOps.contain(ImageOps.exif_transpose(source).convert('RGB'),(544,318))
        canvas.paste(im,(x+8+(544-im.width)//2,y+8+(318-im.height)//2))
        name=Path(item['local']).name
        draw.text((x+8,y+332),f'{start+i+1:02d}  {name[:58]}',fill=(18,29,24),font=font)
        draw.text((x+8,y+354),f'{item["width"]} x {item["height"]} | {", ".join(item["pages"])}',fill=(48,60,50),font=font)
    canvas.save(ROOT/f'contact-sheet-{start//12+1:02d}.jpg',quality=93)
(ROOT/'photo-candidates.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'photoCount':len(photos),'sheetCount':math.ceil(len(photos)/12),'images':[(i+1,Path(x['local']).name,x.get('exif')) for i,x in enumerate(photos)]},ensure_ascii=False))
