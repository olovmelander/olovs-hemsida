"""Prepare metre-scale display-model parameters without modifying course geography."""
import hashlib
import json
import math
from pathlib import Path
import numpy as np
from pyproj import Transformer
from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / 'upsalabuild/facilities/reference-2026-09-10'
OUT = ROOT / 'upsalabuild/facilities/models-2026-09-10'
OUT.mkdir(exist_ok=True)
model = json.loads((ROOT / 'upsalabuild/course-model.json').read_text(encoding='utf-8'))
inventory = json.loads((REF / 'building-reference-inventory.json').read_text(encoding='utf-8'))
laser = json.loads((REF / 'lidar-roof-evidence.json').read_text(encoding='utf-8'))
by_id = {b['id']: b for b in inventory['buildings']}
source_buildings = {b['id']: b for b in model['infra']['buildings']}
grid = np.memmap(ROOT / 'upsalabuild/cache/terrain-block.f32', dtype='<f4', mode='r', shape=(4785, 3641))
project = Transformer.from_crs(4326, 3006, always_xy=True)

def ground(x,z):
    e,n = project.transform(model['origin']['lon']+x/model['mPerLon'],model['origin']['lat']-z/model['mPerLat'])
    col,row = e-638255.5,6637977.5-n
    ix,iy = math.floor(col),math.floor(row);fx,fy=col-ix,row-iy
    assert 0 <= ix < 3640 and 0 <= iy < 4784
    return float((1-fx)*(1-fy)*grid[iy,ix]+fx*(1-fy)*grid[iy,ix+1]+(1-fx)*fy*grid[iy+1,ix]+fx*fy*grid[iy+1,ix+1])

def feature(b):
    ring=b['localRing']
    if ring[0]==ring[-1]:ring=ring[:-1]
    poly=Polygon([(x,-z) for x,z in ring]);rect=list(poly.minimum_rotated_rectangle.exterior.coords)[:-1]
    edges=[math.dist(rect[i],rect[(i+1)%4]) for i in range(4)]
    i=max(range(4),key=edges.__getitem__);a,c=rect[i],rect[(i+1)%4]
    length=edges[i]; ux,uy=(c[0]-a[0])/length,(c[1]-a[1])/length
    if ux<0:ux,uy=-ux,-uy
    centre=[sum(p[j] for p in rect)/4 for j in range(2)]
    samples=[]
    for i,p in enumerate(ring):
        q=ring[(i+1)%len(ring)];steps=max(1,math.ceil(math.dist(p,q)))
        samples += [ground(p[0]+(q[0]-p[0])*s/steps,p[1]+(q[1]-p[1])*s/steps) for s in range(steps)]
    summary=next((s for s in laser['newMunicipalReferenceFootprints'] if s['id']==b['id']),None)
    return {'id':b['id'],'name':b['name'],'ring':ring,'ringXY':[[x,-z] for x,z in ring],
            'centreXY':centre,'axisXY':[ux,uy],'length':length,'width':min(edges),
            'groundMinRH2000':min(samples),'groundMaxRH2000':max(samples),'baseRH2000':round(max(samples)+.08,3),
            'laser':summary,'heightStatus':'display estimate unless a reviewed plane is explicitly attached',
            'planStatus':b['geometryInterpretation'],'sourceId':b['municipalObjectId']}

groups=[
 ('clubhouse',['B01','B02'],['w221193965','w438967932']),
 ('north-small',['B03'],['uppsala-building-92448']),
 ('parking-barn',['B04'],['w221193959']),
 ('red-house',['B05'],['w438967931']),
 ('practice-building',['B06','B07'],['w221193957']),
 ('range-shelter',['B08','B09'],['w221193969']),
 ('service-long',['B10'],['w221193968']),
 ('service-light',['B11'],['w221193971']),
 ('service-red',['B12','B13'],['w221193963']),
 ('east-building',['B14','B15'],['w438967927']),
 ('north-barn',['B16'],['uppsala-building-592773']),
 ('north-outbuildings',['B17','B18','B19'],['uppsala-building-1390787']),
]
assets=[]
for name,ids,replaced in groups:
    assets.append({'id':'upsala-'+name,'renderOnBuildingId':replaced[0],
                   'replaces':[{'id':i,'ring':source_buildings[i]['ring']} for i in replaced],
                   'featureIds':ids,'features':[feature(by_id[i]) for i in ids]})
report={'schemaVersion':1,'groundId':'upsala','frame':{**inventory['frame'],'verticalDatum':'RH2000'},
        'anchorLocalXZ':inventory['anchorLocalXZ'],'anchorHeightRH2000':34.968,
        'assets':assets,'sourceModelSha256':hashlib.sha256((ROOT/'upsalabuild/course-model.json').read_bytes()).hexdigest(),
        'planInterpretation':'Authored display models use reference geometry; source building records and terrain remain unchanged.',
        'excludedCurrentReplacement':'The 2026 Halfway House has no verified georeferenced as-built footprint. Its separate design model is not placed in the app.'}
(OUT/'model-plan.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'assets':len(assets),'sourceParts':sum(len(a['features']) for a in assets),'replacedBuildings':sum(len(a['replaces']) for a in assets)}))
