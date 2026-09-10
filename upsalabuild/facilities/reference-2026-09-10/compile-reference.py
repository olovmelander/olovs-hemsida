"""Compile measured and uncertain facility reference geometry, without runtime edits."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pyproj import Transformer
import rasterio
from rasterio.enums import ColorInterp
from shapely.geometry import Polygon, Point, box, shape, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[3]
REF = Path(__file__).parent
CACHE = ROOT/'upsalabuild/cache/facilities-2026-09-10'
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def rel(p): return p.relative_to(ROOT).as_posix()
def write(p,v): p.write_text(json.dumps(v,indent=2,ensure_ascii=True)+'\n',encoding='utf-8')
model_path = ROOT/'upsalabuild/course-model.json'
model = read(model_path)
frame = {k:model[k] for k in ['origin','mPerLat','mPerLon']}
to_grid = Transformer.from_crs(4326,3006,always_xy=True)
to_lonlat = Transformer.from_crs(3006,4326,always_xy=True)
def grid(p): return list(to_grid.transform(frame['origin']['lon']+p[0]/frame['mPerLon'],frame['origin']['lat']-p[1]/frame['mPerLat']))
def local(p):
    lon,lat=to_lonlat.transform(*p[:2])
    return [(lon-frame['origin']['lon'])*frame['mPerLon'],(frame['origin']['lat']-lat)*frame['mPerLat']]
club = next(b for b in model['infra']['buildings'] if b['id']=='w221193965')
anchor_shape = Polygon(club['ring']).centroid
anchor = [anchor_shape.x,anchor_shape.y]
anchor_grid = grid(anchor)
def blender(p): return [p[0]-anchor[0],anchor[1]-p[1],0]

plan = read(REF/'orthophoto-plan.json')
acquisition = read(REF/'orthophoto-acquisition.json')
assert acquisition['state']=='acquired-for-review' and acquisition['access']['authorized']
assert acquisition['planSha256']==sha(CACHE/'plan.json')==sha(REF/'orthophoto-plan.json')
source_footprints=[];metadata=[]
for s in plan['sources']:
    path=ROOT/f'upsalabuild/cache/lm-ortho/{s["id"]}-flygbild.json';doc=read(path)
    assert doc['crs']['properties']['name']=='urn:ogc:def:crs:EPSG::3006'
    metadata.append(dict(path=rel(path),sha256=sha(path)))
    source_footprints += [(s['id'],f['properties']['bildidentitet'],f['properties']['tidpunkt'],shape(f['geometry'])) for f in doc['features']]
images=[];capture=[]
for record in acquisition['windows']:
    native=CACHE/record['rasterFile'];plain=CACHE/record['rgbFile'];gt=record['geoTransform']
    assert sha(native)==record['sha256'] and sha(plain)==record['rgbSha256']
    with rasterio.open(native) as dataset:
        assert dataset.crs.to_epsg()==3006 and dataset.count==4
        assert dataset.colorinterp==(ColorInterp.red,ColorInterp.green,ColorInterp.blue,ColorInterp.undefined)
        assert np.all(dataset.dataset_mask()==255)
        assert np.array_equal(dataset.read([1,2,3]).transpose(1,2,0),np.array(Image.open(plain)))
        assert np.allclose(dataset.transform.to_gdal(),gt,atol=1e-9,rtol=0)
        assert dataset.width==record['width'] and dataset.height==record['height']
    parts=[];contributing=[];extent=box(*record['boundsEpsg3006'])
    window=next(w for w in plan['windows'] if w['id']==record['id'])
    for sid,iid,date,geom in source_footprints:
        if sid not in window['sourceIds']:continue
        intersection=extent.intersection(geom)
        if intersection.area<=1e-8:continue
        parts.append(intersection);contributing.append(dict(sourceId=sid,imageId=iid,capturedAt=date,windowFraction=intersection.area/extent.area))
    coverage=unary_union(parts).area/extent.area;assert coverage>.99999
    dates=sorted({i['capturedAt'][:10] for i in contributing})
    capture.append(dict(id=record['id'],coverageFraction=coverage,captureDates=dates,contributingImages=contributing))
    corners=[]
    for xy in [[0,0],[record['width'],0],[record['width'],record['height']],[0,record['height']]]:
        en=[gt[0]+xy[0]*gt[1]+xy[1]*gt[2],gt[3]+xy[0]*gt[4]+xy[1]*gt[5]];xz=local(en)
        corners.append(dict(pixel=xy,epsg3006=en,localXZ=xz,blenderXYZ=blender(xz)))
    images.append(dict(id=record['id'],path=rel(plain),sha256=record['rgbSha256'],tifPath=rel(native),tifSha256=record['sha256'],worldFile=rel(plain.with_suffix('.pgw')),
        width=record['width'],height=record['height'],geoTransform=gt,boundsEpsg3006=record['boundsEpsg3006'],resolutionMetres=record['resolutionMetres'],
        nativeResolutionMetres=.16,resampling=record['resampling'],captureDates=dates,pixelToLocalCorners=corners,
        pixelCoordinateConvention='Coordinates refer to pixel edges; pixel centres add 0.5 to column and row.',
        exactMapping='Pixel -> affine EPSG:3006 -> pyproj EPSG:4326 -> declared local XZ. Corner mesh is a display approximation; use exact per-point mapping for measurements.'))
write(REF/'orthophoto-capture.json',dict(schemaVersion=1,sourceMetadata=metadata,windows=capture))

municipal_dir=CACHE/'municipal'
municipal=read(municipal_dir/'municipal_buildings_aoi_xyz.json')
metadata_doc=read(municipal_dir/'municipal_buildings_metadata.json')
assert municipal['spatialReference']['wkid']==3006 and municipal.get('hasZ') is True
domains={f['name']:{c['code']:c['name'] for c in (f.get('domain') or {}).get('codedValues',[])} for f in metadata_doc['fields']}
source_records={f['attributes']['OBJECTID']:f for f in municipal['features']}
# Stable B numbers identify source parts, not asserted room uses or independent buildings.
inventory_order=[
 (1215269,'Clubhouse main complex','Clubhouse', 'Clubhouse identity is supported by the existing named OSM object; restaurant, shop and room-to-wing assignments require photographs.'),
 (1244320,'Clubhouse west attached component','Clubhouse west extension','Visible attached roof/component; enclosure and terrace limits require oblique photographs.'),
 (92448,'Small structure north of clubhouse','Unknown','Small multi-sided roof; function unverified.'),
 (1248912,'Red-roof building north of clubhouse','Unknown','Separate building beside north parking; current function requires photo match.'),
 (92444,'Small red-roof building southeast of clubhouse','Unknown','Separate small structure between clubhouse and parking.'),
 (1212887,'Dark-roof building south of clubhouse','Training or practice building candidate','Function is a candidate until club photograph match.'),
 (1365585,'South building component','Unknown','Municipal part near B06; do not double-extrude overlapping source parts.'),
 (1226083,'Driving-range roof shelter','Driving-range shelter','Native imagery clearly shows roof with tee mats along its south side; wall/column layout remains unknown.'),
 (1390788,'Small structure on eastern range tee line','Unknown','Tiny range-side kiosk or equipment shelter candidate; no room-use assertion.'),
 (92436,'Long building in southeast service yard','Service-yard building candidate','Measured outline; shed/barn use needs photograph or club identification.'),
 (92435,'White-roof building at southeast yard','Service-yard building candidate','Measured outline; exact function unverified.'),
 (92440,'Red-roof building at north edge of southeast yard','Service-yard building candidate','Measured outline; exact function unverified.'),
 (1222358,'Northern attached part at southeast yard','Unknown','Separate municipal part adjoining B12; roof geometry may overlap main part.'),
 (1246066,'Small eastern woodland-edge building','Unknown','Source has total-station method but status is no information.'),
 (1520169,'Small measured part beside eastern building','Unknown','Newer municipal source component; source Z=0 and status alone cannot establish height.'),
 (592773,'Large dark-roof building north of parking','Unknown','Measured network-RTK outline; source Z=-999 is no-data.'),
 (1390787,'Northern outbuilding part','Unknown','Measured network-RTK outline; source Z=0 is unverified.'),
 (1232325,'Northern outbuilding overlapping source part','Unknown','Status and method unknown; overlapping alternatives must not become duplicate solids.'),
 (1390786,'Tiny structure near north outbuildings','Unknown','Network-RTK method with unknown current status; source Z=0.')]
assert {x[0] for x in inventory_order}==set(source_records)
buildings=[];geo=[];measured_geo=[]
maximum_roundtrip=0
for number,(ident,name,function,note) in enumerate(inventory_order,1):
    raw=source_records[ident];attrs=raw['attributes'];source_rings=raw['geometry']['rings']
    assert len(source_rings)==1,'Multipart source must be preserved explicitly, not silently truncated'
    ring_xy=[p[:2] for p in source_rings[0]];poly=Polygon(ring_xy);assert poly.is_valid
    local_ring=[local(p) for p in ring_xy[:-1]]
    for a,b in zip(ring_xy,local_ring+[local_ring[0]]):maximum_roundtrip=max(maximum_roundtrip,math.dist(a,grid(b)))
    measured=attrs['STATUS']==3 and attrs['ORIGINPLAN'] in [100,101,102,103,104,107,108,109,110,111,113]
    zvalues=[p[2] for p in source_rings[0] if len(p)>2]
    matches=[]
    for b in model['infra']['buildings']:
        other=Polygon([grid(p) for p in b['ring']]);intersection=other.intersection(poly).area
        if intersection>1:
            matches.append(dict(id=b['id'],intersectionSquareMetres=intersection,sourceOutlineCoveredFraction=intersection/poly.area,
                                sourceId=b.get('sourceId'),heightMetres=b.get('h')))
    corners=list(poly.minimum_rotated_rectangle.exterior.coords)
    edge_lengths=[math.dist(corners[i],corners[i+1]) for i in range(4)]
    rec=dict(id=f'B{number:02d}',municipalObjectId=ident,name=name,function=function,functionEvidenceNote=note,
      sourceId='uppsala-municipal-buildings-2026-09-10',statusCode=attrs['STATUS'],status=domains['STATUS'].get(attrs['STATUS']),
      planMethodCode=attrs['ORIGINPLAN'],planMethod=domains['ORIGINPLAN'].get(attrs['ORIGINPLAN'],'No information'),
      confirmedExistingMeasuredOutline=measured,geometryInterpretation='Municipal 2D building outline; wall-at-ground versus roof-edge reference is not declared by the exposed service.',
      groundFootprintVerified=False,roofOutlineVerified=False,sourceAbsoluteHorizontalAccuracyMetres=None,
      sourceRingsEPSG3006=ring_xy,sourceRingsXYZ=source_rings,localRing=local_ring,blenderRing=[blender(p) for p in local_ring],
      centroidEPSG3006=[poly.centroid.x,poly.centroid.y],centroidLocalXZ=local([poly.centroid.x,poly.centroid.y]),
      areaSquareMetres=poly.area,orientedBoundingRectangleMetres=sorted([edge_lengths[0],edge_lengths[1]],reverse=True),
      sourceGeometryModifiedAt=datetime.fromtimestamp(attrs['MODIFICATIONDATE']/1000,timezone.utc).isoformat(),surveyDate=None,
      heightMetres=None,heightStatus='Unknown: no verified eave, ridge, wall or floor elevations supplied.',
      sourceVertexElevation=dict(values=zvalues,minimum=min(zvalues) if zvalues else None,maximum=max(zvalues) if zvalues else None,
          sourceVerticalCrs=None,meaning='Unverified source Z; 0 and -999 appear as sentinel values. Neither wall height nor ground/floor height can be inferred.',heightMethodCode=attrs['ORIGINHEIGHT']),
      existingModelMatches=sorted(matches,key=lambda x:-x['intersectionSquareMetres']),rawSourceAttributes=attrs)
    buildings.append(rec)
    ll=[list(to_lonlat.transform(*p)) for p in ring_xy]
    gj=dict(type='Feature',id=rec['id'],geometry=dict(type='Polygon',coordinates=[ll]),properties={k:rec[k] for k in ['id','municipalObjectId','name','function','status','planMethod','confirmedExistingMeasuredOutline','geometryInterpretation','groundFootprintVerified','roofOutlineVerified','sourceAbsoluteHorizontalAccuracyMetres','heightMetres','areaSquareMetres']})
    geo.append(gj)
    if measured:measured_geo.append(gj)
assert maximum_roundtrip<1e-6
for b in buildings:
    p=Polygon(b['sourceRingsEPSG3006'])
    b['overlappingSourceParts']=[dict(id=o['id'],intersectionSquareMetres=p.intersection(Polygon(o['sourceRingsEPSG3006'])).area) for o in buildings if o['id']!=b['id'] and p.intersection(Polygon(o['sourceRingsEPSG3006'])).area>.25]
write(REF/'building-footprints-reference.geojson',dict(type='FeatureCollection',name='Upsala facilities: source building outlines with uncertainty retained',features=geo))
write(REF/'measured-footprints.geojson',dict(type='FeatureCollection',name='Confirmed existing municipal geodetic outlines; ground/roof convention and height unknown',features=measured_geo))
write(REF/'measured-footprints-local.json',dict(schemaVersion=1,frame=frame,anchorLocalXZ=anchor,buildings=[b for b in buildings if b['confirmedExistingMeasuredOutline']]))
write(REF/'building-reference-inventory.json',dict(schemaVersion=1,frame=frame,anchorLocalXZ=anchor,buildings=buildings))

context=[];aoi=box(639590,6636120,640120,6636540)
parking_number=0
for category in ['buildings','parking']:
    for item in model['infra'][category]:
        polygon=Polygon([grid(p) for p in item['ring']])
        if not aoi.intersects(polygon):continue
        if category=='parking':parking_number+=1
        context.append(dict(category=category,id=item['id'],reviewLabel=f'P{parking_number:02d}' if category=='parking' else None,source='Current generated model; source provenance retained verbatim below',
            currentModelFeature=item,localRing=item['ring'],epsg3006Ring=[grid(p) for p in item['ring']],blenderRing=[blender(p) for p in item['ring']],
            heightMetres=item.get('h'),geometryInterpretation='Existing model boundary retained for comparison, not newly validated ground or roof geometry.'))
facility_path=ROOT/'upsalabuild/mapping/facilities.json';facilities=read(facility_path)
for item in facilities['features']:
    context.append(dict(category='practice-facility',id=item['id'],source=rel(facility_path),sourceSha256=sha(facility_path),
        currentModelFeature=item,localRing=item['ring'],localHoles=item.get('holes',[]),epsg3006Ring=[grid(p) for p in item['ring']],blenderRing=[blender(p) for p in item['ring']],
        geometryInterpretation='Previously reviewed surface outline; not a building wall or roof.'))
write(REF/'context-geometry-local.json',dict(schemaVersion=1,frame=frame,anchorLocalXZ=anchor,features=context))

font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',26)
small=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',18)
panels=[]
for source in images:
    im=Image.open(ROOT/source['path']).convert('RGB');draw=ImageDraw.Draw(im);gt=source['geoTransform'];extent=box(*source['boundsEpsg3006'])
    def pix(p):return [(p[0]-gt[0])/gt[1],(p[1]-gt[3])/gt[5]]
    for b in buildings:
        poly=Polygon(b['sourceRingsEPSG3006'])
        if not extent.intersects(poly):continue
        color='#00ffff' if b['confirmedExistingMeasuredOutline'] else '#ffd745'
        points=[pix(p) for p in b['sourceRingsEPSG3006']];draw.line(points,fill=color,width=3)
        x,y=pix([poly.centroid.x,poly.centroid.y])
        dx,dy={'B14':(40,25),'B15':(-68,-5),'B17':(35,-35),'B18':(35,18),'B19':(30,8)}.get(b['id'],(8,-18))
        label_font=small if source['resolutionMetres']>.16 else font
        lx,ly=x+dx,max(72,y+dy)
        if b['id'] in ['B14','B15','B17','B18','B19']:draw.line([(x,y),(lx+8,ly+10)],fill=color,width=2)
        draw.text((lx,ly),b['id'],font=label_font,fill=color,stroke_width=3,stroke_fill='black')
    for i,item in enumerate([x for x in context if x['category']=='parking'],1):
        points=[pix(p) for p in item['epsg3006Ring']]
        draw.line(points+[points[0]],fill='#ff82e5',width=2)
        centre=Polygon(item['epsg3006Ring']).centroid;x,y=pix([centre.x,centre.y]);draw.text((x,y),f'P{i:02d}',font=small,fill='#ff82e5',stroke_width=2,stroke_fill='black')
    draw.rectangle([0,0,im.width,66],fill='black')
    draw.text((8,5),f'Upsala facilities | {source["resolutionMetres"]:.2f} m pixels | captures {", ".join(source["captureDates"])}',font=small,fill='white')
    draw.text((8,34),'Cyan: confirmed measured outline | Yellow: uncertain source outline | Pink: existing parking',font=small,fill='white')
    out=CACHE/(source['id']+'-numbered.png');im.save(out)
    panels.append(dict(id=source['id']+'-numbered',path=rel(out),sha256=sha(out),sourceImageId=source['id'],pixelSize=[im.width,im.height],geoTransform=gt,
                       use='Review panel only: labels/header obscure source pixels. Use the separate plain PNG or TIFF for modelling.'))
    if source['id']=='facilities-campus-native':
        for ident,bounds in [('clubhouse',[639785,6636320,639910,6636460]),('service-yard',[639905,6636270,640015,6636370]),('north-buildings',[639895,6636460,639985,6636540])]:
            left=math.floor((bounds[0]-gt[0])/gt[1]);top=math.floor((bounds[3]-gt[3])/gt[5]);right=math.ceil((bounds[2]-gt[0])/gt[1]);bottom=math.ceil((bounds[1]-gt[3])/gt[5])
            crop=im.crop((left,top,right,bottom));path=CACHE/f'{ident}-numbered-native.png';crop.save(path)
            panels.append(dict(id=ident,path=rel(path),sha256=sha(path),sourceImageId=source['id'],pixelSize=[crop.width,crop.height],sourcePixelCrop=[left,top,right,bottom],
                               geoTransform=[gt[0]+left*gt[1],gt[1],0,gt[3]+top*gt[5],0,gt[5]],use='Numbered crop at unchanged native resolution'))

source_files=[model_path,ROOT/'upsalabuild/mapping/municipal-buildings.json',facility_path,municipal_dir/'municipal_buildings_aoi_xyz.json',municipal_dir/'municipal_buildings_metadata.json']
manifest=dict(schemaVersion=1,id='upsala-facilities-reference-2026-09-10',createdAt=datetime.now(timezone.utc).isoformat(),frame=frame,
  horizontalCrs='EPSG:3006',frameProjection='localX=(longitude-origin.lon)*mPerLon; localZ=(origin.lat-latitude)*mPerLat; exact pyproj between EPSG:4326 and EPSG:3006',
  anchorLocalXZ=anchor,anchorEPSG3006=anchor_grid,anchorObjectId='w221193965',anchorDefinition='Area centroid of current local clubhouse outline; scene datum only, not surveyed control.',
  blenderAxisConvention='Blender X=localX-anchorLocalX, Y=anchorLocalZ-localZ, Z=0 for this horizontal reference plane; one unit is one metre.',
  elevationDatum='Reference images and outlines are flat at Blender Z=0. No source Z is promoted to floor, eave, ridge or building height.',
  images=images,reviewPanels=panels,inventory=[{k:b[k] for k in ['id','municipalObjectId','name','function','confirmedExistingMeasuredOutline','status','planMethod','areaSquareMetres','heightMetres','functionEvidenceNote']} for b in buildings],
  footprintFiles=dict(allSourceOutlines='upsalabuild/facilities/reference-2026-09-10/building-footprints-reference.geojson',measuredWgs84='upsalabuild/facilities/reference-2026-09-10/measured-footprints.geojson',
      measuredLocal='upsalabuild/facilities/reference-2026-09-10/measured-footprints-local.json',inventory='upsalabuild/facilities/reference-2026-09-10/building-reference-inventory.json',context='upsalabuild/facilities/reference-2026-09-10/context-geometry-local.json'),
  sources=[dict(path=rel(p),sha256=sha(p)) for p in source_files],municipalRequest=read(municipal_dir/'municipal_buildings_aoi_xyz.request.json'),
  orthophotoCapture=dict(path=rel(REF/'orthophoto-capture.json'),sha256=sha(REF/'orthophoto-capture.json')),
  validation=dict(state='passed',nativePixels=sum(i['width']*i['height'] for i in images if i['resolutionMetres']==.16),sourceBuildings=len(buildings),confirmedExistingMeasuredOutlines=sum(b['confirmedExistingMeasuredOutline'] for b in buildings),
      maximumProjectionRoundtripMetres=maximum_roundtrip,checks=['TIFF and PNG SHA256','Exact RGBI band interpretation and PNG RGB values','EPSG3006 native grid and complete mask','Capture footprint coverage','Valid source polygons and exact roundtrip','No production model or geometry changes']),
  limitations=['Municipal building layers do not specify whether their plan outlines represent walls at ground or roof edges. Roof overhang and ortho relief displacement can differ from ground footprints.',
    'Status 0 means no information, not demolished. Uncertain source parts and overlapping parts remain separate evidence and must not be extruded automatically.',
    'All building heights, floor elevations, eaves, ridges, roof pitches, doors and windows require independent evidence.',
    'Source vertex Z is retained only as unverified evidence: vertical CRS and feature-level meaning are absent; 0/-999 occur as sentinels.',
    'Room/function-to-wing assignments beyond the named clubhouse and visible range shelter require club photographs or plans.',
    'Raw imagery remains in ignored cache for reference, not bundled into runtime or tracked source files. No geometry has been edited.'],
  attribution='Ortofoto Nedladdning © Lantmäteriet, bearbetad information. Municipal building source: Uppsala kommun OpenData_Byggnader.')
write(REF/'orthophoto-manifest.json',manifest)
print(json.dumps(dict(manifest=rel(REF/'orthophoto-manifest.json'),anchorLocalXZ=anchor,sourceBuildings=len(buildings),measured=sum(b['confirmedExistingMeasuredOutline'] for b in buildings),captureDates={i['id']:i['captureDates'] for i in images},maximumProjectionRoundtripMetres=maximum_roundtrip),indent=2))
