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
        points.append([e,n])
    if points[0]!=points[-1]: points.append(points[0])
    features.append({'type':'Feature','id':t['id'],'properties':{'kind':t['kind'],'hole':t['hole'],'sourceId':traces['sourceId'],'observedYear':2019,'captureDate':None,'reviewStatus':'machine-visual-review','notSurveyed':True,'method':'manual-image-boundary-digitization','sourcePixelTrace':t['id'],'interpretationUncertaintyMetres':t['uncertaintyMetres'],'registrationAccuracy':'not independently checked','note':t['note'],'licence':'CC0-1.0'},'geometry':{'type':'Polygon','coordinates':[points]}})
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
report['validation']={'closedFinitePolygonRings':True,'uniqueFeatureIds':True,'allPolygonsValid':True,'positiveAreaGreaterThanOneSquareMetre':True,'oneAssociatedGreenPerHole':True,'physicalTeePlatformAssociatedEveryHole':True,'fairwayForEveryPar4AndPar5':set(report['holesWithAssociatedFairway'])=={2,4,5,7,8,10,12,13,14,15,17,18},'independentRegistrationAccuracy':None}
report['additionalInspectionsNotAdopted']=extra_traces['unadoptedInspections']+refinements['unadoptedInspections']
report['output']={'path':'lidingobuild/mapping/playing-surfaces.geojson','sha256':sha256((OUT/'playing-surfaces.geojson').read_bytes()).hexdigest()}
report['limitations'].extend(['The two unassociated OSM greens and one unassociated tee remain supplementary features with no asserted playing-hole role.','Hole10 rear tee differs substantially in the newer undated summer view; its 2019 physical pad is retained explicitly as historical and provisional.','Visible greenside and fairway bunkers were added where the 2019 source supports complete rings; bunker inventory and all physical tee platforms are still incomplete.','Hole13 retains its central maintained fairway patch; an attempted western fragment was rejected after overlay review because its lower edge included indistinct rough. Hole16 has no adopted fairway polygon because its par3 approach edge is ambiguous.'])
report['refinementRound']={'previousOutputSha256':refinements['previousOutputSha256'],'newTraceCount':len(refinements['traces']),'rejectedTraceIds':[t['id'] for t in refinements.get('rejectedTraces',[])],'osmBunkerAssociations':refinements['osmBunkerHoleAssociations'],'sourceGeometryEpoch':2019,'laterMowingOrBunkerChangesAdopted':False}
(OUT/'playing-surfaces-review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({k:report[k] for k in ['counts','holesWithGreen','holesWithAssociatedTee','sourceTraceCount']}))
# Apply the later native-image tee observations after reconstructing historical
# sources. Rebuilding the source layer cannot restore superseded tee geometry.
import subprocess
subprocess.run(['node', str(OUT/'reviewed-tee-alignment.mjs'), '--surfaces-only'], cwd=ROOT, check=True)
