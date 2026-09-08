"""Project observed source pixels and retain a reproducible facility inventory.

No synthetic objects, path-width buffers, smoothing, or terrain edits. The
courtyard polygon preserves its turf island and hardstanding is clipped only
against supplementary OSM building footprints, recorded as a qualified join.
"""
import hashlib
import json
from collections import Counter
from pathlib import Path
from PIL import Image, ImageDraw
from pyproj import Transformer
from shapely.geometry import Polygon, shape, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
read = lambda p: json.loads(p.read_text(encoding='utf8'))
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
authoring = read(HERE/'facility-traces-2019.json')
if sha(ROOT/authoring['sourceImage']) != authoring['sourceImageSha256'] or sha(ROOT/authoring['worldFile']) != authoring['worldFileSha256']:
    raise ValueError('Facility source image or registration changed; explicit visual re-review required')
world = [float(x) for x in (ROOT/authoring['worldFile']).read_text().split()]
to_grid = Transformer.from_crs(3011, 3006, always_xy=True)
to_image = Transformer.from_crs(3006, 3011, always_xy=True)
osm_path = ROOT/'geo_data/course-v2/lidingo/reference/osm-golf-epsg3006.geojson'
context_path = ROOT/'geo_data/course-v2/lidingo/reference/osm-context-epsg3006.geojson'
osm = {f['id']:f for f in read(osm_path)['features']}
buildings = unary_union([shape(f['geometry']) for f in read(context_path)['features'] if f['properties']['tags'].get('building') and f['geometry']['type']=='Polygon'])
features = []
adjustments = []
for entry in authoring['features']:
    def project(ring):
        points = [to_grid.transform(world[4]+(entry['origin'][0]+x)*world[0], world[5]+(entry['origin'][1]+y)*world[3]) for x,y in ring]
        return points + [points[0]]
    geom = Polygon(project(entry['pixels']), [project(r) for r in entry.get('holes',[])])
    if not geom.is_valid or geom.area < 1:
        raise ValueError(f"Invalid observed polygon {entry['id']}")
    if entry['kind'] in ['parking','paved_path','range_tee_pad']:
        clipped = geom.difference(buildings)
        removed = geom.area-clipped.area
        if removed > 0.001:
            adjustments.append({'id':entry['id'],'removedBuildingOverlapM2':round(removed,3),'method':'difference against retained OSM building footprints; source epochs and horizontal accuracy differ'})
            geom = clipped
    if geom.is_empty or not geom.is_valid or geom.geom_type not in ['Polygon','MultiPolygon']:
        raise ValueError(f"Invalid clipped facility {entry['id']}")
    properties = {k:entry[k] for k in ['kind','parentFacilityId','material','name','note'] if k in entry}
    properties.update(sourceId='imagery-municipal-2019', sourceSha256=sha(ROOT/authoring['sourceImage']), observedYear=2019,
        notSurveyed=True, reviewStatus='machine-visual-review', interpretationUncertaintyMetres=entry['uncertaintyMetres'],
        registrationAccuracy=authoring['registrationAccuracy'], licence='CC0-1.0', method='observed source pixels, worldfile, EPSG:3011 to EPSG:3006 using PROJ; no smoothing')
    features.append({'type':'Feature','id':entry['id'],'properties':properties,'geometry':mapping(geom)})
for entry in authoring['adoptedOsmFeatures']:
    source = osm[entry['sourceFeatureId']]
    features.append({'type':'Feature','id':entry['id'], 'geometry':source['geometry'], 'properties':{
        **entry,'sourceId':'lidingo-osm-2026-09-07','sourceSha256':sha(osm_path),'observedYear':None,'notSurveyed':True,
        'reviewStatus':'machine-visual-review','registrationAccuracy':'not independently checked',
        'method':'unmodified supplementary OSM ring; 2019 visual correspondence; purpose association only'}})
result = {'type':'FeatureCollection','name':'Lidingo provisional facilities','crs':{'type':'name','properties':{'name':'EPSG:3006'}},'features':features}
output = HERE/'facilities.geojson'
output.write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n',encoding='utf8',newline='\n')
review = {'schemaVersion':1,'state':'provisional-source-derived-not-surveyed','features':len(features),
    'kinds':dict(Counter(f['properties']['kind'] for f in features)),
    'inputs': [{'path':str(p.relative_to(ROOT)).replace('\\','/'),'sha256':sha(p)} for p in [HERE/'facility-traces-2019.json',ROOT/authoring['sourceImage'],ROOT/authoring['worldFile'],osm_path,context_path]],
    'output':{'path':str(output.relative_to(ROOT)).replace('\\','/'),'sha256':sha(output)},
    'adjustments':adjustments,'pending':authoring['pending'],
    'inventory':[{'id':f['id'],'kind':f['properties']['kind'],'facility':f['properties']['parentFacilityId'],'areaM2':round(shape(f['geometry']).area,3),'interiorRings':sum(len(p.interiors) for p in (shape(f['geometry']).geoms if f['geometry']['type']=='MultiPolygon' else [shape(f['geometry'])]))} for f in features]}
(HERE/'facilities-review.json').write_text(json.dumps(review,indent=2,ensure_ascii=False)+'\n',encoding='utf8',newline='\n')
image = Image.open(ROOT/authoring['sourceImage']).convert('RGB')
draw = ImageDraw.Draw(image)
for f in features:
    def pixel(p):
        e,n = to_image.transform(*p)
        return ((e-world[4])/world[0], (n-world[5])/world[3])
    geom = shape(f['geometry'])
    for polygon in geom.geoms if geom.geom_type=='MultiPolygon' else [geom]:
        colour = 'cyan' if f['properties']['kind']=='paved_path' else 'magenta' if f['properties']['kind']=='practice_green' else 'yellow'
        for ring in [polygon.exterior,*polygon.interiors]:
            draw.line([pixel(p) for p in ring.coords],fill=colour,width=2)
    center = pixel(geom.representative_point().coords[0])
    draw.text(center,f['id'].replace('lidingo-',''),fill='white',stroke_fill='black',stroke_width=1)
cache = ROOT/'lidingobuild/cache/facility-review'
cache.mkdir(parents=True,exist_ok=True)
image.crop((960,1140,1440,2240)).save(cache/'facilities-overlay.png')
print(json.dumps({'features':len(features),'kinds':review['kinds'],'buildingClips':len(adjustments)}))
