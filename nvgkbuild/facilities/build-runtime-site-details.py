"""Register observed solar arrays to measured roofs and retain ground features.

Run with geobuild/cache/ortho-venv/Scripts/python.exe. The full derived record
retains provenance; a separate compact runtime JSON contains only geometry.
Source imagery and laser returns stay in the ignored reference cache.
"""
import hashlib
import json
from pathlib import Path

import numpy as np
from pyproj import Transformer
from shapely.geometry import Point, Polygon

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'nvgkbuild/facilities/runtime-site-details.json'
RUNTIME_OUT = ROOT/'apps/golf/src/engine/scenery/norrfallsviken-facilities-site.json'
BLENDER_ORIGIN = np.array([678580.,6988405.,32.8])
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
ortho_path=ROOT/'nvgkbuild/mapping/facilities-ortho-reference.json'
height_path=ROOT/'nvgkbuild/mapping/facilities-height-reference.json'
ortho=json.loads(ortho_path.read_text(encoding='utf-8'))
heights=json.loads(height_path.read_text(encoding='utf-8'))
points_path=ROOT/heights['source']['localPointsPath']
assert sha(points_path)==heights['source']['localPointsSha256']
assert sha(ROOT/ortho['source']['rgbPath'])==ortho['source']['window']['rgbSha256']
cloud=json.loads(points_path.read_text(encoding='utf-8'))
assert cloud['columns']==['easting','northing','heightRH2000','classification','returnNumber','numberOfReturns','intensity']
points=np.asarray(cloud['points'],dtype=np.float64)
assert points.shape==(190926,7)
features={f['id']:f for f in ortho['features']}
roofs={f['id']:f for f in heights['facilities']}
roof=roofs['clubhouse-main-roof-native'];source_roof=features[roof['id']]
ring=np.asarray(roof['roofSupportRectangle']['ringEpsg3006'])
ridge=np.asarray(roof['ridge']['endpointsEpsg3006'])
source_ring=np.asarray(source_roof['ringEpsg3006'])
source_ridge=np.asarray(source_roof['ridgeEpsg3006'])

# The southwest roof face has the observed solar arrays. Four paired physical
# features constrain its image lean: north eave, north ridge, south ridge,
# south eave. The overdetermined affine retains a measurable fit residual.
source_controls=np.array([source_ring[0],source_ridge[0],source_ridge[1],source_ring[3]])
target_controls=np.array([ring[1],ridge[1],ridge[0],ring[0]])
origin=source_controls.mean(axis=0)
design=np.c_[source_controls-origin,np.ones(4)]
coef=np.linalg.lstsq(design,target_controls-origin,rcond=None)[0]
registered_controls=design@coef+origin
residual=np.linalg.norm(registered_controls-target_controls,axis=1)
assert residual.max()<.20
assert np.linalg.det(coef[:2])>0
assert np.all((np.linalg.svd(coef[:2])[1]>.95)&(np.linalg.svd(coef[:2])[1]<1.05))
plane=roof['planes'][0]
a,b,c=plane['coefficientsLocalEN'];pe,pn=roof['originEpsg3006']
height=lambda p:a*(p[0]-pe)+b*(p[1]-pn)+c
target_face=Polygon(target_controls)
assert target_face.is_valid
normal=np.array([-a,-b,1]);normal/=np.linalg.norm(normal)
runtime_projection=Transformer.from_crs(3006,4326,always_xy=True)
def local_xz(p):
    lon,lat=runtime_projection.transform(*p[:2])
    return [round((lon-18.5325)*50568.51,6),round((62.9825-lat)*111320,6)]
def rounded(values,places=6):
    return np.round(values,places).tolist()
def geometry(vertices):
    values=np.asarray(vertices)
    face=list(range(len(values)))
    if np.cross(values[1]-values[0],values[2]-values[0])[2]<0:
        face=[0]+list(reversed(face[1:]))
    assert np.cross(values[face[1]]-values[0],values[face[2]]-values[0])[2]>0
    return dict(verticesEpsg3006RH2000=rounded(vertices),faces=[face],
                verticesBlenderSceneXYZ=rounded(np.asarray(vertices)-BLENDER_ORIGIN),
                horizontalLocalXZ=[local_xz(p) for p in vertices])

