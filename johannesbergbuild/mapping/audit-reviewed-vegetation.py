"""Intersect published crown centres and stand cells with accepted turf reviews.

Run audit-published-vegetation.mjs first. This reads public chunks and immutable
review evidence; it never relocates/removes measured crowns or changes stands.
"""
import hashlib
import json
import math
from pathlib import Path
from pyproj import Transformer
from shapely.geometry import Polygon, Point, box
from shapely.strtree import STRtree

ROOT=Path(__file__).resolve().parents[2]
CACHE=ROOT/'johannesbergbuild/cache/lm-estate-review'
v=json.loads((CACHE/'published-vegetation.json').read_text(encoding='utf-8'))
tf=Transformer.from_crs(4326,3006,always_xy=True)
mlon=111320*math.cos(math.radians(59.72733))
def projected(p):
    return tf.transform(18.19202+p[0]/mlon,59.72733-p[1]/111320)
treepoints=[Point(t['easting'],t['northing']) for t in v['trees']]
tindex=STRtree(treepoints)
standboxes=[box(*s['bounds']) for s in v['stands']]
sindex=STRtree(standboxes)
results=[]
inputs=[]
for path in sorted((ROOT/'johannesbergbuild/mapping').glob('lm-review-*.json')):
    if 'estate' in path.name:
        continue
    review=json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(review.get('features'),list):
        continue
    inputs.append(dict(path=path.relative_to(ROOT).as_posix(),sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    for f in review['features']:
        if f.get('status')!='accepted' or f.get('action')=='remove' or f['kind'] not in ['green','tees','tee','fairway']:
            continue
        rings=f['rings'] if f['kind'] in ['tees','fairway'] else [f['ring']]
        for j,ring in enumerate(rings):
            polygon=Polygon(list(map(projected,ring)))
            trees=[v['trees'][int(i)] for i in tindex.query(polygon) if polygon.contains(treepoints[int(i)])]
            stands=[]
            for i in sindex.query(polygon):
                i=int(i)
                intersection=polygon.intersection(standboxes[i]).area
                if intersection>1e-5:
                    stands.append(dict(**v['stands'][i],intersectionM2=round(intersection,4),cellFraction=round(intersection/16,4)))
            if trees or stands:
                results.append(dict(reviewFile=path.name,course=review['course'],featureId=f['id'],kind=f['kind'],hole=f['hole'],ringIndex=j,trees=trees,stands=stands))

clear_ids={'l0/4/5/16/43','l0/4/5/15/42','l0/2/0/0/37','l0/1/0/63/37'}
retained_ids={'l0/3/3/20/5','l0/1/1/0/35','l0/3/0/1/51'}
observations=[]
for record in results:
    for stand in record['stands']:
        if stand['id'] not in clear_ids|retained_ids:
            continue
        window=('nine' if record['course']=='johannesberg-9' else 'eighteen')+f'-{record["hole"]:02d}-hole'
        source=ROOT/f'johannesbergbuild/cache/lm-ortho/{window}.png'
        observations.append(dict(standId=stand['id'],featureId=record['featureId'],boundsEpsg3006=stand['bounds'],
            status='clear-turf-exclusion-candidate' if stand['id'] in clear_ids else 'retained-visible-canopy-or-overhang',
            sourceFiles=[dict(path=source.relative_to(ROOT).as_posix(),sha256=hashlib.sha256(source.read_bytes()).hexdigest())],
            sourceCaptureDates=['2025-06-14'],
            note=('The cell is visually clear turf in the dated source. Excluding representative stand planting here is supported; no measured crown is relocated or deleted.' if stand['id'] in clear_ids else
                  'The dated source shows a real tree crown/shadow or canopy at the turf boundary. Surface intersection alone is not evidence for removing this canopy.')))

out=dict(schemaVersion=1,groundId='johannesberg',kind='published-vegetation-vs-reviewed-surfaces',state='conflicts-reviewed-with-exclusion-candidates',
    groundManifest=v['groundManifest'],reviewInputs=inputs,individualTreeTotal=len(v['trees']),
    nonexcludedCanopyStandCellTotal=len(v['stands']),
    individualTreeCentresInsideReviewedTurf=sum(len(r['trees']) for r in results),
    standCellSurfaceIntersections=sum(len(r['stands']) for r in results),
    standCellsMostlyInsideTurf=sum(s['cellFraction']>.75 for r in results for s in r['stands']),
    intersections=results,visualObservations=observations,
    limitations=['A canopy crown or 4m stand cell intersecting a surface does not on its own justify removal.',
                 'This audit reads currently published chunks; final renderer scatter can differ within a stand cell.',
                 'Zero tree-centre conflicts is not a claim that all crown edges avoid turf.',
                 'Only the explicitly listed clear-turf cells are exclusion candidates; this report does not apply them.'])
path=ROOT/'geo_data/course-v2/johannesberg/reference/lm-vegetation-surface-audit-2026-09-09.json'
path.write_text(json.dumps(out,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:out[k] for k in ['individualTreeTotal','individualTreeCentresInsideReviewedTurf','standCellSurfaceIntersections','standCellsMostlyInsideTurf']}))
