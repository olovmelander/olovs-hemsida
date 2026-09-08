"""Compare H16 stand representatives with retained imagery and surface outlines."""
import json
from hashlib import sha256
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image
from shapely.geometry import Point, shape

ROOT = Path(__file__).resolve().parents[4]
read = lambda p: json.loads((ROOT / p).read_text('utf8'))
BASELINE = 'visbybuild/cache/vegetation/review/hole16-tree-baseline.json'
REPORT = 'geo_data/course-v2/visby/vegetation/hole16-tree-review.json'
if not (ROOT/BASELINE).exists():
    previous = read(REPORT)
    assert previous['state'] == 'source-candidates-awaiting-runtime-instance-match'
    (ROOT/BASELINE).write_bytes((ROOT/REPORT).read_bytes())
baseline = read(BASELINE)
matched = min(baseline['candidates'],key=lambda c:abs(c['sourcePixel'][0]-2042.58)+abs(c['sourcePixel'][1]-2520.88))
assert abs(matched['sourcePixel'][0]-2042.58)<.02 and abs(matched['sourcePixel'][1]-2520.88)<.02
meta = read('geo_data/course-v2/visby/reference/gotland-ortho-2022.json')
source = ROOT / meta['image']['path']
assert sha256(source.read_bytes()).hexdigest() == meta['image']['sha256']
evidence = read('geo_data/course-v2/visby/vegetation/canopy-evidence.json')
config = evidence['config']
chm_source = evidence['campaigns'][0]['files']['chm']
assert sha256((ROOT/chm_source['data']).read_bytes()).hexdigest() == chm_source['sha256']
chm = np.fromfile(ROOT/chm_source['data'], dtype='<f4').reshape(config['height'],config['width'])
surface_path = 'visbybuild/mapping/playing-surfaces.geojson'
surfaces = read(surface_path)
near = [f for f in surfaces['features'] if f['properties'].get('hole') == 16]
project = lambda p: [686900.25+.5*p[0],6372149.75-.5*p[1]]
pixels = lambda e,n: [(e-686900.25)*2,(6372149.75-n)*2]
candidates = []
for e,n,base,h in read('visbybuild/cache/vegetation/review/stand-representatives.json'):
    x,y = pixels(e,n)
    if not (1940<x<2060 and 2480<y<2660):
        continue
    col = int((e-config['originEasting'])/2)
    row = int((config['originNorthing']-n)/2)
    local = chm[max(0,row-1):row+2,max(0,col-1):col+2]
    p = Point(e,n)
    candidates.append(dict(easting=e,northing=n,sourcePixel=[x,y],heightMetres=h,
                           nearestH16SurfaceMetres=min(shape(f['geometry']).distance(p) for f in near),
                           sourceChm3x3MaximumMetres=float(np.nanmax(local))))
candidates.sort(key=lambda p:p['sourcePixel'][1])
image = np.asarray(Image.open(source).convert('RGB'))
figure, axes = plt.subplots(1,2,figsize=(9,12),layout='constrained')
for ax in axes:
    ax.imshow(image,origin='upper')
    ax.set_xlim(1920,2090)
    ax.set_ylim(2730,2460)
    ax.set_aspect('equal')
    ax.grid(color='yellow',alpha=.3)
    ax.tick_params(labelsize=8)
axes[0].set_title('H16 approach: 2022 source')
axes[1].set_title('2024 stand representatives + retained outlines')
for f in near:
    coords=f['geometry']['coordinates']
    rings=coords if f['geometry']['type']=='Polygon' else [r for poly in coords for r in poly]
    for ring in rings:
        xy=np.asarray([pixels(p[0],p[1]) for p in ring])
        axes[1].plot(xy[:,0],xy[:,1],color='cyan',linewidth=1)
for i,c in enumerate(candidates,1):
    x,y=c['sourcePixel']
    c['label']=i
    axes[1].scatter(x,y,color='red',s=20)
    axes[1].annotate(f"{i}: {c['heightMetres']:.1f} m",(x,y),xytext=(3,3),textcoords='offset points',fontsize=7,color='white',bbox=dict(facecolor='black',alpha=.5,pad=1))
axes[1].scatter(*matched['sourcePixel'],marker='x',color='magenta',s=50)
axes[1].annotate('matched former stand representative',matched['sourcePixel'],xytext=(-100,-12),textcoords='offset points',fontsize=7,color='white',bbox=dict(facecolor='black',alpha=.6,pad=1))
figure.suptitle('Stand points are display representatives of measured area cells, not surveyed stems')
out = ROOT/'visbybuild/cache/vegetation/review/hole16-vegetation-source.png'
figure.savefig(out,dpi=150)
plt.close(figure)
distance = lambda a,b: ((a['easting']-b['easting'])**2+(a['northing']-b['northing'])**2)**.5
retained = [c for c in baseline['candidates'] if c != matched]
assert all(any(distance(a,b)<1e-6 for b in candidates) for a in retained), 'An observed approach-gap candidate was removed'
assert not any(distance(matched,c)<1e-6 for c in candidates), 'The matched representative still occupies the omitted mown field'
assert any(f['properties']['kind']=='fairway' and shape(f['geometry']).covers(Point(matched['easting'],matched['northing'])) for f in near)
report=dict(schemaVersion=1,groundId='visby',hole=16,state='source-boundary-corrected-exclusions-checked',
            sourceImage=meta['image'],canopySource=chm_source,
            baselineSource=dict(path=BASELINE,sha256=sha256((ROOT/BASELINE).read_bytes()).hexdigest()),
            matchedRuntimeInstance=dict(**matched, runtimeLocalX=173.04,runtimeLocalZ=62.19,
                                        runtimeScreenBasePixels=[687.8,855.5],runtimeViewportPixels=[1440,900],
                                        runtimeSpeciesIndex=1,
                                        matchEvidence='visby_sources headless WebGPU treeReview16; exact projected coordinate and source pixel match'),
            decision='Corrected only fairway16 eastern outline near source y2475..2563 to follow the visible maintained-field edge. The matched stand point lies within the corrected source-derived playing footprint. Laser measurements remain unchanged; their presence does not establish a physical stem on the mown ground.',
            targetedChecks=dict(matchedRepresentativeAbsent=True,observedGapCandidatesRetained=len(retained),observedGapCandidatesBefore=len(retained)),
            priorSurfaceSource=baseline['surfaceSource'],
            surfaceSource=dict(path=surface_path,sha256=sha256((ROOT/surface_path).read_bytes()).hexdigest()),
            previewPath=out.relative_to(ROOT).as_posix(),candidates=candidates,
            limitations=['The other source-supported tree crowns near the H16 approach gap remain; no gap-wide or route-wide vegetation clearing was applied.',
                         'Mowing boundaries are interpreted from 2022 imagery with unverified registration accuracy; 2024 canopy can overhang that playing footprint without locating a trunk there.',
                         'A stand representative does not locate a measured stem, and display species is not a surveyed species observation.'])
(ROOT/REPORT).write_text(json.dumps(report,indent=2)+'\n','utf8')
print(json.dumps(dict(previewPath=report['previewPath'],candidates=candidates)))