solar=[]
minimum_clearance=.15
clear_face=target_face.buffer(-minimum_clearance)
assert not clear_face.is_empty
for identifier in ['clubhouse-main-solar-north-native','clubhouse-main-solar-south-native']:
    source=features[identifier]
    src=np.asarray(source['ringEpsg3006'])
    raw=np.c_[src-origin,np.ones(4)]@coef+origin
    centre=raw.mean(axis=0)
    # One hand-traced southern vertex is centimetres beyond the inner measured
    # support envelope. Retain its unconstrained registration, then make a
    # clearly recorded small display adjustment. No source vertex is erased.
    scale=1.
    if not clear_face.covers(Polygon(raw)):
        lo,hi=0.,1.
        assert clear_face.covers(Point(centre))
        for _ in range(60):
            mid=(lo+hi)/2
            if clear_face.covers(Polygon(centre+(raw-centre)*mid)):lo=mid
            else:hi=mid
        scale=lo*(1-1e-9)
    registered=centre+(raw-centre)*scale
    correction=np.linalg.norm(registered-raw,axis=1)
    assert correction.max()<.40
    polygon=Polygon(registered)
    assert clear_face.covers(polygon)
    vertices=np.array([[*p,height(p)] for p in registered])
    render=vertices+normal*.035
    minimum_distance=min(target_face.exterior.distance(Point(p)) for p in registered)
    assert minimum_distance>=minimum_clearance-1e-6
    area3d=polygon.area/normal[2]
    solar.append(dict(id=identifier,kind='roof_solar',roofFeatureId=roof['id'],roofPlaneId=plane['id'],
        source=dict(sourceWindow=source['sourceId'],sourcePixels=source['sourcePixels'],
                    originalRingEpsg3006=source['ringEpsg3006'],sourceRgbSha256=ortho['source']['window']['rgbSha256'],
                    capturedAt='2024-06-27T13:42:21Z',review=source['review']),
        unconstrainedRegisteredRingEpsg3006=rounded(raw),
        clearanceAdjustment=dict(method='uniform scaling about registered array centre to the 0.15 m inset of measured southwest roof face',
            scale=round(scale,9),maximumVertexMovementMetres=round(float(correction.max()),6),
            reason='Display clearance within manual tracing and sampled roof-edge uncertainty; original and unconstrained vertices retained'),
        surfaceGeometry=geometry(vertices),renderGeometry=geometry(render),
        renderNormalOffsetMetres=.035,roofNormalENH=rounded(normal,9),
        areaInRoofPlaneSquareMetres=round(float(area3d),3),
        materialInterpretation=dict(baseColourSrgb='#25363e',roughness=.28,
            notes='Observed dark solar-array groups; no invented module count, wiring or electrical specification'),
        validation=dict(entireArrayWithinMeasuredSouthwestRoofFace=True,
            minimumHorizontalClearanceMetres=round(minimum_distance,6),
            maximumOnPlaneResidualMetres=round(max(abs(p[2]-height(p)) for p in vertices),9)),
        uncertainty=dict(horizontalMetres='approximately 0.5–1.0; manual pixels registered to inner laser support envelope',
            verticalMetres=.2,absoluteArraySurvey=False)))
assert len(solar)==2

