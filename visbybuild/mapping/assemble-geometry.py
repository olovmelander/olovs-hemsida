"""Join independently reviewed source identities and observed polygons.

Authoring keeps projected source coordinates; schematic guides establish hole
identity only. Numerical card distances never enter this spatial join.
"""
from pathlib import Path
from hashlib import sha256
import json
import subprocess
from PIL import Image,ImageDraw,ImageFont
from shapely.geometry import shape,Polygon,LineString,Point
from shapely.validation import explain_validity

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'visbybuild/mapping'
read=lambda p:json.loads((ROOT/p).read_text('utf8'))
write=lambda p,v:(ROOT/p).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n','utf8')
project=lambda p:[686900.25+0.5*p[0],6372149.75-0.5*p[1]]
routes=read('visbybuild/mapping/route-reference.json')
stage=read('visbybuild/mapping/surface-stage.geojson')
osm=read('geo_data/course-v2/visby/reference/osm-golf-epsg3006.geojson')
card=read('visbybuild/reference/club-scorecard.json')
source_by_id={f['id']:f for f in osm['features']}
features=stage['features']
holes=[]
def pixel_feature(id,kind,pixels,hole,note):
    ring=[project(p) for p in pixels]
    if ring[0]!=ring[-1]:ring.append(ring[0])
    f={'type':'Feature','id':id,'properties':{'kind':kind,'hole':hole,'sourceId':'visby-municipal-ortho-2022','observedYear':2022,'captureDate':None,'notSurveyed':True,'method':'manual-image-boundary-digitization','interpretationUncertaintyMetres':2,'registrationAccuracy':'not independently checked','reviewStatus':'machine-visual-review','note':note,'licence':'exact service terms unresolved; local provisional derivative only'},'geometry':{'type':'Polygon','coordinates':[ring]}}
    features.append(f)
    return f
for route in routes['holes']:
    n=route['holeNumber']
    if route.get('greenRingPixels'):
        green=pixel_feature(f'green-{n:02d}-image','green',route['greenRingPixels'],n,route.get('notes'))
    else:
        assert route['greenSourceId'],f'Hole{n}: source green missing'
        original=source_by_id[route['greenSourceId']]
        green={'type':'Feature','id':original['id'],'properties':{'kind':'green','hole':n,'sourceId':'visby-osm-2026-09-07','sourceFeatureId':original['id'],'sourceVersion':original['properties'].get('osmVersion'),'sourceTimestamp':original['properties'].get('osmTimestamp'),'notSurveyed':True,'method':'unchanged-osm-source-ring','reviewStatus':'machine-visual-review','registrationAccuracy':'unknown source positional accuracy','licence':'ODbL-1.0','note':'Hole association corroborated with retained Caddee guide and municipal 2022 imagery.'},'geometry':original['geometry']}
        features.append(green)
    if route.get('teeRingPixels'):
        tee=pixel_feature(f'tee-{n:02d}-observed','tee',route['teeRingPixels'],n,'Representative observed physical platform. Numeric tee identities and daily marker positions are unknown; this ring is not a complete platform inventory.')
        tees={'pads':[{'ring':tee['geometry']['coordinates'][0],'sourceIds':['visby-municipal-ortho-2022']} ]}
    elif route.get('teeRingEpsg3006'):
        tee={'type':'Feature','id':f'tee-{n:02d}-osm','properties':{'kind':'tee','hole':n,'sourceId':'visby-osm-2026-09-07','method':'unchanged-osm-source-ring','notSurveyed':True,'licence':'ODbL-1.0'},'geometry':{'type':'Polygon','coordinates':[route['teeRingEpsg3006']]}}
        features.append(tee)
        tees={'pads':[{'ring':route['teeRingEpsg3006'],'sourceIds':['visby-osm-2026-09-07']} ]}
    else:
        assert n==12,f'Hole{n}: physical tee ring missing without explicit exception'
        tees={'pads':[],'status':'unresolved-physical-platform','cameraReference':project([2285,2830]),'sourceIds':['visby-municipal-ortho-2022'],'note':'Approximate flyover start on observed maintained fairway; physical tee platform unresolved. No inferred platform or numeric marker coordinates.'}
    line=route['routeEpsg3006']
    assert line and len(line)>1,f'Hole{n}: route missing'
    assert LineString(line).length>20
    ring=green['geometry']['coordinates'][0]
    ref=Point(route['greenEpsg3006'])
    assert shape(green['geometry']).covers(ref),f'Hole{n}: reviewed green target outside ring'
    # Keep the reviewed line's source vertices; its endpoint may identify the
    # observed green rather than the virtual display pin.
    holes.append({'n':n,'line':line,'green':{'ring':ring,'reference':[ref.x,ref.y],'sourceIds':[green['properties']['sourceId']]},'tees':tees,'fairway':{'rings':[f['geometry']['coordinates'][0] for f in features if f['properties']['kind']=='fairway' and f['properties']['hole']==n]},'bunkers':[],'sourceIds':['club-banguide','visby-municipal-ortho-2022',green['properties']['sourceId']],'notes':'Preliminär 3D-bana från flygbild 2022, bankarta och laserskanning 2024. Numrerade tees har verifierade kortlängder; utslags- och flaggpunkter är visningsreferenser.'+(' Hål 12: tee är ännu inte lokaliserad; flygturen startar på fairway.' if n==12 else '')})
