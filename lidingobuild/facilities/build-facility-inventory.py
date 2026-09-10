"""Join retained physical facility evidence without inventing current uses or geometry."""
from pathlib import Path
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from functools import lru_cache
from shapely.geometry import shape
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
read=lambda p: json.loads((ROOT/p).read_text(encoding='utf-8'))
@lru_cache(maxsize=None)
def sha(p):
    return hashlib.sha256((ROOT/p).read_bytes()).hexdigest()
ORIGIN=[677700.5,6586399.5,25.0]
CONTEXT='geo_data/course-v2/lidingo/reference/osm-context-epsg3006.geojson'
SURFACES='lidingobuild/mapping/facilities.geojson'
INFRA='lidingobuild/mapping/infrastructure.geojson'
HEIGHTS='lidingobuild/mapping/building-height-evidence.json'
ROOFS='lidingobuild/mapping/building-roof-meshes.json'
context={f['id']:f for f in read(CONTEXT)['features']}
heights={b['id']:b for b in read(HEIGHTS)['buildings']}
roofs={b['sourceFootprintId']:b for b in read(ROOFS)['buildings']}
features=[]

def mapped(feature,path,kind,name,group,notes=None):
    geom=shape(feature['geometry']); c=geom.centroid
    tags=feature['properties'].get('tags',{})
    result=dict(id=feature['id'],kind=kind,name=name,group=group,
        sourceFeatureId=feature['id'],sourceGeometryPath=path,sourceGeometryFileSha256=sha(path),
        geometryType=geom.geom_type,geometryEpsg3006=feature['geometry'],boundsEpsg3006=list(geom.bounds),
        centroidEpsg3006=[c.x,c.y],centroidBlenderXY=[c.x-ORIGIN[0],c.y-ORIGIN[1]],
        areaSquareMetres=round(geom.area,3) if geom.geom_type in ['Polygon','MultiPolygon'] else None,
        lengthMetres=round(geom.length,3) if geom.geom_type in ['LineString','MultiLineString'] else None,
        geometryStatus='retained source geometry; not surveyed; no 2025 retrace performed',sourceProperties=feature['properties'],
        heightStatus='not established',currentUseStatus='descriptive source association; verify current use',
        notes=notes or [],referenceWindowIds=['facilities-overview-lm-2025'])
    features.append(result)
    return result

names={
 'way/32262183':('Restaurant/reception building (north clubhouse)','clubhouse','Public photo interpretation is documented in docs/courses/lidingo-clubhouse-appearance.md; detailed dimensions are authored estimates.'),
 'way/32262176':('Lower clubhouse courtyard pavilion','clubhouse','OSM names this footprint Lidingö Golfklubb. Do not mistake that generic club tag for proof this is the restaurant; the restaurant photo association is the north building.'),
 'way/32262169':('South clubhouse annex','clubhouse','OSM building=sport, one level; individual rooms and functions unverified.'),
 'way/26408210':('West range-side barn/building','range-buildings','Large mapped barn beside range. Exact current use and history-to-footprint join remain unverified.'),
 'way/26408211':('East range-road barn/building','range-buildings','Separate mapped building across the road. Exact current use is unverified.'),
 'way/221846983':('Small range-side utility building candidate','range-buildings','18 selected 2021 returns do not support a stable roof mesh; do not use raw maximum as roof height.'),
 'way/40895787':('Small building beside south practice area','south-practice','Nearby mapped structure; its function, ownership and relationship to the golf club are unverified.'),
}
for identifier,(name,group,note) in names.items():
    record=mapped(context[identifier],CONTEXT,'building',name,group,[note])
    record['sourceFootprintId']=identifier
    record['referenceWindowIds']=['clubhouse-detail-lm-2025' if group=='clubhouse' else 'range-buildings-detail-lm-2025' if group=='range-buildings' else 'range-south-detail-lm-2025']
    if identifier in heights:
        h=heights[identifier]
        record['heightEvidence']=dict(sourcePath=HEIGHTS,sourceEpoch='2021-03-23',verticalCrs='EPSG:5613 / RH2000',
            footprintCentroidDtmRH2000=h.get('footprintCentroidDtmRH2000'),footprintBoundaryDtmRH2000=h.get('footprintBoundaryDtmRH2000'),
            selectedInteriorFirstReturns=h.get('selectedInteriorFirstReturns'),rawRoofCandidatesRH2000=h.get('roofCandidateAbsoluteHeightRH2000'),
            caution='Raw first-return candidate extrema may include vegetation or rooftop equipment; use supported roof mesh statistics below.')
    if identifier in roofs:
        roof=roofs[identifier]
        record['heightStatus']='dated laser-supported roof candidate; architectural eaves and wall heights unverified'
        record['heightEvidence'].update(supportedRoofMeshPath=ROOFS,supportedRoofState=roof['state'],statistics=roof['mesh']['statistics'])
    elif identifier in heights:
        record['heightStatus']='insufficient planar support; roof withheld'

