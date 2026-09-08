"""Compile retained OSM rings and explicit orthophoto traces, preserving provenance.

This produces provisional source-derived geometry, never a surveyed surface layer.
"""
from pathlib import Path
from hashlib import sha256
import json
import math
from PIL import Image, ImageDraw
from pyproj import Transformer
from shapely.geometry import shape
from shapely.validation import explain_validity

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'lidingobuild/mapping'
CACHE = ROOT / 'lidingobuild/cache/surface-mapping-2019'
osm_path = ROOT / 'geo_data/course-v2/lidingo/reference/osm-golf-epsg3006.geojson'
trace_path = OUT / 'surface-traces-2019.json'
extra_trace_path = OUT / 'fairway-traces-review.json'
refinement_path = OUT / 'surface-refinements-2019.json'
osm = json.loads(osm_path.read_text(encoding='utf8'))
traces = json.loads(trace_path.read_text(encoding='utf8'))
extra_traces = json.loads(extra_trace_path.read_text(encoding='utf8'))
refinements = json.loads(refinement_path.read_text(encoding='utf8'))
# The 2019 traces are PIXELS in one image's frame; the 2025 additions are
# rings already in EPSG:3006, measured on a different capture. They are read
# separately for exactly that reason - a file whose coordinates are already
# world metres must not go through the pixel path, and must not be asserted
# against the 2019 image the pixel path is registered to.
additions_path = OUT / 'surface-additions-2025.json'
additions = json.loads(additions_path.read_text(encoding='utf8')) if additions_path.exists() else None
# The tee decks measured on the same capture. Only the decks whose PLATFORM
# (laser + photograph) and whose CARD distance agree are read here - the
# two-records rule, applied by adoption string rather than by re-deriving it,
# so the evidence file stays the single place that decides.
decks_path = OUT / 'tee-deck-2025.json'
decks = json.loads(decks_path.read_text(encoding='utf8')) if decks_path.exists() else None
TWO_RECORD_DECK = 'measured-candidate-deck; two records agree'
assert extra_traces['sourceImage']==traces['sourceImage']
assert refinements['sourceImage']==traces['sourceImage']
traces['traces'].extend(extra_traces['traces'])
traces['traces'].extend(refinements['traces'])
traces['excludedOsmFeatures'].update(refinements.get('excludedOsmFeatures',{}))
image_path = ROOT / traces['sourceImage']
world_path = ROOT / 'lidingobuild/cache/municipal-ortho-2019/lidingo-2019-0p5m.pgw'
world = [float(x) for x in world_path.read_text().split()]
assert sha256(image_path.read_bytes()).hexdigest()==extra_traces['sourceImageSha256']
assert sha256(image_path.read_bytes()).hexdigest()==refinements['sourceImageSha256']
project = Transformer.from_crs(3011,3006,always_xy=True)
# A projected coordinate is written to the MILLIMETRE. Two PROJ builds agree
# on this transform to about a nanometre, which is nine orders of magnitude
# inside the metres of interpretation uncertainty each trace states - so a
# full-precision float makes every rerun on a different machine rewrite every
# ring and a reviewer cannot tell a re-measured surface from a library upgrade.
OUTPUT_PRECISION_METRES = 0.001
def at_output_precision(e,n):
    return [round(e,3),round(n,3)]
to_source = Transformer.from_crs(3006,3011,always_xy=True)
greens = {143591667:2,296422990:4,296422971:5,296422974:8,143587585:9,143587542:10,427429853:11,221846967:13,331796643:15,427426825:16,427426867:17,296423010:18}
tees = {221832565:3,221832567:3,221832578:3,296422978:8,296422999:8,331796626:7,331796654:7,331796609:16,331796648:16,331796671:16,427426704:15,427426720:15,427426728:15,427426821:18,427426836:18,1530686621:9,1530686622:9,296422981:17}
fairways = {143587536:10,296423006:18,331796631:15,427426819:14,427426869:17}
bunkers = {int(k):v for k,v in refinements['osmBunkerHoleAssociations'].items()}
features=[]
for f in osm['features']:
    if f['id'] in traces.get('excludedOsmFeatures',{}):
        continue
    kind=f['properties']['tags']['golf']
    if kind not in ['green','tee','fairway','bunker'] or f['geometry']['type']!='Polygon':
        continue
    numeric=int(f['id'].split('/')[1])
    hole=greens.get(numeric) if kind=='green' else tees.get(numeric) if kind=='tee' else fairways.get(numeric) if kind=='fairway' else bunkers.get(numeric)
    features.append({'type':'Feature','id':f['id'],'properties':{'kind':kind,'hole':hole,'sourceId':'lidingo-osm-2026-09-07','sourceFeatureId':f['id'],'sourceVersion':f['properties'].get('osmVersion'),'sourceTimestamp':f['properties'].get('osmTimestamp'),'observedYear':None,'reviewStatus':'machine-visual-review','notSurveyed':True,'method':'unchanged-osm-source-ring','associationStatus':'gross-source-image-and-guide-corroboration' if hole else 'unassigned','geometryReview':'Preserved supplementary OSM geometry; not upgraded to orthophoto precision or survey authority.','licence':'ODbL-1.0'},'geometry':f['geometry']})
