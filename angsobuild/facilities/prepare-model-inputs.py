"""Prepare source-pinned terrain and exact coordinate metadata for authored facilities."""
import hashlib
import json
from pathlib import Path
import numpy as np
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
origin = [605530., 6605140.]
height_origin = 8.
ortho = json.loads((HERE / 'orthophoto-reference.json').read_text(encoding='utf-8'))
height = json.loads((HERE / 'height-reference.json').read_text(encoding='utf-8'))
terrain_path = ROOT / 'geo_data/course-v2/angso/acquisition/terrain-window.json'
terrain = json.loads(terrain_path.read_text(encoding='utf-8'))
raw = (ROOT / terrain['raster']['path']).read_bytes()
assert hashlib.sha256(raw).hexdigest() == terrain['raster']['sha256']
assert height['inventorySha256'] == hashlib.sha256((HERE / 'orthophoto-reference.json').read_bytes()).hexdigest()
grid = np.frombuffer(raw, '<f4').reshape(terrain['lattice']['height'], terrain['lattice']['width'])
lattice = terrain['lattice']


def ground(e, n):
    x = (e-lattice['originEasting'])/lattice['sampleSpacingMetres']
    y = (lattice['originNorthing']-n)/lattice['sampleSpacingMetres']
    c, r = int(x), int(y)
    assert 0 <= c < grid.shape[1]-1 and 0 <= r < grid.shape[0]-1
    u, v = x-c, y-r
    return float((grid[r,c]*(1-u)+grid[r,c+1]*u)*(1-v)+(grid[r+1,c]*(1-u)+grid[r+1,c+1]*u)*v)


inverse = Transformer.from_crs(3006, 4326, always_xy=True)


def legacy(e, n):
    lon, lat = inverse.transform(e, n)
    return [round((lon-16.871)*56375.41, 6), round((59.5739-lat)*111320, 6)]


replacements = {'B01':'w516709523','B03':'w516709525','B04':'w516709524',
                'B09':'w516709522','B11':'w516709521','B13':'w517780252'}
model = json.loads((ROOT / 'angsobuild/course-model.json').read_text(encoding='utf-8'))
features = []
yard_pixels = [(650,435),(756,428),(813,472),(799,548),(742,608),
               (667,655),(510,694),(504,654),(579,587),(626,540)]
yard_local = [[round(10+x*.16, 6), round(1070.08-y*.16, 6)] for x,y in yard_pixels]
yard = {'id':'S07', 'kind':'hardstanding', 'label':'Northern service-context eastern yard',
        'ringBlenderXY':yard_local,
        'ringEPSG3006':[[x+origin[0],y+origin[1]] for x,y in yard_local],
        'notes':'Hardstanding traced from northern-service-native.png at 0.16m per pixel; '
                'separate ground surface from B13, with use and ownership unconfirmed.'}
for feature in [*ortho['outlines'], yard]:
    ring = feature['ringEPSG3006']
    center = np.mean(ring[:-1] if ring[0] == ring[-1] else ring, axis=0)
    roof = feature['kind'] in ('roof-edge', 'canopy-edge')
    item = {**feature, 'nodeName':feature['id'], 'sourceBuildingIds':[replacements[feature['id']]] if feature['id'] in replacements else [],
            'groundAnchorLocal':legacy(*center), 'groundAnchorRh2000M':round(ground(*center), 6),
            'footprintLocal':[legacy(*p) for p in ring], 'placement':'absolute-rh2000',
            'kind':'canopy' if feature['kind']=='canopy-edge' else 'building' if roof else 'site',
            'vegetationExclusion':roof}
    if feature['id'] in ('S01','S02'):
        name = 'trace-parking-main' if feature['id']=='S01' else 'trace-parking-south'
        index, source = next((i,p) for i,p in enumerate(model['infra']['parking']) if p['id']==name)
        item.update(sourceParkingIndices=[index],sourceParkingRingsLocal=[{'index':index,'ring':source['ring']}])
    features.append(item)
record = {'schemaVersion':1,'originEPSG3006':origin,'originHeightRH2000':height_origin,
          'raster':terrain['raster'],'lattice':lattice,'features':features,
          'sourceInputs':[{'path':str(p.relative_to(ROOT)).replace('\\','/'),
                           'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
                          for p in (terrain_path,HERE/'orthophoto-reference.json',HERE/'height-reference.json',HERE/'photo-sources.json',Path(__file__))],
          'notes':'Original 1m RH2000 ground; architectural openings and wall offsets remain model interpretations.'}
(HERE/'model-inputs.json').write_text(json.dumps(record,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print(json.dumps({'features':len(features),'groundRasterVerified':True,'replacements':replacements}))
