"""Pin the architectural profiles and resolve compound wall intersections."""
import hashlib
import json
import math
from pathlib import Path
from shapely.geometry import Polygon

ROOT=Path(__file__).resolve().parents[2]
HERE=ROOT/'johannesbergbuild/facilities'


def main():
    paths=['clubhouse-model-profile.json','estate-model-profiles.json','model-ground.json','site-inventory.json']
    docs={name:json.loads((HERE/name).read_text(encoding='utf-8')) for name in paths}
    estate=docs['estate-model-profiles.json']
    ground={f['id']:f for f in docs['model-ground.json']['facilities']}
    for f in estate['profiles']:
        original=Polygon(f['footprint']['ringEPSG3006'])
        assert original.is_valid
        if f['modelBuildingIndex'] in (127,128):
            f['roofMaskEPSG3006']=list(original.buffer(.4,join_style=2).exterior.coords)[:-1]
        f['groundContext']=ground[f['facilityId']]
        for c in f['roof']['components']:
            a=math.radians(c['axisDegGridNorth']);u=(math.sin(a),math.cos(a));v=(-math.cos(a),math.sin(a))
            e,n=c['centerEPSG3006'];L,W=c['lengthM'],c['widthM']
            box=Polygon([(e+u[0]*x+v[0]*y,n+u[1]*x+v[1]*y) for x,y in [(-L/2,-W/2),(L/2,-W/2),(L/2,W/2),(-L/2,W/2)]])
            clipped=original.intersection(box)
            pieces=[clipped] if clipped.geom_type=='Polygon' else [p for p in clipped.geoms if p.geom_type=='Polygon']
            c['wallRingsEPSG3006']=[list(p.exterior.coords)[:-1] for p in pieces if p.area>.2]
            assert c['wallRingsEPSG3006'],f['facilityId']+' '+c['id']
    sources=[]
    for name in paths:
        p=HERE/name;sources.append({'path':p.relative_to(ROOT).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
    for p in [ROOT/docs['model-ground.json']['gridPath'],HERE/'model_geometry.py',HERE/'roof_clip.py']:
        sources.append({'path':p.relative_to(ROOT).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
    spec={'schemaVersion':1,'date':'2026-09-10','sources':sources,'clubhouse':docs['clubhouse-model-profile.json'],
          'estate':estate,'ground':docs['model-ground.json'],'inventory':docs['site-inventory.json'],
          'status':'Exterior appearance reconstruction; uncertain dimensions recorded in source profiles'}
    (HERE/'architecture-spec.json').write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'profiles':len(estate['profiles'])+1,'pinnedSources':len(sources),'wallComponents':sum(len(f['roof']['components']) for f in estate['profiles'])}))


if __name__=='__main__':
    main()
