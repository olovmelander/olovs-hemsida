"""Prepare reproducible, georeferenced Blender facility reference panels.

Source pixels are retained from the verified 2024 LM window. These are roof
envelopes and visible surface traces, not a wall survey. No imagery is generated.
Run with geobuild/cache/ortho-venv/Scripts/python.exe.
"""
import hashlib
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from pyproj import Transformer
from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'nvgkbuild/cache/lm-ortho'
OUT = ROOT / 'nvgkbuild/cache/facilities-reference/ortho'
OUT.mkdir(parents=True, exist_ok=True)
record = json.loads((SOURCE / 'facilities-range.json').read_text(encoding='utf-8'))
review = json.loads((ROOT / 'nvgkbuild/mapping/review-environment-2026-09-09.json').read_text(encoding='utf-8'))
model = json.loads((ROOT / 'nvgkbuild/course-model.json').read_text(encoding='utf-8'))
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
assert sha(SOURCE / record['rasterFile']) == record['sha256']
assert sha(SOURCE / record['rgbFile']) == record['rgbSha256']
im = Image.open(SOURCE / record['rgbFile']).convert('RGB')
assert im.size == (record['width'], record['height'])
t = record['geoTransform']
project = Transformer.from_crs(3006, 4326, always_xy=True)
unproject = Transformer.from_crs(4326, 3006, always_xy=True)

def en(pixel):
    return [round(t[0] + pixel[0]*t[1], 6), round(t[3] + pixel[1]*t[5], 6)]

def pixel(point):
    return [(point[0]-t[0])/t[1], (point[1]-t[3])/t[5]]

def local(point):
    lon, lat = project.transform(*point)
    return [round((lon-model['origin']['lon'])*model['mPerLon'], 4),
            round((model['origin']['lat']-lat)*model['mPerLat'], 4)]

def bearing(a, b):
    return round(math.degrees(math.atan2(b[0]-a[0], b[1]-a[1])) % 180, 2)

def enrich(feature):
    ring = feature['ringEpsg3006']
    shape = Polygon(ring)
    assert shape.is_valid and shape.area > 0
    points = list(shape.minimum_rotated_rectangle.exterior.coords)[:-1]
    sides = [math.dist(points[i], points[(i+1)%4]) for i in range(4)]
    axis = max(range(4), key=lambda i: sides[i])
    feature.update(centreEpsg3006=[round(shape.centroid.x,4),round(shape.centroid.y,4)],
                   ringLocalXZ=[local(p) for p in ring],
                   centreLocalXZ=local([shape.centroid.x,shape.centroid.y]),
                   areaSquareMetres=round(shape.area,2),
                   minimumRectangleMetres=[round(max(sides),2),round(min(sides),2)],
                   longAxisGridBearingDegrees=bearing(points[axis],points[(axis+1)%4]))
    if feature.get('ridgePixels'):
        ridge = [en(p) for p in feature['ridgePixels']]
        feature.update(ridgeEpsg3006=ridge, ridgeLocalXZ=[local(p) for p in ridge],
                       ridgeGridBearingDegrees=bearing(*ridge))
    return feature

features = []
def traced(identifier, label, pixels, *, ridge=None, kind='roof-envelope', notes='', confidence='visible-outline'):
    f = dict(id=identifier,label=label,kind=kind,sourceId='facilities-range',
             sourcePixels=pixels,ringEpsg3006=[en(p) for p in pixels],
             review='native-pixel-review-2026-09-10',confidence=confidence,
             heightsMeasuredByOrthophoto=False,notes=notes)
    if ridge: f['ridgePixels']=ridge
    features.append(enrich(f))

traced('clubhouse-main-roof-native', 'Clubhouse main roof',
       [[324,276],[386,236],[438,318],[373,356]],ridge=[[355,257],[408,337]],
       notes='Two roof planes, red roof and two dark solar arrays on the southwest-facing plane. Native envelope refines the earlier half-size trace; roof lean and eaves must not be used to shift the OSM wall footprint. Ridge endpoints are approximate visible-plan interpretation.')