for f in read(SURFACES)['features']:
    p=f['properties']
    record=mapped(f,SURFACES,p['kind'],p.get('name',f['id'].replace('lidingo-','').replace('-',' ')),p['parentFacilityId'],[p.get('note','')])
    record['sourceFeatureId']=p.get('sourceFeatureId',f['id'])
    record['observedYear']=p.get('observedYear')
    record['heightStatus']='surface drape uses retained 1 m terrain; no independent spot levels'
    record['referenceWindowIds']=['clubhouse-detail-lm-2025' if 'clubhouse' in p['parentFacilityId'] else 'upper-parking-detail-lm-2025' if 'parking' in p['parentFacilityId'] else 'range-south-detail-lm-2025' if 'south-practice' in p['parentFacilityId'] else 'facilities-overview-lm-2025']

for f in read(INFRA)['features']:
    if f['id'] in ['way/32428950','way/52583105']:
        record=mapped(f,INFRA,'parking','Northwest overflow parking candidate' if f['id']=='way/32428950' else 'South range-road parking','parking',
             ['Retained OSM closed amenity=parking way normalized to polygon without changing vertices. Exact 2025 edge and stall layout not retraced.'])
        record['referenceWindowIds']=['upper-parking-detail-lm-2025' if f['id']=='way/32428950' else 'range-buildings-detail-lm-2025']

path_names={
 'way/32428969':'Upper parking aisle east', 'way/32428972':'Upper parking aisle west',
 'way/41197227':'South range service access', 'way/221846977':'East range service path',
 'way/79550926':'North clubhouse service access', 'way/427426698':'Clubhouse parking approach',
 'way/427426716':'Clubhouse one-way service approach', 'way/427429857':'Courtyard gravel footway',
 'way/836722128':'South range parking aisle', 'way/221846979':'Upper parking paved footway',
}
for identifier,name in path_names.items():
    mapped(context[identifier],CONTEXT,'access_centreline',name,'access',
        ['Source centreline only: width, kerbs, paving extent, turning radius and current direction/access have not been remeasured.'])
fence=mapped(context['way/52583080'],CONTEXT,'fence_centreline','West driving-range fence/net alignment','range',
    ['OSM says barrier=fence. The 2025 orthophoto corroborates tall range-edge posts/shadows, but the source line does not measure net top, pole spacing or structure.'])
fence['heightStatus']='net/pole height unknown; do not infer from shadows without sun-angle and slope analysis'