for t in traces['traces']:
    points=[]
    for px,py in t['pixels']:
        x,y=px+t['origin'][0],py+t['origin'][1]
        e,n=project.transform(world[4]+world[0]*x,world[5]+world[3]*y)
        points.append(at_output_precision(e,n))
    if points[0]!=points[-1]: points.append(points[0])
    features.append({'type':'Feature','id':t['id'],'properties':{'kind':t['kind'],'hole':t['hole'],'sourceId':traces['sourceId'],'observedYear':2019,'captureDate':None,'reviewStatus':'machine-visual-review','notSurveyed':True,'method':'manual-image-boundary-digitization','sourcePixelTrace':t['id'],'interpretationUncertaintyMetres':t['uncertaintyMetres'],'registrationAccuracy':'not independently checked','note':t['note'],'licence':'CC0-1.0'},'geometry':{'type':'Polygon','coordinates':[points]}})
if decks:
    capture = {'id': decks['sourceCapture']['id'], 'captureDate': decks['sourceCapture']['captureDate'],
               'sha256': decks['sourceCapture']['sha256'],
               'licence': decks['sourceCapture']['licence'],
               'attribution': decks['sourceCapture']['attribution']}
    adopted_decks = [d for d in decks['decks'] if d['adoption'].startswith(TWO_RECORD_DECK)]
    for d in adopted_decks:
        ring = [at_output_precision(*pt) for pt in d['geometry']['coordinates'][0]]
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        # A boundary trace on a 1 m grid PINCHES where the component narrows to
        # one cell, and a pinch is a ring self-intersection. Repairing it is a
        # geometry fix and is recorded as one; it is never silent, and the area
        # it costs is reported beside the cell count it came from.
        repaired = None
        polygon = shape({'type': 'Polygon', 'coordinates': [ring]})
        if not polygon.is_valid:
            fixed = polygon.buffer(0)
            parts = sorted(getattr(fixed, 'geoms', [fixed]), key=lambda g: -g.area)
            assert parts and parts[0].area > 1, d['id']
            repaired = {'reason': explain_validity(polygon),
                        'cellAreaSquareMetres': d['areaSquareMetres'],
                        'repairedAreaSquareMetres': round(parts[0].area, 2),
                        'discardedParts': len(parts) - 1}
            ring = [at_output_precision(x, y) for x, y in parts[0].exterior.coords]
        hole = d['cardCorroboration']['hole']
        features.append({'type':'Feature','id':d['id'],'properties':{
            'kind':'tee','hole':hole,'sourceId':capture['id'],
            'observedYear':2025,'captureDate':capture['captureDate'],
            'sourceImageSha256':capture['sha256'],
            'reviewStatus':'machine-measured; no independent human survey','notSurveyed':True,
            'method':'laser-flat mown platform measured on the 2025 capture, corroborated by a card distance',
            'cardTee':d['cardCorroboration']['tee'],
            'cardMetres':d['cardCorroboration']['cardMetres'],
            'cardResidualMetres':d['cardCorroboration']['residualMetres'],
            'edgeStepMetres':d['edgeStepMetres'],
            'independentSecondRecord':True,
            **({'ringRepairedFromTracePinch':repaired} if repaired else {}),
            'registrationAccuracy':'not independently checked',
            'licence':capture['licence'],'attribution':capture['attribution']},
            'geometry':{'type':'Polygon','coordinates':[ring]}})