def observed_surface(identifier,kind):
    source=features[identifier];poly=Polygon(source['ringEpsg3006']);xmin,ymin,xmax,ymax=poly.bounds
    subset=points[(points[:,0]>=xmin)&(points[:,0]<=xmax)&(points[:,1]>=ymin)&(points[:,1]<=ymax)]
    subset=subset[[poly.covers(Point(p[:2])) for p in subset]]
    ground=subset[subset[:,3]==2]
    assert len(ground)>50
    quantiles=np.quantile(ground[:,2],[.05,.25,.5,.75,.95])
    level=float(quantiles[2])
    # Use the measured central ground distribution as the surface-level
    # evidence. A flat display level is explicit, and no raised deck is inferred.
    surface=np.array([[*p,level] for p in source['ringEpsg3006']])
    render=surface+np.array([0,0,.03])
    return dict(id=identifier,kind=kind,source=dict(sourceWindow=source['sourceId'],sourcePixels=source['sourcePixels'],
        ringEpsg3006=source['ringEpsg3006'],sourceRgbSha256=ortho['source']['window']['rgbSha256'],
        capturedAt='2024-06-27T13:42:21Z',review=source['review']),
        registration='Ground feature retained at source coordinates; no roof-lean correction',
        surfaceGeometry=geometry(surface),renderGeometry=geometry(render),renderVerticalOffsetMetres=.03,
        measuredGround=dict(class2ReturnCount=len(ground),medianRH2000=round(level,3),
            quantilesRH2000={key:round(float(value),4) for key,value in zip(['p05','p25','p50','p75','p95'],quantiles)},
            unclassifiedReturnCount=int((subset[:,3]==1).sum()),
            note='Class 2 only establishes adjacent/surface ground; it is not a survey of timber decks or slab structure'),
        planAreaSquareMetres=round(poly.area,3),confidence='dated visible boundary and independent measured ground; use/details interpreted')

terrace=observed_surface('lm-clubhouse-terrace','ground_terrace_surface')
terrace_poly=Polygon(features['lm-clubhouse-terrace']['ringEpsg3006'])
main_poly=Polygon(ring)
cross_poly=Polygon(roofs['clubhouse-cross-roof-native']['roofSupportRectangle']['ringEpsg3006'])
terrace.update(connection=dict(distanceToMeasuredMainRoofEnvelopeMetres=round(terrace_poly.distance(main_poly),4),
    overlapWithMainRoofEnvelopeSquareMetres=round(terrace_poly.intersection(main_poly).area,4),
    distanceToMeasuredCrossRoofEnvelopeMetres=round(terrace_poly.distance(cross_poly),4),
    interpretation='Small ground-level terrace/paved area beside the southeast clubhouse corner. Roof envelope overlap is expected beneath eaves; do not manufacture a new raised connecting bridge.'),
    rejectedLegacyAssumption='Previous +0.7 m terrace height was an illustrative estimate; no measured evidence supports it here.',
    limitation='The photographed larger east-facing pavilion/cross-gable decks are separate interpreted structures; this small orthophoto ring does not define them.')
padel=observed_surface('lm-padel-court','padel_court_surface')
padel.update(recommendation='Retain the existing observed surface footprint; no relocation or resizing to nominal court dimensions is supported.',
    minimumRectangleMetres=features['lm-padel-court']['minimumRectangleMetres'],
    materialInterpretation=dict(baseColourSrgb='#315880',notes='Blue court surface and pale boundary lines observed in the native orthophoto. Fence/post heights and exact enclosure construction require separate review.'),
    limitation='The inherited trace follows the visible court area approximately; it is not a regulation-dimension survey.')

def compact_feature(feature):
    render=feature['renderGeometry']
    return dict(id=feature['id'],verticesEpsg3006RH2000=render['verticesEpsg3006RH2000'],faces=render['faces'])

runtime=dict(schemaVersion=1,solarArrays=[compact_feature(f) for f in solar],
             terrace=compact_feature(terrace),padelCourt=compact_feature(padel))