assert [h['n'] for h in holes]==list(range(1,19))
for f in osm['features']:
    if f['properties']['tags'].get('golf')!='bunker' or f['geometry']['type']!='Polygon':continue
    p=shape(f['geometry'])
    if any(p.intersection(shape(g['geometry'])).area>min(p.area,shape(g['geometry']).area)*0.3 for g in features if g['properties']['kind']=='bunker'):continue
    features.append({'type':'Feature','id':f['id'],'properties':{'kind':'bunker','hole':None,'sourceId':'visby-osm-2026-09-07','sourceFeatureId':f['id'],'sourceVersion':f['properties'].get('osmVersion'),'sourceTimestamp':f['properties'].get('osmTimestamp'),'method':'unchanged-osm-source-ring','reviewStatus':'machine-visual-review','notSurveyed':True,'licence':'ODbL-1.0'},'geometry':f['geometry']})
for f in features:
    p=shape(f['geometry'])
    assert p.is_valid and p.area>1,(f['id'],explain_validity(p))
    f['properties']['areaSquareMetres']=round(p.area,2)
assert len({f['id'] for f in features})==len(features)
assert all(h['fairway']['rings'] for h in holes if card['holes'][h['n']-1]['par']>3)
collection={'type':'FeatureCollection','name':'Visby provisional source-derived playing surfaces','crs':{'type':'name','properties':{'name':'EPSG:3006'}},'axisOrder':['easting','northing'],'status':'provisional-source-derived-not-surveyed','features':features}
write('visbybuild/mapping/playing-surfaces.geojson',collection)
geometry={'schemaVersion':1,'groundId':'visby','courseSlug':'visby','horizontalCrs':'EPSG:3006','axisOrder':['easting','northing'],'status':'provisional-source-derived-not-surveyed','holes':holes,'scenery':{'fairways':[f['geometry']['coordinates'][0] for f in features if f['properties']['kind']=='fairway' and f['properties']['hole'] is None],'bunkers':[f['geometry']['coordinates'][0] for f in features if f['properties']['kind']=='bunker']},'contextPath':'geo_data/course-v2/visby/mapping/osm-context-epsg3006.geojson','waterPath':'geo_data/course-v2/visby/mapping/water-breakgeometry-simple-epsg3006.geojson'}
practice=read('visbybuild/mapping/practice-surfaces.geojson')
geometry['scenery']['range']=[f['geometry']['coordinates'][0] for f in practice['features'] if f['properties']['kind']=='range_field']
write('visbybuild/mapping/geometry.json',geometry)
# Keep later source reviews through a full authoring regeneration.
subprocess.run(['node',str(OUT/'apply-reviewed-facilities.mjs'),'--geometry-only','--write'],cwd=ROOT,check=True)
inputs=['visbybuild/mapping/route-reference.json','visbybuild/mapping/surface-traces-2022.json','visbybuild/mapping/surface-stage.geojson','geo_data/course-v2/visby/reference/osm-golf-epsg3006.geojson','visbybuild/mapping/build-playing-surfaces.py','visbybuild/mapping/assemble-geometry.py']
report={'schemaVersion':1,'groundId':'visby','status':geometry['status'],'inputs':[{'path':p,'sha256':sha256((ROOT/p).read_bytes()).hexdigest()} for p in inputs],'output':{'path':'visbybuild/mapping/playing-surfaces.geojson','sha256':sha256((OUT/'playing-surfaces.geojson').read_bytes()).hexdigest()},'counts':{kind:sum(f['properties']['kind']==kind for f in features) for kind in ['green','tee','fairway','bunker']},'holesWithGreen':list(range(1,19)),'holesWithAssociatedTee':list(range(1,19)),'holesWithFairway':[h['n'] for h in holes if h['fairway']['rings']],'validation':{'finiteClosedValidPolygons':True,'uniqueFeatureIds':True,'oneGreenAndObservedTeePerMainHole':True,'fairwayForEveryPar4AndPar5':True,'cardDistancesUsedToPlaceGeometry':False,'terrainModified':False},'independentHumanReview':False,'independentControlApproved':False,'limitations':['2022 imagery cannot establish current mowing limits or later alterations.','Numeric tee-marker associations, daily pins, fringes, all tee platforms and bunker completeness remain unverified.','Image reuse terms and independent positional controls remain unresolved; this is a local provisional implementation, not an approved production survey.','Two observed fairway corridors on the separate nine are retained as unassigned scenery; the nine has no playable routing.','Sand contours omit ambiguous connected components; bunkers remain unassigned shared-ground scenery rather than inferred hole ownership.']}
report['holesWithAssociatedTee']=[h['n'] for h in holes if h['tees']['pads']]
report['holesWithVirtualFlyoverStart']=[h['n'] for h in holes if not h['tees']['pads']]
report['validation'].pop('oneGreenAndObservedTeePerMainHole',None)
report['validation']['oneGreenPerMainHole']=True
report['validation']['physicalTeeOn17HolesAndExplicitUnresolvedHole12']=report['holesWithVirtualFlyoverStart']==[12]
report['limitations'].append('Hole12 has no asserted physical tee: the initial camera is explicitly on an observed fairway area; its route is an indicative flyover only.')
write('visbybuild/mapping/playing-surfaces-review.json',report)
image=Image.open(ROOT/'visbybuild/cache/geodata-2026-09-07/gotland-2022-0p5m.png').convert('RGB');draw=ImageDraw.Draw(image);font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',28)
for f in features:
    points=[((e-686900.25)*2,(6372149.75-n)*2) for e,n in f['geometry']['coordinates'][0]]
    draw.line(points,fill={'green':'#ff44dd','tee':'#44ffff','fairway':'#ddff55','bunker':'#ffaa66'}[f['properties']['kind']],width=3)
for h in holes:
    points=[((e-686900.25)*2,(6372149.75-n)*2) for e,n in h['line']]
    draw.line(points,fill='white',width=2)
    draw.text(points[-1],str(h['n']),font=font,fill='white',stroke_width=3,stroke_fill='black')
image.save(ROOT/'visbybuild/cache/surface-mapping-2022/complete-overlay.png')
print(json.dumps(report['counts']))