traced('clubhouse-cross-roof-native', 'Clubhouse cross roof',
       [[382,258],[420,237],[452,288],[415,311]],ridge=[[399,286],[436,263]],
       notes='Gable projecting northeast/east from the main roof; overlapping roof edges at the intersection are partly hidden. Perpendicular ridge interpretation must be checked against oblique photographs.')
traced('clubhouse-north-annex-roof', 'Detached building north of clubhouse',
       [[303,202],[365,164],[390,207],[328,245]],
       notes='Detached roof, absent from the previous model. Red western portion and dark eastern portion/projection are visible. Roof-plane division, building use, wall line and dark eastern projection require oblique-photo/LiDAR confirmation; do not invent a full symmetric roof from this envelope.',
       confidence='roof-envelope-visible-roof-form-uncertain')
traced('clubhouse-main-solar-north-native', 'Northern clubhouse solar array',
       [[330,274],[354,260],[369,282],[344,298]],kind='roof-solar',
       notes='Dark panel group visibly resolved; perimeter is a manual approximation, not a panel count or electrical specification.')
traced('clubhouse-main-solar-south-native', 'Southern clubhouse solar array',
       [[346,309],[374,292],[406,338],[377,354]],kind='roof-solar',
       notes='Dark panel group visibly resolved; perimeter is a manual approximation, not a panel count or electrical specification.')

# Reuse the retained source traces for the wider campus. Explicitly preserve
# their review date and source affine; native-panel additions above do not
# silently overwrite the old audit or the runtime course model.
for old in review['features']:
    if old['sourceId'] != 'facilities-range' or not old.get('ringEpsg3006'):
        continue
    features.append(enrich(dict(id=old['id'],label=old['id'],kind=old['kind'],sourceId=old['sourceId'],
        sourcePixels=[pixel(p) for p in old['ringEpsg3006']],ringEpsg3006=old['ringEpsg3006'],
        review='retained-half-size-review-2026-09-09',confidence='visible-outline',
        heightsMeasuredByOrthophoto=False,
        notes='Retained source trace. Any height in the old review was a display estimate. '+
        ('Superseded as a roof/solar plan reference by the corresponding native review above; retained for comparison.'
         if old['kind'] in ['clubhouse_roof_section','roof_solar'] else ''))))

club = next(b for b in model['infra']['buildings'] if b['id']=='w1205924894')
wall_en = [unproject.transform(model['origin']['lon']+p[0]/model['mPerLon'],
                             model['origin']['lat']-p[1]/model['mPerLat']) for p in club['ring']]
features.append(enrich(dict(id=club['id'],label='Existing OSM clubhouse wall footprint',kind='wall-footprint',
    sourceId='legacy-osm',ringEpsg3006=[[round(v,6) for v in p] for p in wall_en],
    sourcePixels=[pixel(p) for p in wall_en],review='existing-model-reference',confidence='inherited-osm-not-surveyed',
    heightsMeasuredByOrthophoto=False,notes='Retain separately from visible roof outlines. Existing OSM footprint is not an independently surveyed wall line.')))