runtime_bytes=(json.dumps(runtime,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n').encode('utf-8')
assert len(runtime_bytes)<5_000
for feature in runtime['solarArrays']+[runtime['terrace'],runtime['padelCourt']]:
    assert set(feature)=={'id','verticesEpsg3006RH2000','faces'}
    vertices=np.asarray(feature['verticesEpsg3006RH2000'])
    assert vertices.shape==(4,3) and np.isfinite(vertices).all()
    assert np.all((vertices[:,0]>678500)&(vertices[:,0]<678700))
    assert np.all((vertices[:,1]>6988200)&(vertices[:,1]<6988460))
    assert np.all((vertices[:,2]>25)&(vertices[:,2]<40))
RUNTIME_OUT.write_bytes(runtime_bytes)

report=dict(schemaVersion=1,groundId='norrfallsviken',kind='source-registered-facility-site-details',preparedOn='2026-09-10',
    coordinateFrame=dict(horizontalCrs='EPSG:3006',verticalDatum='RH2000',units='metres',
        blenderOriginEpsg3006RH2000=BLENDER_ORIGIN.tolist(),
        blenderAxes='X=easting-678580; Y=northing-6988405; Z=RH2000-32.8',
        runtimeHorizontal='EPSG:3006 -> WGS84, then x=(lon-18.5325)*50568.51; z=(62.9825-lat)*111320. Apply the established runtime vertical bridge separately.'),
    sources=[dict(path=ortho_path.relative_to(ROOT).as_posix(),sha256=sha(ortho_path)),
             dict(path=height_path.relative_to(ROOT).as_posix(),sha256=sha(height_path)),
             dict(path=points_path.relative_to(ROOT).as_posix(),sha256=sha(points_path),published=False)],
    solarRegistration=dict(method='Least-squares affine from four corresponding eave/ridge endpoints on the solar-bearing southwest roof plane',
        sourceRoofFeatureId=source_roof['id'],targetRoofFeatureId=roof['id'],
        sourceControlsEpsg3006=rounded(source_controls),targetControlsEpsg3006=rounded(target_controls),
        controlOrder=['north-eave','north-ridge','south-ridge','south-eave'],
        originEpsg3006=rounded(origin),matrix2x2EN=rounded(coef[:2].T,12),translationAtOriginEN=rounded(coef[2],12),
        equation='targetEN = originEN + matrix2x2EN * (sourceEN-originEN) + translationAtOriginEN',
        controlResidualsMetres=rounded(residual),fitRmseMetres=round(float(np.sqrt(np.mean(residual**2))),6),
        principalScaleFactors=rounded(np.linalg.svd(coef[:2])[1],9),
        targetPlane=dict(id=plane['id'],originEpsg3006=roof['originEpsg3006'],coefficientsLocalEN=plane['coefficientsLocalEN'],
                        equation='RH2000=a*(E-originE)+b*(N-originN)+c'),
        targetFaceEpsg3006=rounded(target_controls),
        limitation='This resolves visual roof lean relative to measured geometry; it is not an independent survey of solar-panel corners or a global image correction.'),
    solarArrays=solar,terrace=terrace,padelCourt=padel,
    runtimeExport=dict(path=RUNTIME_OUT.relative_to(ROOT).as_posix(),bytes=len(runtime_bytes),
        sha256=sha(RUNTIME_OUT),schemaVersion=1,contents='Only absolute EPSG:3006/RH2000 render vertices, face indices and feature IDs; full evidence remains in this file'),
    validation=dict(solarArrays=2,allArraysContained=True,allSurfaceVerticesOnMeasuredPlane=True,
        orthophotoAndLocalLaserHashesVerified=True,groundOnlyForGroundSurfaceHeights=True),
    generator=dict(path=Path(__file__).resolve().relative_to(ROOT).as_posix(),sha256=sha(Path(__file__))))
OUT.write_text(json.dumps(report,indent=2,ensure_ascii=False,allow_nan=False)+'\n',encoding='utf-8',newline='\n')
print(json.dumps(dict(file=OUT.relative_to(ROOT).as_posix(),sha256=sha(OUT),fitRmseMetres=report['solarRegistration']['fitRmseMetres'],
    runtimeExport=report['runtimeExport'],
    arrays=[dict(id=f['id'],clearance=f['validation']['minimumHorizontalClearanceMetres'],adjustment=f['clearanceAdjustment']['maximumVertexMovementMetres'])for f in solar],
    terraceRH2000=terrace['measuredGround']['medianRH2000'],padelRH2000=padel['measuredGround']['medianRH2000']),indent=2))
