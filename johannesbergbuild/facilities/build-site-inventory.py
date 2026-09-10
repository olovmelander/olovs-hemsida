"""Build private native-image review panels and an honest inherited-geometry inventory.

This does not change the course model. Run with the retained review Python env.
"""
import hashlib
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from pyproj import Transformer
from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'johannesbergbuild/facilities'
CACHE = ROOT / 'johannesbergbuild/cache/facilities-reference/orthophoto'
MODEL = ROOT / 'johannesbergbuild/course-model.json'
model = json.loads(MODEL.read_text('utf-8'))
meta = json.loads((CACHE / 'facilities-hub-native.json').read_text('utf-8'))
image = Image.open(CACHE / meta['rgbFile']).convert('RGB')
transform = Transformer.from_crs(4326, 3006, always_xy=True)
origin = model['origin']
mlon = model['mPerLat'] * math.cos(math.radians(origin['lat']))
font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 23)
small_font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 16)


def write(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', 'utf-8')


def pin(path):
    return dict(path=path.relative_to(ROOT).as_posix(), sha256=hashlib.sha256(path.read_bytes()).hexdigest())


def projected(p):
    return [round(v, 3) for v in transform.transform(origin['lon'] + p[0] / mlon,
                                                   origin['lat'] - p[1] / model['mPerLat'])]


def pixel(p):
    x0, r, _, y0, _, ry = meta['geoTransform']
    return [(p[0] - x0) / r, (p[1] - y0) / ry]


def geometry(points, kind='ring'):
    ep = [projected(p) for p in points]
    result = dict(kind=kind, **{kind + 'Local': points, kind + 'EPSG3006': ep})
    if kind == 'ring':
        poly = Polygon(ep)
        rect = list(poly.minimum_rotated_rectangle.exterior.coords)
        edges = [(math.dist(rect[i], rect[i + 1]), rect[i], rect[i + 1]) for i in range(4)]
        length, a, b = max(edges)
        result.update(centroidLocal=[round(v, 3) for v in Polygon(points).centroid.coords[0]],
                      centroidEPSG3006=[round(v, 3) for v in poly.centroid.coords[0]],
                      areaSquareMetres=round(poly.area, 2),
                      dimensionsM=dict(longAxis=round(length, 2), shortAxis=round(min(e[0] for e in edges), 2)),
                      orientationDegGridNorth=round(math.degrees(math.atan2(b[0]-a[0], b[1]-a[1])) % 180, 2),
                      dimensionMethod='Minimum-area oriented bounding rectangle of inherited footprint; not measured wall lengths.')
    return result


ROLE_MAP = {
    127: ('johannesberg-manor', 'Johannesbergs Slott', 'Hotel main building, reception and restaurant', 'official-labelled-estate-map'),
    128: ('johannesberg-old-stable', 'Red courtyard building', 'Unknown current role; old stable in historical local dossier', 'legacy-dossier-only'),
    129: ('johannesberg-east-slottsvilla', 'Östra Slottsvillan', 'Hotel rooms 74–88', 'official-labelled-estate-map'),
    130: ('johannesberg-east-wing', 'Östra Flygeln', 'Hotel rooms 1–28', 'official-labelled-estate-map'),
    131: ('johannesberg-clubhouse', 'Golf clubhouse', 'Golf clubhouse; exact current internal shop/reception layout unverified', 'official-golf-club-photographs'),
    132: ('johannesberg-clubhouse-shed', 'Clubhouse outbuilding', 'Unknown small building beside golf clubhouse', 'orthophoto-position-only'),
    133: ('johannesberg-west-slottsvilla', 'Västra Slottsvillan', 'Hotel rooms 59–73', 'official-labelled-estate-map'),
    134: ('johannesberg-karolinerhuset', 'Karolinerhuset', 'Hotel rooms 89–124; conference building', 'official-labelled-estate-map'),
    136: ('johannesberg-west-wing', 'Västra Flygeln', 'Hotel rooms 29–50; yoga/conference rooms', 'official-labelled-estate-map'),
    138: ('johannesberg-johannesbergsvillan', 'Johannesbergs Villan', 'Hotel rooms 51–58; spa, gym and pool', 'official-labelled-estate-map'),
    139: ('johannesberg-johannesbergsflygeln', 'Johannesbergs Flygel', 'Event building / Johannesbergssalen', 'official-labelled-estate-map'),
    143: ('johannesberg-private-residence', 'Private residence', 'Private residence', 'official-labelled-estate-map'),
    186: ('johannesberg-range-hut', 'Building beside northern range bays', 'Range-side hut; function unverified', 'legacy-dossier-plus-position'),
    306: ('johannesberg-range-shelter', 'Range shelter', 'Small roof shelter beside southern range bays', 'reviewed-2025-orthophoto'),
}

ROOF_NOTES = {
    126: 'L-shaped service-area roof; pale grey main section, dark perpendicular wing. Yard with stored materials around it; precise use unknown.',
    127: 'Complex dark multi-plane roof, dormers, central raised tower and glazed western conservatory visible. Tall roofs lean relative to ground in orthophoto.',
    128: 'Red pitched roof on bent courtyard block beside practice green; two long arms with joined corner.',
    129: 'Red hipped roof, elongated low building partly obscured by mature trees.',
    130: 'Dark elongated pitched roof with repeated roof panels/solar panels and dormers.',
    131: 'Elongated red/orange pitched roof with several dormers. Pale terrace/apron along golf-facing side. Historical facade photos show timber building and tiled roof.',
    132: 'Small rectangular red pitched roof; canopy/terrace surfaces nearby must remain separate.',
    133: 'Red hipped roof with dormers on a compact detached block.',
    134: 'Dark roof with several dormers and a raised square tower; multi-storey pale facade in official imagery.',
    135: 'Large agricultural-looking L-shaped block with long pale roof and dark side wing; current business/use unverified.',
    136: 'Elongated dark pitched roof with repeated roof panels/solar panels, dormers and pale multi-storey walls in official imagery.',
    137: 'Pale elongated pitched-roof block with red end/cross roof; usage unverified.',
    138: 'Low red-roof section immediately beside the much taller grey-roof Johannesbergs Flygel. Treat as separate source footprint without inventing the internal connection.',
    139: 'Large pale complex raised grey roof with smaller dark planes/solar panels. Official map confirms event hall; model footprint is not a roof outline.',
    140: 'Long red pitched-roof block, shadow on one slope; exact use unverified.',
    141: 'Long dark simple pitched-roof service-area block; exact use unverified.',
    142: 'Very small roof among dense tree crowns; outline and current function remain uncertain.',
    143: 'Small red complex roof largely tree-occluded; official estate map identifies private residence.',
    186: 'Small dark detached roof west of estate road at north end of range bays; exact current role uncertain.',
    270: 'Tiny detached red roof east of the hotel/golf hub; exact role unknown.',
    305: 'Tiny isolated feature in open rough south of courtyard block. Legacy trace calls it tower, but object identity and 10 m height are unverified.',
    306: 'Small pale rectangular shelter roof beside range mat path. Footprint was explicitly traced as roof edge in 2025 orthophoto review.',
}

panels = []
base_panel = dict(id=meta['id'], **pin(CACHE / meta['rgbFile']),
                  raster=pin(CACHE / meta['rasterFile']), boundsEPSG3006=meta['boundsEpsg3006'],
                  geoTransform=meta['geoTransform'], width=meta['width'], height=meta['height'],
                  pixelResolutionMetres=meta['resolutionMetres'], captureDate='2025-06-14',
                  sourceItems=meta['sources'], provenance=pin(CACHE / 'facilities-hub-native.json'),
                  kind='native-orthophoto', resampling='nearest', horizontalCrs='EPSG:3006')
panels.append(base_panel)
facilities = []
overview = image.copy()
draw = ImageDraw.Draw(overview)
for index in list(range(126, 144)) + [186, 270, 305, 306]:
    building = model['infra']['buildings'][index]
    identifier, label, role, role_source = ROLE_MAP.get(index, ('johannesberg-building-' + building['id'], 'Building ' + str(index), 'Unknown current role', 'no-verified-role'))
    geom = geometry(building['ring'])
    points = [pixel(p) for p in geom['ringEPSG3006']]
    pmin = [max(0, math.floor(min(p[a] for p in points) - 12 / .16)) for a in range(2)]
    pmax = [min(image.size[a], math.ceil(max(p[a] for p in points) + 12 / .16)) for a in range(2)]
    cropbox = tuple(pmin + pmax)
    plain = image.crop(cropbox)
    crop_file = CACHE / (identifier + '-native.png')
    plain.save(crop_file)
    overlay = plain.copy()
    cd = ImageDraw.Draw(overlay)
    relative = [(p[0]-pmin[0], p[1]-pmin[1]) for p in points]
    outline_color = '#59e0d0' if index == 306 else '#ffd55a'
    cd.line(relative + relative[:1], fill=outline_color, width=3)
    cd.rectangle((0,0,plain.width,51), fill='#17221e')
    cd.text((8,4), f'{index}: {label}', font=small_font, fill='white')
    cd.text((8,26), 'Reviewed roof, +/-1 m' if index ==306 else 'Inherited footprint', font=small_font, fill=outline_color)
    overlay_file = CACHE / (identifier + '-overlay.png')
    overlay.save(overlay_file)
    x0, res, _, y0, _, ry = meta['geoTransform']
    bounds = [round(x0+pmin[0]*res, 3), round(y0+pmax[1]*ry, 3), round(x0+pmax[0]*res, 3), round(y0+pmin[1]*ry, 3)]
    panel_id = identifier + '-native'
    panels.append(dict(id=panel_id, **pin(crop_file), annotation=pin(overlay_file), parentPanel=meta['id'],
                       pixelWindow=cropbox, boundsEPSG3006=bounds, width=plain.width, height=plain.height,
                       geoTransform=[bounds[0],res,0,bounds[3],0,ry],pixelResolutionMetres=res,
                       captureDate='2025-06-14', horizontalCrs='EPSG:3006',kind='unresampled-native-crop'))
    draw.line([tuple(p) for p in points] + [tuple(points[0])], fill=outline_color, width=3)
    centre = pixel(geom['centroidEPSG3006'])
    draw.rectangle((centre[0]-4,centre[1]-4,centre[0]+51,centre[1]+27),fill='#17221e')
    draw.text(centre,str(index),font=font,fill=outline_color)
    height_path = 'johannesbergbuild/facilities/roof-height-service-hall-evidence.json' if index ==126 else 'johannesbergbuild/facilities/roof-height-evidence.json'
    facilities.append(dict(id=identifier, label=label, category='building', role=role,
        roleEvidence=dict(kind=role_source, sourceBuildingName=building.get('name'),
                          externalReferences='johannesbergbuild/facilities/web-reference-sources.json' if role_source.startswith('official') else None),
        sourceModelPath=f'infra.buildings[{index}]', sourceBuildingId=building['id'], modelBuildingIndex=index,
        geometry=geom, geometryStatus='reviewed-2025-roof-edge-reference' if index==306 else 'inherited-model-footprint-not-wall-verified',
        footprintPurpose='Location and selection mask for modelling reference; no new wall geometry established.',
        roofEvidence=dict(nativePanelId=panel_id, captureDate='2025-06-14', observation=ROOF_NOTES[index],
                          roofEdgeTrace=dict(ledger=pin(ROOT/'johannesbergbuild/mapping/lm-review-estate.json'),
                              entryId='estate-range-shelter',uncertaintyMetres=1.0,
                              interpretation='Visible roof edge, including overhang/parallax uncertainty; not a surveyed wall footprint.') if index==306 else None,
                          measuredPitchDegrees=None),
        heightEvidence=dict(report=height_path, joinKey=dict(sourceBuildingId=building['id']),
                            modelApproximateHeightMetres=building.get('h'), modelHeightVerified=False,
                            measuredEaveHeightMetres=None, measuredRidgeHeightMetres=None,
                            limitation='2021 unclassified laser surface candidates constrain historical massing; they do not prove current eaves or ridge.'),
        confidence=dict(siteIdentity='high',role='high' if role_source.startswith('official') else 'unverified' if 'unverified' in role or 'Unknown' in role else 'medium',
                        footprintWalls='unverified', roofAppearance='moderate' if index not in [142,143,305] else 'low'),
        gaps=['Wall footprint differs from roof overhang and orthophoto parallax; do not snap walls to roof pixels.',
              'Current detailed facade dimensions and pitch require further modelling review.']))

overview_path = CACHE / 'facilities-overview-annotated.png'
overview.resize((1938,1313),Image.Resampling.LANCZOS).save(overview_path)

# The landing area continues west of the native hub window. Retain a separate
# crop of the existing 0.8 m context raster; never describe it as native detail.
ground_path = ROOT / 'johannesbergbuild/cache/lm-ortho/ground-overview.json'
ground = json.loads(ground_path.read_text('utf-8'))
gx, gr, _, gy, _, gry = ground['geoTransform']
range_points = [projected(p) for p in model['scenery']['range'][0]]
range_pixels = [((p[0]-gx)/gr,(p[1]-gy)/gry) for p in range_points]
rbox = [math.floor(min(p[a] for p in range_pixels)-20/gr) for a in range(2)]
rbox += [math.ceil(max(p[a] for p in range_pixels)+20/gr) for a in range(2)]
range_image = Image.open(ground_path.parent / ground['rgbFile']).crop(tuple(rbox))
range_file = CACHE / 'range-full-context-080m.png'
range_image.save(range_file)
rbounds = [gx+rbox[0]*gr,gy+rbox[3]*gry,gx+rbox[2]*gr,gy+rbox[1]*gry]
panels.append(dict(id='range-full-context-080m', **pin(range_file), parentPanel='ground-overview',
    parentImage=pin(ground_path.parent/ground['rgbFile']), provenance=pin(ground_path),
    pixelWindow=rbox,boundsEPSG3006=[round(v,3) for v in rbounds],width=range_image.width,height=range_image.height,
    geoTransform=[rbounds[0],gr,0,rbounds[3],0,gry],pixelResolutionMetres=.8,
    captureDate='2025-06-14',sourceItems=[s for s in ground['sources'] if s['id']=='o66250_6775_25_mr25'],
    horizontalCrs='EPSG:3006',kind='context-crop-from-averaged-raster',resampling='parent averaged to 0.8 m; crop unresampled'))

context = []


def context_feature(identifier,label,points,source_path,kind='ring',status='inherited-context-not-boundary-verified',notes=None):
    context.append(dict(id=identifier,label=label,category='site-context',sourceModelPath=source_path,
        geometry=geometry(points,kind),geometryStatus=status,notes=notes or [],
        evidencePanelId='range-full-context-080m' if identifier=='johannesberg-range-landing-area' else meta['id']))


context_feature('johannesberg-practice-green','Practice putting green',model['scenery']['practiceGreens'][0],
    'scenery.practiceGreens[0]',status='reviewed-2025-mown-surface',notes=['Existing September 2026 estate alignment review; mown green perimeter, not a building footprint.'])
context_feature('johannesberg-range-landing-area','Driving range landing area',model['scenery']['range'][0],
    'scenery.range[0]',notes=['Range play is toward the west. Native hub image covers only the east bay edge; separate 0.8 m crop covers the complete context.',
    'Inherited mown-area polygon, no new boundary survey. Existing net list is empty; do not invent nets.'])
context_feature('johannesberg-range-mat-line','Range bay line',model['scenery']['rangeFacilities']['bays'],
    'scenery.rangeFacilities.bays',kind='line',notes=['Two inherited endpoints with nominal 5 m pitch; individual mats and bay count have not been measured by this inventory.'])
context_feature('johannesberg-practice-bunker','Practice bunker beside range access',model['scenery']['bunkers'][0],
    'scenery.bunkers[0]',notes=['Retained contextual bunker polygon.'])
for i,p in enumerate(model['infra']['parking']):
    context_feature('johannesberg-'+p['id'].replace('trace-',''),
        ['Hotel roadside parking','Golf club main parking','Clubhouse apron'][i],p['ring'],f'infra.parking[{i}]',
        notes=['Existing semantic parking area; visible cars confirm activity but this polygon does not establish every physical kerb/road boundary.'])
for group,indices in [('paths',[0,8]),('tracks',[2,10,11,12,13,14,15,17,18,19,20,28])]:
    for i in indices:
        path = model['infra'][group][i]
        context_feature('johannesberg-access-'+path['id'],'Access '+path['id'],path['line'],f'infra.{group}[{i}]',kind='line',
            status='reviewed-2025-path-centreline' if path.get('reviewId') else 'inherited-access-centreline',
            notes=['Centreline context only; width and kerbs unverified.'])

# A visible-location pin preserves the uncertainty around the terrace boundary.
# Do not turn this locator into an invented deck polygon in the Blender scene.
club_panel = next(p for p in panels if p['id']=='johannesberg-clubhouse-native')
terrace_pixel = [club_panel['pixelWindow'][0]+125,club_panel['pixelWindow'][1]+244]
terrace_ep = [round(meta['geoTransform'][0]+terrace_pixel[0]*.16,3),round(meta['geoTransform'][3]-terrace_pixel[1]*.16,3)]
context.append(dict(id='johannesberg-clubhouse-terrace',label='Clubhouse terrace / seating apron',category='site-context',
    sourceModelPath=None,geometry=dict(kind='point',pointEPSG3006=terrace_ep),
    geometryStatus='approximate-visible-location-only-boundary-unresolved',
    evidencePanelId='johannesberg-clubhouse-native',sourcePixel=terrace_pixel,
    notes=['Seating/terrace confirmed by official golf clubhouse photographs and visible hardscape at the southwest end in 2025 orthophoto.',
           'Roof, deck and paved apron edges are adjacent; no terrace boundary or height is asserted here.',
           'Use historical facade photos only as appearance references; possible changes after 2018 and 2024 images remain unresolved.']))

write(OUT / 'orthophoto-panels.json', dict(schemaVersion=1,courseId='johannesberg',createdOn='2026-09-10',
    horizontalCrs='EPSG:3006',pixelConvention='Bounds and geotransforms refer to pixel outer corners; pixel centres are +0.5 column/+0.5 row.',
    purpose='Private modelling references, not runtime textures',panels=panels,overview=pin(overview_path)))
inventory = dict(schemaVersion=1,courseId='johannesberg',createdOn='2026-09-10',
    status='source-inventory-reference-only-no-course-geometry-change', sourceModel=pin(MODEL),
    coordinateFrame=dict(sourceLocal=model['frame'],originWgs84=origin,metresPerLatitudeDegree=model['mPerLat'],
        inverseMetresPerLongitudeDegree=mlon,transform='EPSG:4326 to EPSG:3006, pyproj always_xy=True',
        inverseFormula='longitude = origin.lon + x / (mPerLat*cos(origin.lat)); latitude = origin.lat - z/mPerLat',
        localWarning='Legacy local +x east and -z north are not exactly EPSG grid axes; project every vertex.',
        outputHorizontalCrs='EPSG:3006',outputVerticalReference='RH2000 only when explicitly supplied by the separate laser report'),
    orthophotoPanelIndex='johannesbergbuild/facilities/orthophoto-panels.json',
    sourcePolicy=['Orthophoto capture 2025-06-14; native 0.16 m pixels.',
        'Existing footprints retained solely as reference masks. Generic building geometry is not a surveyed or fully reviewed wall outline.',
        'Official estate map establishes hotel roles. Golf clubhouse is the separate red elongated building west of practice green.',
        'Historical web photographs and 2021 laser returns may predate alterations; no inferred eaves/ridge measurements.'],
    roleSourceDocuments=[dict(**pin(ROOT/'johannesbergbuild/cache/facilities-reference/web/estate-map-pdf.pdf'),
        url='https://www.johannesbergsslott.se/uploads/1/3/2/7/132774402/karta_jsb_2.pdf',
        purpose='Official named hotel building association; perspective map is not metric geometry.')],
    facilities=facilities,contextFeatures=context)
write(OUT / 'site-inventory.json', inventory)
print(f'Wrote {len(facilities)} building records, {len(context)} context features, {len(panels)} panels, overview')