if additions:
    # each capture states its own sha256, so a ring adopted from one image can
    # never be silently re-attributed to another
    capture = additions['sourceCapture']
    assert additions['horizontalCrs'] == 'EPSG:3006', additions['horizontalCrs']
    for a in additions['features']:
        ring = [at_output_precision(pt[0],pt[1]) for pt in a['ring']]
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        features.append({'type':'Feature','id':a['id'],'properties':{
            'kind':a['kind'],'hole':a['hole'],'sourceId':capture['id'],
            'observedYear':a['observedYear'],'captureDate':capture['captureDate'],
            'sourceImageSha256':capture['sha256'],
            'reviewStatus':a['reviewStatus'],'notSurveyed':a['notSurveyed'],
            'method':a['method'],'datingVerdict':a['datingVerdict'],
            'clubRecord':a['clubRecord'],'note':a['note'],
            'registrationAccuracy':'not independently checked',
            'licence':capture['licence'],'attribution':capture['attribution']},
            'geometry':{'type':'Polygon','coordinates':[ring]}})
assert len({f['id'] for f in features})==len(features),'duplicate feature IDs'
for f in features:
    ring=f['geometry']['coordinates'][0]
    assert len(ring)>=4 and ring[0]==ring[-1],f['id']
    assert all(len(p)==2 and all(math.isfinite(n) for n in p) for p in ring),f['id']
    polygon=shape(f['geometry'])
    assert polygon.is_valid and polygon.area>1,(f['id'],explain_validity(polygon))
    f['properties']['areaSquareMetres']=round(polygon.area,2)
for hole in range(1,19):
    assert len([f for f in features if f['properties']['kind']=='green' and f['properties']['hole']==hole])==1,hole
result={'type':'FeatureCollection','name':'Lidingö provisional observed playing surfaces','crs':{'type':'name','properties':{'name':'EPSG:3006'}},'axisOrder':['easting','northing'],'reviewStatus':'provisional-source-derived-not-surveyed','features':features}
(OUT/'playing-surfaces.geojson').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
image=Image.open(image_path).convert('RGB'); draw=ImageDraw.Draw(image)
for f in features:
    ring=[]
    for e,n in f['geometry']['coordinates'][0]:
        se,sn=to_source.transform(e,n)
        ring.append(((se-world[4])/world[0],(sn-world[5])/world[3]))
    colors={'green':'#ff66dd','tee':'#55eeff','fairway':'#ddff55','bunker':'#ff9933'}
    draw.line(ring,fill=colors[f['properties']['kind']],width=2)
    if f['properties']['hole'] and f['properties']['kind']=='green':
        cx=sum(p[0] for p in ring[:-1])/(len(ring)-1);cy=sum(p[1] for p in ring[:-1])/(len(ring)-1)
        draw.text((cx,cy),str(f['properties']['hole']),fill='white',stroke_width=2,stroke_fill='black')
