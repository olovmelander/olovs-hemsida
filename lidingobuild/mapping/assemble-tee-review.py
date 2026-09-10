"""Merge independent image observations and check source pixels before adoption."""
from pathlib import Path
from hashlib import sha256
import json
from PIL import Image, ImageDraw
from shapely.geometry import Polygon, Point

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'lidingobuild/mapping'
CACHE = ROOT/'lidingobuild/cache/tee-alignment-2025'
CACHE.mkdir(exist_ok=True)

def read(p):
    return json.loads(p.read_text(encoding='utf8'))

baseline_path = CACHE/'baseline-model.json'
surface_path = CACHE/'baseline-surfaces.json'
if not baseline_path.exists():
    baseline_path.write_bytes((ROOT/'lidingobuild/course-model.json').read_bytes())
if not surface_path.exists():
    surface_path.write_bytes((OUT/'playing-surfaces.geojson').read_bytes())
baseline, surfaces = read(baseline_path), read(surface_path)['features']
files = ['tee-review-front12-2026-09-09.json','tee-review-hole08-2026-09-09.json','tee-review-back6-2026-09-09.json']
if (OUT/'tee-review-forward-2026-09-09.json').exists():
    files.append('tee-review-forward-2026-09-09.json')
by_hole = {}
for filename in files:
    for hole in read(OUT/filename)['holes']:
        by_hole[hole['hole']] = hole
assert sorted(by_hole) == list(range(1,19))
for number, h in sorted(by_hole.items()):
    source = h['image']
    image_path = ROOT/source['path']
    assert sha256(image_path.read_bytes()).hexdigest() == source['sha256']
    image = Image.open(image_path).convert('RGB')
    assert image.size == (source['width'],source['height'])
    g = source['geoTransform']
    h['baselineMarks'] = baseline['holes'][number-1]['tees']['marks']
    if 'guide' not in h:
        guide = next((ROOT/'lidingobuild/reference/cache/club-2026-09-07').glob(f'*Lidingo_{number}.webp'))
        h['guide'] = dict(path=guide.relative_to(ROOT).as_posix(),sha256=sha256(guide.read_bytes()).hexdigest(),url='https://banguider.se/lidingo-golfklubb/18-halsbanan')
    draw = ImageDraw.Draw(image)
    polygons = {}
    for pad in h['pads']:
        if pad.get('retainedSourceFeatureId'):
            pad['status'] = 'retained-unresolved'
            pad['baselineFeature'] = next(f for f in surfaces if f['id']==pad['retainedSourceFeatureId'])
            pad['pixels'] = [[(e-g[0])/g[1],(n-g[3])/g[5]] for e,n in pad['baselineFeature']['geometry']['coordinates'][0]]
        ring = pad['pixels']
        if ring[0] != ring[-1]: ring.append(ring[0][:])
        assert all(0 <= x <= source['width'] and 0 <= y <= source['height'] for x,y in ring)
        p = Polygon(ring)
        assert p.is_valid and p.area*.16**2 > 1, (number,pad['id'])
        polygons[pad['id']] = p
        if pad.get('status') == 'retained-unresolved':
            old = pad['baselineFeature']['geometry']['coordinates'][0]
            projected = [(g[0]+x*g[1],g[3]+y*g[5]) for x,y in ring]
            assert Polygon(old).hausdorff_distance(Polygon(projected)) < .00001, (number,pad['id'],Polygon(old).hausdorff_distance(Polygon(projected)))
        draw.line([tuple(p) for p in ring],fill='#00ffff' if pad.get('status') != 'retained-unresolved' else '#ffa500',width=3)
        c=p.centroid
        draw.text((c.x,c.y),pad['id'].split('-')[-2] if '-' in pad['id'] else pad['id'],fill='white',stroke_width=2,stroke_fill='black')
    for m in h['marks']:
        if m['status'] == 'unresolved': continue
        assert polygons[m['padId']].contains(Point(m['pixel'])), (number,m)
        x,y = m['pixel']
        draw.ellipse((x-6,y-6,x+6,y+6),fill=m['colour'],outline='black',width=2)
    image.thumbnail((1200,1200))
    image.save(CACHE/f'adopted-{number:02d}.jpg',quality=92)
review = dict(schemaVersion=1,id='lidingo-tee-alignment-2026-09-09',groundId='lidingo',horizontalCrs='EPSG:3006',
              capturedAt='2025-05-31',reviewedOn='2026-09-09',
              method='Manual native orthophoto pixel interpretation and club guide platform associations; no scorecard distance fit.',
              sourceReviews=[dict(path='lidingobuild/mapping/'+p,sha256=sha256((OUT/p).read_bytes()).hexdigest()) for p in files],
              holes=[by_hole[n] for n in range(1,19)],
              limitations=['Individual daily tee marker locations are unverified; accepted marker pairs are bounded display placements.',
                           'Canopy-obscured historical outlines retain their original source identity.',
                           'Image interpretation uncertainty is separate from unmeasured registration error.',
                           'The published guide omits several orange starts; unresolved colours are not rendered.'])
(OUT/'tee-placement-image-review-2026-09-09.json').write_text(json.dumps(review,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps(dict(holes=18,pads=sum(len(h['pads']) for h in by_hole.values()),
                      accepted=sum(m['status']!='unresolved' for h in by_hole.values() for m in h['marks']),
                      unresolved=[(h['hole'],m['colour']) for h in by_hole.values() for m in h['marks'] if m['status']=='unresolved'])))