panels=[]
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',15)
panel_specs=[
 ('campus-overview',[0,0,im.width,im.height],1),
 ('clubhouse-campus',[100,100,550,440],2),
 ('clubhouse-detail',[290,215,470,385],4),
 ('north-annex-detail',[275,140,410,265],4),
 ('practice-shed-detail',[680,550,800,670],4),
 ('range-shelter-detail',[550,890,720,1040],4),
 ('range-pads',[585,750,735,1025],3),
 ('padel-court',[120,175,225,340],4),
 ('parking-and-range-entrance',[220,460,760,1050],2),
]
for name,bounds,scale in panel_specs:
    left,top,right,bottom=bounds
    panel=im.crop(bounds)
    if scale!=1: panel=panel.resize((panel.width*scale,panel.height*scale),Image.Resampling.NEAREST)
    path=OUT/(name+'.png');panel.save(path)
    affine=[t[0]+left*t[1],t[1]/scale,0,t[3]+top*t[5],0,t[5]/scale]
    metadata=dict(id=name,path=path.relative_to(ROOT).as_posix(),sourceWindow='facilities-range',
        sourceRgbSha256=record['rgbSha256'],sha256=sha(path),sourceCropPixelEdges=bounds,
        displayWidth=panel.width,displayHeight=panel.height,displayScale=scale,
        resampling='nearest; enlargement creates no new source resolution',
        horizontalCrs='EPSG:3006',geoTransform=affine,sourceResolutionMetres=.16)
    corners=[[affine[0],affine[3]],
             [affine[0]+panel.width*affine[1],affine[3]],
             [affine[0]+panel.width*affine[1],affine[3]+panel.height*affine[5]],
             [affine[0],affine[3]+panel.height*affine[5]]]
    metadata.update(cornerOrder=['top-left','top-right','bottom-right','bottom-left'],
                    cornersEpsg3006=corners,cornersLocalXZ=[local(p) for p in corners],
                    cornersBlenderXY=[[p[0],-p[1]] for p in map(local,corners)],
                    widthMetres=(right-left)*.16,heightMetres=(bottom-top)*.16)
    path.with_suffix('.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf-8')
    path.with_suffix('.pgw').write_text('\n'.join(str(v) for v in [affine[1],0,0,affine[5],affine[0]+affine[1]/2,affine[3]+affine[5]/2])+'\n')
    panels.append(metadata)
    # Labelled copy is a review aid only; clean panel/worldfile remain separate.
    overlay=panel.copy();draw=ImageDraw.Draw(overlay)
    for f in features:
        if f['review']=='retained-half-size-review-2026-09-09' and f['kind'] in ['clubhouse_roof_section','roof_solar']:continue
        points=f['sourcePixels']
        if not all(left<=p[0]<=right and top<=p[1]<=bottom for p in points):continue
        pts=[((p[0]-left)*scale,(p[1]-top)*scale) for p in points]
        colour='#00ffff' if f['kind']=='wall-footprint' else '#fff05c'
        draw.line(pts+[pts[0]],fill=colour,width=2)
        if f.get('ridgePixels'):
            draw.line([((p[0]-left)*scale,(p[1]-top)*scale) for p in f['ridgePixels']],fill='#ff654b',width=3)
        if f['kind'] in ['roof-envelope','building','sports_court']:
            a=min(pts,key=lambda p:p[1]);draw.text(a,f['id'],font=font,fill=colour,stroke_width=2,stroke_fill='black')
    overlay.save(OUT/(name+'-annotated.png'))

# This extra bounded source is kept separate because ownership and function are
# not established. It is useful context, not a claim that nearby homes or
# construction belong to the golf club.
extra_cache=ROOT/'nvgkbuild/cache/facilities-reference/ortho-extra'
extra_file=extra_cache/'southern-maintenance-context.json'
additional_sources=[]
if extra_file.exists():
    extra=json.loads(extra_file.read_text(encoding='utf-8'))
    raster=extra_cache/extra['rasterFile'];rgb=extra_cache/extra['rgbFile']
    assert sha(raster)==extra['sha256'] and sha(rgb)==extra['rgbSha256']
    affine=extra['geoTransform'];width=extra['width'];height=extra['height']
    corners=[[affine[0],affine[3]],[affine[0]+width*affine[1],affine[3]],
             [affine[0]+width*affine[1],affine[3]+height*affine[5]],
             [affine[0],affine[3]+height*affine[5]]]
    source_metadata=dict(window=extra,rasterPath=raster.relative_to(ROOT).as_posix(),
        rgbPath=rgb.relative_to(ROOT).as_posix(),role='surrounding-context-use-and-ownership-unconfirmed',
        notes='Pale rectangular construction/roof surfaces among detached residential-looking buildings. The initial acquisition filename is a search label, not an identified maintenance building.')
    # The retained flight seam polygons identify the contributing capture; do
    # not reuse the parent tile's representative timestamp as exact evidence.
    from shapely.geometry import shape,box
    from shapely.ops import unary_union
    seams=json.loads((SOURCE/'o69875_6775_25_mr24-flygbild.json').read_text(encoding='utf-8'))
    area=box(*extra['boundsEpsg3006']);parts=[];images=[]
    for f in seams['features']:
        inter=area.intersection(shape(f['geometry']))
        if inter.area<=0:continue
        parts.append(inter);images.append(dict(imageId=f['properties']['bildidentitet'],capturedAt=f['properties']['tidpunkt'],
            windowFraction=round(inter.area/area.area,8)))
    assert unary_union(parts).area/area.area>.99999
    source_metadata['captureEvidence']=dict(coverageFraction=round(unary_union(parts).area/area.area,8),contributingImages=images)
    additional_sources.append(source_metadata)
    panels.append(dict(id='southern-construction-context',path=rgb.relative_to(ROOT).as_posix(),
        sourceWindow=extra['id'],sourceRgbSha256=extra['rgbSha256'],sha256=extra['rgbSha256'],
        sourceCropPixelEdges=[0,0,width,height],displayWidth=width,displayHeight=height,
        displayScale=1,resampling='native nearest',horizontalCrs='EPSG:3006',geoTransform=affine,
        sourceResolutionMetres=.16,cornerOrder=['top-left','top-right','bottom-right','bottom-left'],
        cornersEpsg3006=corners,cornersLocalXZ=[local(p) for p in corners],
        cornersBlenderXY=[[p[0],-p[1]] for p in map(local,corners)],
        widthMetres=width*.16,heightMetres=height*.16,
        role='context-only; no confirmed golf-facility identity'))