image.save(CACHE/'playing-surfaces-overlay.png')
report={'schemaVersion':1,'groundId':'lidingo','status':'provisional-source-derived-not-surveyed','sourceImage':{'path':traces['sourceImage'],'sha256':sha256(image_path.read_bytes()).hexdigest(),'horizontalCrs':'EPSG:3011','observedYear':2019,'captureDate':None,'licence':'CC0-1.0'},'inputs':[{'path':str(p.relative_to(ROOT)).replace('\\','/'),'sha256':sha256(p.read_bytes()).hexdigest()} for p in [osm_path,trace_path]],'featureCount':len(features),'counts':{kind:sum(f['properties']['kind']==kind for f in features) for kind in ['green','tee','fairway','bunker']},'holesWithGreen':sorted(f['properties']['hole'] for f in features if f['properties']['kind']=='green' and f['properties']['hole']),'holesWithAssociatedTee':sorted(set(f['properties']['hole'] for f in features if f['properties']['kind']=='tee' and f['properties']['hole'])),'sourceTraceCount':len(traces['traces']),'unchangedOsmRings':sum(f['properties']['method']=='unchanged-osm-source-ring' for f in features),'independentHumanReview':False,'independentControlApproved':False,'limitations':['2019 winter/dormant-season imagery has low-contrast maintained boundaries; interpretation uncertainty is separate from unmeasured registration error.','OSM geometry retains original rings, revision dates and unknown measurement epoch.','No tee-color associations or pin positions were inferred.','Known2024-2026 course changes and newer imagery need separate review; these polygons are provisional.']}
(OUT/'playing-surfaces-review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
report['inputs']=[{'path':str(p.relative_to(ROOT)).replace('\\','/'),'sha256':sha256(p.read_bytes()).hexdigest()} for p in [osm_path,trace_path,extra_trace_path,refinement_path,world_path,Path(__file__)]]
report['excludedOsmFeatures']=traces.get('excludedOsmFeatures',{})
report['holesWithAssociatedFairway']=sorted(set(f['properties']['hole'] for f in features if f['properties']['kind']=='fairway' and f['properties']['hole']))
report['outputPrecisionMetres']=OUTPUT_PRECISION_METRES
report['validation']={'closedFinitePolygonRings':True,'uniqueFeatureIds':True,'allPolygonsValid':True,'positiveAreaGreaterThanOneSquareMetre':True,'oneAssociatedGreenPerHole':True,'physicalTeePlatformAssociatedEveryHole':True,'fairwayForEveryPar4AndPar5':set(report['holesWithAssociatedFairway'])=={2,4,5,7,8,10,12,13,14,15,17,18},'independentRegistrationAccuracy':None}
report['additionalInspectionsNotAdopted']=extra_traces['unadoptedInspections']+refinements['unadoptedInspections']
report['output']={'path':'lidingobuild/mapping/playing-surfaces.geojson','sha256':sha256((OUT/'playing-surfaces.geojson').read_bytes()).hexdigest()}
report['limitations'].extend(['The two unassociated OSM greens and one unassociated tee remain supplementary features with no asserted playing-hole role.','Hole10 rear tee differs substantially in the newer undated summer view; its 2019 physical pad is retained explicitly as historical and provisional.','Visible greenside and fairway bunkers were added where the 2019 source supports complete rings; bunker inventory and all physical tee platforms are still incomplete.','Hole13 retains its central maintained fairway patch; an attempted western fragment was rejected after overlay review because its lower edge included indistinct rough. Hole16 has no adopted fairway polygon because its par3 approach edge is ambiguous.'])
_built={f['id']:f for f in features}
report['newerCaptureAdditions']=({'sourceCapture':additions['sourceCapture'],'rule':additions['rule'],
  'adopted':[{'id':f['id'],'kind':f['kind'],'hole':f['hole'],'datingVerdict':f['datingVerdict'],
              'clubRecord':f['clubRecord'],
              'maskAreaSquareMetres':f['areaSquareMetres'],
              'polygonAreaSquareMetres':_built[f['id']]['properties']['areaSquareMetres']}
             for f in additions['features']],
  'note':'rings measured on a capture NEWER than the 2019 pixel traces and carried in EPSG:3006; '
         'adopted only where a club document dates the work and the older captures show the ground without it'}
  if additions else None)
report['teeDecks2025']=({'sourceCapture':decks['sourceCapture'],
  'adopted':[{'id':d['id'],'hole':d['cardCorroboration']['hole'],'tee':d['cardCorroboration']['tee'],
              'cardMetres':d['cardCorroboration']['cardMetres'],
              'cardResidualMetres':d['cardCorroboration']['residualMetres'],
              'edgeStepMetres':d['edgeStepMetres'],
              'polygonAreaSquareMetres':_built[d['id']]['properties']['areaSquareMetres']}
             for d in adopted_decks],
  'notAdopted':{k:v for k,v in decks['adoptionSummary'].items() if not k.startswith(TWO_RECORD_DECK)},
  'note':'only decks whose measured platform AND card distance agree are adopted; the rest stay in '
         'tee-deck-2025.json as measured platforms with one record'}
  if decks else None)
report['refinementRound']={'previousOutputSha256':refinements['previousOutputSha256'],'newTraceCount':len(refinements['traces']),'rejectedTraceIds':[t['id'] for t in refinements.get('rejectedTraces',[])],'osmBunkerAssociations':refinements['osmBunkerHoleAssociations'],'sourceGeometryEpoch':2019,'laterMowingOrBunkerChangesAdopted':bool(additions and additions['features'])}
(OUT/'playing-surfaces-review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({k:report[k] for k in ['counts','holesWithGreen','holesWithAssociatedTee','sourceTraceCount']}))

# Apply dated, exact-original-guarded reviews after compiling the historical
# intake. A full cache rebuild must not restore superseded putting cuts.
import subprocess
import sys
subprocess.run([sys.executable, str(OUT / 'apply-putting-cuts.py')], check=True)