unresolved=[
 dict(id='north-range-covered-tee-structure',kind='untraced_building',name='North range covered tee structure',group='range',
      sourceEvidence=['range-north-detail-lm-2025'],observationBoundsEpsg3006=[677582,6586378,677605,6586396],
      observation='A narrow roof-like structure is visible at the west end of the north tee apron.',gaps=['Wall/roof footprint not traced','Eaves/ridge heights','Mat and bay count','Side elevations']),
 dict(id='south-range-covered-tee-structure',kind='untraced_building',name='South range covered tee structure',group='range',
      sourceEvidence=['range-south-detail-lm-2025'],observationBoundsEpsg3006=[677550,6586140,677591,6586162],
      observation='Elongated dark roof is visible beside the south tee platform; absent from the retained OSM building footprints.',gaps=['Wall/roof footprint not traced','Eaves/ridge heights','Supports and net connections','Facade photos']),
 dict(id='restaurant-terrace-putting-green',kind='untraced_practice_green',name='Putting green northeast of restaurant terrace',group='clubhouse',
      sourceEvidence=['clubhouse-detail-lm-2025'],observationBoundsEpsg3006=[677670,6586478,677706,6586530],
      observation='Distinct green east/northeast of north restaurant, additional to the courtyard and southeast pavilion greens already in facilities.geojson.',gaps=['Current ring not traced','Reconcile with generic playing greens to prevent duplicate geometry']),
 dict(id='range-south-target-green',kind='untraced_practice_green',name='South target green within range field',group='range',
      sourceEvidence=['range-south-detail-lm-2025'],observationBoundsEpsg3006=[677577,6586181,677605,6586212],
      observation='Separate small green target is visible in the southern range field, additional to retained central target green.',gaps=['Exact ring','Target equipment and distances']),
 dict(id='clubhouse-terrace-stairs-entrance',kind='architecture_details',name='Tiered timber terrace, stairs, rails, entry wall/pillars',group='clubhouse',
      sourceEvidence=['clubhouse-detail-lm-2025','docs/courses/lidingo-clubhouse-appearance.md','https://www.lidingogk.se/nyheter/vikingaskeppet-6-7-juli/'],
      observation='Photographs corroborate these details; existing app contains an approximate terrace display model.',gaps=['Precise deck outlines and elevations','Rail spacing','Stair rise/run','Entrance details and facade dimensions']),
 dict(id='range-east-net-and-equipment',kind='range_equipment',name='East range netting, masts, mats and equipment',group='range',
      sourceEvidence=['facilities-overview-lm-2025','https://www.lidingogk.se/trana/rangen-ovningsomraden/'],
      observation='Eastern pole shadows, tee rows and equipment are visible. A separate red utility hut and open canopy are present in a club range photograph.',gaps=['Current mast base coordinates and heights','Net runs and cable connections','Exact mat count','Locate photographed red hut before joining to way/221846983 or another structure']),
 dict(id='upper-parking-practice-works',kind='untraced_practice_area',name='New practice area by upper parking',group='practice',
      sourceEvidence=['https://www.lidingogk.se/trana/rangen-ovningsomraden/','upper-parking-detail-lm-2025'],
      observation='Club identifies a practice area by upper parking. The May 2025 image shows greens/bunkers northeast of parking, but current intended boundary and any later works remain unconfirmed.',gaps=['Current as-built extent','Construction/completion date relative to 2025-05-31','Detailed bunker/green rings']),
 dict(id='south-range-short-game-area',kind='practice_area',name='Chipping and bunker practice south of range',group='practice',
      sourceEvidence=['https://www.lidingogk.se/trana/rangen-ovningsomraden/','range-south-detail-lm-2025'],
      observation='Club confirms south range short-game practice; the retained south putting green covers only part of the visible green/bunker/approach complex.',gaps=['Full group boundary','Practice bunker and apron joins to generic golf-surface data','Current markers and equipment']),
 dict(id='old-17-practice-green',kind='unlocated_practice_area',name='Practice green at old hole 17',group='practice',
      sourceEvidence=['https://www.lidingogk.se/trana/rangen-ovningsomraden/'],
      observation='Official page identifies old 17 green as a practice area.',gaps=['Geolocate historical hole 17; do not assume current hole 17 coordinates','Dedicated ortho crop and current dimensions']),
 dict(id='halfway-kiosk',kind='unlocated_building',name='Kiosk between holes 9 and 10',group='course-support',
      sourceEvidence=['https://www.lidingogk.se/gaster/'],
      observation='Official guest page identifies kiosk between 9 and 10.',gaps=['Exact footprint and coordinate','Exterior photos','Roof/wall dimensions','Current associated seating/paths']),
 dict(id='maintenance-carts-equipment-conference',kind='unlocated_building_uses',name='Maintenance, golf-cart/equipment and conference premises',group='support',
      sourceEvidence=['https://www.lidingogk.se/media/xiogpfrw/lgk-90-%C3%A5r-2023-05-23.pdf'],
      observation='Club anniversary history pp8–9 identifies west barn maintenance staff (2016), B4 garage for 14 electric carts, B3 bag store/tournament office and B2 conference/junior space (2017). Counts and uses are historical report facts, not a current inspection.',gaps=['Join historical B2/B3/B4 and Västra Ladan labels to exact current footprints','Current room uses and exterior alterations']),
 dict(id='starter-hut',kind='unlocated_building',name='Starter hut outside B4',group='course-support',
      sourceEvidence=['https://www.lidingogk.se/media/xiogpfrw/lgk-90-%C3%A5r-2023-05-23.pdf'],
      observation='Anniversary history pp8–9 reports starter hut built outside B4 in 2018.',gaps=['Identify B4 footprint','Hut coordinates and roof/wall footprint','Current exterior photos and height']),
 dict(id='clubhouse-range-sanitary-water',kind='unlocated_building_details',name='B4/east-barn toilets, club washing and water points',group='course-support',
      sourceEvidence=['https://www.lidingogk.se/media/xiogpfrw/lgk-90-%C3%A5r-2023-05-23.pdf'],
      observation='Anniversary history pp8–9 reports two B4-gable toilets facing starter hut in 2021, east-barn toilets in 2021, B3-gable club-wash sinks and water tap/sink toward the path to tee 5.',gaps=['Exact B3/B4 and east-barn facade joins','Door positions, sinks, water point dimensions','Current condition; potable-water status not established']),
 dict(id='tee-15-toilet',kind='unlocated_building',name='Toilet by tee 15',group='course-support',
      sourceEvidence=['https://www.lidingogk.se/media/xiogpfrw/lgk-90-%C3%A5r-2023-05-23.pdf'],
      observation='Anniversary history records a toilet at tee 15 added in 2023.',gaps=['Exact coordinate and footprint','Exterior and roof height','Dedicated orthophoto crop']),
 dict(id='bag-store-ev-charging',kind='unlocated_equipment',name='Electric vehicle charging bays by bag store',group='parking',
      sourceEvidence=['https://www.lidingogk.se/media/xiogpfrw/lgk-90-%C3%A5r-2023-05-23.pdf'],
      observation='Anniversary history reports six EV charging spaces by the bag store long side in 2022.',gaps=['Join bag store to exact footprint and side','Charger positions, models and markings','Current capacity']),
 dict(id='east-barn-indoor-range',kind='unlocated_building_use',name='Indoor hitting bays in east barn upper floor',group='range',
      sourceEvidence=['https://www.lidingogk.se/media/xiogpfrw/lgk-90-%C3%A5r-2023-05-23.pdf'],
      observation='Anniversary history reports east-barn upper floor conversion in 2018–2019 for six indoor hitting bays.',gaps=['Confirm east barn footprint-ID association','Current exterior openings and bay arrangement','Current use and number of bays']),
]
for record in unresolved:
    record.update(sourceFeatureId=None,sourceFootprintId=None,geometryEpsg3006=None,geometryStatus='not mapped; observation bounds are search windows, not footprints',heightStatus='unverified')