capture=json.loads((ROOT/'geo_data/course-v2/norrfallsviken/reference/lm-ortho-capture-2026-09-09.json').read_text(encoding='utf-8'))
evidence=next(w for w in capture['windows'] if w['id']=='facilities-range')
inventory=dict(schemaVersion=1,groundId='norrfallsviken',kind='facility-modelling-orthophoto-reference',
    reviewedOn='2026-09-10',source=dict(window=record,rasterPath=(SOURCE/record['rasterFile']).relative_to(ROOT).as_posix(),
    rgbPath=(SOURCE/record['rgbFile']).relative_to(ROOT).as_posix(),captureEvidence=evidence,
    attribution='Ortofoto Nedladdning © Lantmäteriet, bearbetad information, CC BY 4.0'),
    coordinateFrame=dict(horizontalCrs='EPSG:3006',origin=model['origin'],mPerLon=model['mPerLon'],mPerLat=model['mPerLat'],
       localXZ='After EPSG:3006 -> EPSG:4326: x=(lon-origin.lon)*mPerLon; z=(origin.lat-lat)*mPerLat. East +x; north -z.',
       blender='For local Three.js x,y,z use Blender x,-z,y. Reference-plane horizontal coordinates are x,-z. Heights are not included in this orthophoto evidence.',
       pixelEdges='E=geoTransform[0]+column*geoTransform[1]; N=geoTransform[3]+row*geoTransform[5]. Add 0.5 for pixel centres.',
       gridBearing='Undirected EPSG:3006 grid bearing, clockwise from grid north, modulo 180. Do not substitute directly for a true-north runtime yaw.'),
    limitations=['Native ground sample distance is 0.16 m; visual envelope tracing is approximately 0.4–0.8 m, not a survey accuracy statement.',
       'Roofs may lean relative to ground/walls in an orthophoto. No wall footprint is corrected from roof pixels.',
       'Orthophoto cannot measure eave/ridge heights or identify windows/doors and hidden facades.',
       'The image captures June 2024; future planned buildings are separate from the as-photographed facility inventory.',
       'Building names other than the mapped clubhouse are provisional until confirmed from club sources.'],
    additionalSources=additional_sources,panels=panels,features=features)
target=ROOT/'nvgkbuild/mapping/facilities-ortho-reference.json'
target.write_text(json.dumps(inventory,indent=2,ensure_ascii=False)+'\n',encoding='utf-8',newline='\n')
print(json.dumps(dict(target=target.relative_to(ROOT).as_posix(),panels=len(panels),features=len(features),
    buildings=[{k:f[k] for k in ['id','centreLocalXZ','minimumRectangleMetres','longAxisGridBearingDegrees']} for f in features if f['kind'] in ['roof-envelope','building']]),indent=2))