report=dict(schemaVersion=1,groundId='lidingo',createdAt=datetime.now(timezone.utc).isoformat(),
    state='reference-inventory-with-explicit-gaps',horizontalCrs='EPSG:3006',verticalCrs='EPSG:5613 / RH2000',
    blenderOriginEpsg3006RH2000=ORIGIN,scope='Clubhouse and nearby facility corridor; source-confirmed outlying facilities retained as unlocated follow-ups.',
    scopeBoundsEpsg3006=[677500,6586030,677730.08,6586570.08],
    inputs=[dict(path=p,sha256=sha(p)) for p in [CONTEXT,SURFACES,INFRA,HEIGHTS,ROOFS,'lidingobuild/facilities/orthophoto-reference.json']],
    mappedFeatures=features,unresolvedFacilities=unresolved,
    counts=dict(mappedFeatures=len(features),byKind=dict(Counter(f['kind'] for f in features)),supportedRoofMeshes=len(roofs),unresolvedEntries=len(unresolved)),
    limitations=['The inventory is broader than the existing five architectural display models and is not a claim that every facility is modeled.',
                 'OSM acquisition date 2026-09-07 is not the observation date of every footprint.',
                 '2021 roof evidence, 2019 traced surfaces, 2024 photos and 2025 orthophotos have different epochs.',
                 'Nearby structures are not assigned to club ownership or use without evidence.',
                 'Facility surfaces retain their exact historical geometry; current orthophotos are review references only.'])
(HERE/'facility-inventory.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')

# A labeled, georeferenced visual index is a review aid, never a replacement image.
ortho=read('lidingobuild/facilities/orthophoto-reference.json')
base=next(w for w in ortho['windows'] if w['id']=='facilities-overview-lm-2025')
image=Image.open(ROOT/base['imagePath']).convert('RGB'); draw=ImageDraw.Draw(image)
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',18)
pixel=lambda p: ((p[0]-base['boundsEpsg3006'][0])/base['resolutionMetres'],(base['boundsEpsg3006'][3]-p[1])/base['resolutionMetres'])
for index,record in enumerate(features,1):
    geom=shape(record['geometryEpsg3006']); colour='#ffbb33' if record['kind']=='building' else '#48e4ff' if record['kind']=='access_centreline' else '#e24cff'
    if geom.geom_type=='Polygon':
        for ring in [geom.exterior,*geom.interiors]: draw.line([pixel(p) for p in ring.coords],fill=colour,width=3)
    elif geom.geom_type=='LineString': draw.line([pixel(p) for p in geom.coords],fill=colour,width=3)
    elif geom.geom_type=='MultiPolygon':
        for polygon in geom.geoms:
            for ring in [polygon.exterior,*polygon.interiors]: draw.line([pixel(p) for p in ring.coords],fill=colour,width=3)
    draw.text(pixel(geom.representative_point().coords[0]),str(index),font=font,fill='white',stroke_fill='black',stroke_width=2)
    record['overviewLabel']=index
overlay=ROOT/'lidingobuild/cache/facilities-reference-2026-09-10/ortho/facilities-inventory-overlay.png'
image.save(overlay)
report['reviewOverlay']=dict(path=overlay.relative_to(ROOT).as_posix(),sha256=hashlib.sha256(overlay.read_bytes()).hexdigest(),baseImageId=base['id'],note='Numbers match mappedFeatures[].overviewLabel; historical geometries over 2025 pixels are diagnostic overlays, not accepted new tracing.')
(HERE/'facility-inventory.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')

lines=['# Lidingö facilities reference inventory','',
 'This package inventories **'+str(len(features))+' mapped physical features** and **'+str(len(unresolved))+' unresolved facility/detail groups**. Five buildings have dated supported roof meshes; this is an evidence pack and editable-model starting point, not a complete surveyed facility model.','',
 'Coordinates use EPSG:3006 and RH2000. Blender origin is E 677700.5, N 6586399.5, H 25 m; X points east, Y north and Z up. One unit is one metre.','',
 'The [JSON inventory](facility-inventory.json) preserves exact geometry, IDs, bounds, source hashes, height evidence and unknowns. Its numbered overlay is private at `'+report['reviewOverlay']['path']+'`.','',
 '| Overlay | Exact feature/footprint ID | Physical feature | Evidence / remaining work |','| ---: | --- | --- | --- |']
for index,record in enumerate(features,1):
    note=record['heightStatus'] if record['kind']=='building' else record['geometryStatus']
    if record['kind']=='building' and record['id'] in roofs:
        stats=record['heightEvidence']['statistics']; height=stats['roofHeightRH2000']
        note=f"2021 roof {height['minimum']:.2f}–{height['maximum']:.2f} m RH2000; {stats['footprintCoverageFraction']*100:.2f}% supported. Eaves/facades unmeasured."
    lines.append(f"| {index} | `{record['id']}` | {record['name']} | {note} |")
lines+=['','## Facilities and details still needing geometry or identity evidence','',
 'Search rectangles in the JSON are deliberately not building footprints. Public use descriptions do not by themselves identify a mapped building.','',
 '| Facility/detail | Evidence | Required follow-up |','| --- | --- | --- |']
for r in unresolved:
    sources=', '.join('['+('club source' if str(s).startswith('http') else str(s))+']('+str(s)+')' if str(s).startswith('http') else '`'+str(s)+'`' for s in r['sourceEvidence'])
    lines.append('| '+r['name']+' | '+sources+' | '+'; '.join(r['gaps'])+' |')
lines+=['','## Dates and interpretation','',
 'The orthophotos show 31 May 2025. Existing facility traces show 2019; the retained laser roof evidence was captured 23 March 2021. The September 2026 OSM retrieval date does not make every source footprint current. Five display buildings already have estimated architectural detail; unsupported laser regions and estimated facades must remain distinguishable from measurements.','',
 'The north restaurant, lower pavilion and south annex are separate buildings. OSM labels the pavilion footprint `way/32262176` with the club name, while existing photo-based architecture associates the restaurant/reception with `way/32262183`. Range-side barns and the small southern building must keep uncertain uses explicit.','',
 'The native orthophoto visibly contains additional covered tee structures and a third clubhouse putting green absent from the fourteen retained facility polygons. The inventory records these gaps without silently generating substitute geometry.','',
 'For source photographs, see [web-reference.json](web-reference.json). For registered imagery, see [orthophoto-reference.md](orthophoto-reference.md).','']
(HERE/'facility-inventory.md').write_text('\n'.join(lines),encoding='utf-8')
print(json.dumps(report['counts']))
