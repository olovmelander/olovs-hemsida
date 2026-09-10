"""Acquire/project the bounded extra Tortuna surroundings; preserve source truth.

Default is offline from retained XML. --acquire downloads only when the private
cache is missing. All original XML element IDs are excluded, including IDs not
previously emitted as normalized features. No contacts or contributor metadata
are retained in the derived collection. Buildings are never boundary-clipped.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

from pyproj import Transformer, __proj_version__
from shapely.geometry import LineString, Point, Polygon, box, mapping
from shapely.ops import polygonize_full, transform as transform_geometry, unary_union

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / 'tortunabuild/cache/reference/osm-context-extra.xml'
DOWNLOAD = RAW.with_name('osm-context-extra-download.json')
BASE_RAW = ROOT / 'tortunabuild/cache/reference/osm.xml'
BASE_RECEIPT = ROOT / 'geo_data/course-v2/tortuna/acquisition/osm-context.json'
OUTPUT = ROOT / 'tortunabuild/mapping/environment-context-extra.geojson'
RECEIPT = ROOT / 'geo_data/course-v2/tortuna/acquisition/osm-context-extra.json'
REVIEW = ROOT / 'tortunabuild/mapping/environment-context-extra-review.json'
SOURCE_ID = 'tortuna-osm-environment-2026-09-09'
BBOX = [16.703, 59.645, 16.754, 59.676]
URL = 'https://api.openstreetmap.org/api/0.6/map?bbox=' + ','.join(map(str, BBOX))
NATIVE_BOUNDS = [595352.5, 6612851.5, 599448.5, 6616947.5]
TARGET_BOUNDS = [596120.5, 6613363.5, 598680.5, 6616435.5]
EXTENT = box(*NATIVE_BOUNDS)
TARGET = box(*TARGET_BOUNDS)
ALLOWED = {'name','building','building:levels','building:part','height','min_height',
           'landuse','natural','highway','surface','width','waterway','water',
           'wetland','bridge','tunnel','covered','layer','railway','service',
           'electrified','gauge','power','voltage','cables','wires','barrier',
           'amenity','leisure','area','type'}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def identity(path):
    return dict(path=path.relative_to(ROOT).as_posix(), sha256=sha(path))


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n',encoding='utf8',newline='\n')


def tags(element):
    return {t.get('k'):t.get('v') for t in element.findall('tag') if t.get('k') in ALLOWED}


def fid(element):
    return element.tag + '/' + element.get('id')


def useful(t):
    return any(k in t for k in ['building','landuse','natural','highway','waterway','water','railway','power'])


def category(t):
    if t.get('building'): return 'building'
    if t.get('landuse') == 'forest' or t.get('natural') == 'wood': return 'forest'
    if t.get('landuse'): return 'landuse'
    if t.get('highway'): return 'highway'
    if t.get('waterway'): return 'waterway'
    if t.get('railway'): return 'railway'
    if t.get('power'): return 'power'
    return 'natural'


def parts(geometry, allowed_types):
    if geometry.is_empty: return []
    if geometry.geom_type in allowed_types: return [geometry]
    return [part for child in getattr(geometry, 'geoms', []) for part in parts(child, allowed_types)]


def acquire():
    RAW.parent.mkdir(parents=True, exist_ok=True)
    with urlopen(Request(URL,headers={'User-Agent':'TortunaCourseSourceIntake/1.0 (bounded read-only local GIS intake)',
                                      'Accept':'application/xml'}),timeout=60) as response:
        raw = response.read(25_000_001)
        if len(raw)>25_000_000 or ET.fromstring(raw).tag != 'osm':
            raise ValueError('Unexpected or oversized bounded OSM response')
        RAW.write_bytes(raw)
        write(DOWNLOAD,dict(url=URL,file=RAW.relative_to(ROOT).as_posix(),bytes=len(raw),sha256=sha(RAW),
            acquiredAt=datetime.now(timezone.utc).isoformat(),responseDate=response.headers.get('Date'),
            etag=response.headers.get('ETag'),lastModified=response.headers.get('Last-Modified')))


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--acquire',action='store_true',help='Acquire bounded XML only if private cache is missing')
    args=parser.parse_args()
    if not RAW.exists() and args.acquire: acquire()
    download=json.loads(DOWNLOAD.read_text(encoding='utf8'))
    if download['url'] != URL or download['sha256'] != sha(RAW) or download['bytes'] != RAW.stat().st_size:
        raise ValueError('Extra acquisition cache differs from retained receipt')
    baseline_receipt=json.loads(BASE_RECEIPT.read_text(encoding='utf8'))
    if baseline_receipt['sourceSha256'] != sha(BASE_RAW):
        raise ValueError('Original raw XML changed; cannot establish ID exclusion set')
    old=ET.parse(BASE_RAW).getroot()
    excluded_ids={fid(e) for e in old if e.get('id')}
    source=ET.parse(RAW).getroot()
    nodes={e.get('id'):[float(e.get('lon')),float(e.get('lat'))] for e in source.findall('node')}
    ways={e.get('id'):e for e in source.findall('way')}
    trans=Transformer.from_crs(4326,3006,always_xy=True)
    inverse=Transformer.from_crs(3006,4326,always_xy=True)
    skipped, withheld, features, topology=[],[],[],[]
    suppressed_members=set()
    relations=[]

    def coords(way):
        refs=[n.get('ref') for n in way.findall('nd')]
        return [nodes[i] for i in refs] if len(refs)>=2 and all(i in nodes for i in refs) else None

    def skip(element,reason):
        skipped.append(dict(id=fid(element),reason=reason))

    def add(element, geographic, properties, member_ids=None):
        feature_id=fid(element)
        projected=transform_geometry(trans.transform,geographic)
        if projected.is_empty or not projected.is_valid:
            skip(element,'empty-or-invalid-source-geometry'); return False
        if not projected.intersects(EXTENT):
            skip(element,'outside-native-DTM'); return False
        is_building=bool(properties.get('building'))
        if is_building and projected.geom_type not in ['Polygon','MultiPolygon']:
            skip(element,'building-without-complete-polygon-footprint'); return False
        if is_building and not EXTENT.covers(projected):
            skipped.append(dict(id=feature_id,reason='complete-building-crosses-DTM-edge; footprint-not-clipped',
                sourceBoundsEpsg3006=list(projected.bounds))); return False
        clipped=projected if is_building else projected.intersection(EXTENT)
        if projected.geom_type in ['Polygon','MultiPolygon']:
            children=parts(clipped, {'Polygon'})
            clipped=unary_union(children)
            if clipped.is_empty or clipped.area<1:
                skip(element,'no-polygon-area-inside-DTM'); return False
        elif projected.geom_type in ['LineString','MultiLineString']:
            children=parts(clipped, {'LineString'})
            clipped=unary_union(children)
            if clipped.is_empty or clipped.length<.1:
                skip(element,'no-line-length-inside-DTM'); return False
        changed=not clipped.equals(projected)
        source_polygons=parts(projected,{'Polygon'})
        clipped_polygons=parts(clipped,{'Polygon'})
        if source_polygons:
            difference=clipped.symmetric_difference(projected.intersection(EXTENT)).area
            if difference>1e-7: raise ValueError('Clip changed source topology')
            topology.append(dict(id=feature_id,sourceHoles=sum(len(p.interiors) for p in source_polygons),
                outputHoles=sum(len(p.interiors) for p in clipped_polygons),
                sourceAreaSquareMetres=projected.area,outputAreaSquareMetres=clipped.area,
                intersectionDifferenceSquareMetres=difference))
        features.append(dict(type='Feature',id=feature_id,properties=dict(
            sourceId=SOURCE_ID,sourceSha256=download['sha256'],sourceElementId=feature_id,
            sourceTimestamp=element.get('timestamp'),sourceVersion=int(element.get('version','0')),
            status='supplementary-map-reference-not-surveyed',tags=properties,
            sourceCrs='OGC:CRS84',sourceGeometryWgs84=mapping(geographic),
            sourceBoundsEpsg3006=list(projected.bounds),sourceMemberIds=member_ids or [],
            clippedToNativeDTM=changed,clippedBoundaryIsPhysicalEdge=False,
            clipBoundsEpsg3006=NATIVE_BOUNDS,buildingFootprintPreserved=is_building,
            horizontalAccuracyStatus='OSM-source accuracy unspecified; no orthophoto or field approval',
            intersectsTargetEnvironment=clipped.intersects(TARGET)),geometry=mapping(clipped)))
        return True

    # Adopt complete physical multipolygons before member ways; never fill holes.
    for relation in source.findall('relation'):
        t=tags(relation)
        if fid(relation) in excluded_ids or t.get('type')!='multipolygon' or not useful(t): continue
        by_role={'outer':[],'inner':[]}; members=[]; complete=True
        for member in relation.findall('member'):
            role=member.get('role') or 'outer'
            if member.get('type')!='way' or role not in by_role:
                complete=False;break
            way=ways.get(member.get('ref'))
            points=coords(way) if way is not None else None
            if not points: complete=False;break
            by_role[role].append(LineString(points));members.append('way/'+member.get('ref'))
        if not complete or not by_role['outer']:
            skip(relation,'incomplete-or-unsupported-multipolygon-members');continue
        rings={}
        for role,lines in by_role.items():
            if not lines: rings[role]=Polygon();continue
            polys,cuts,dangles,invalid=polygonize_full(lines)
            if any(not g.is_empty for g in [cuts,dangles,invalid]): complete=False;break
            rings[role]=unary_union(polys)
        if not complete:
            skip(relation,'unclosed-or-invalid-multipolygon-members');continue
        if not rings['inner'].is_empty and not rings['outer'].covers(rings['inner']):
            skip(relation,'inner-rings-outside-outer');continue
        geometry=rings['outer'].difference(rings['inner'])
        if add(relation,geometry,t,members):
            suppressed_members.update(members)
            withheld.extend(dict(id=i,reason='represented-by-complete-multipolygon',relationId=fid(relation)) for i in members)

    for way in ways.values():
        feature_id=fid(way);t=tags(way)
        if feature_id in excluded_ids or feature_id in suppressed_members or not useful(t):continue
        points=coords(way)
        if not points:
            skip(way,'incomplete-source-nodes');continue
        is_area=(points[0]==points[-1] and len(points)>=4 and t.get('area')!='no' and
                 any(k in t for k in ['building','landuse','natural','water']))
        geographic=Polygon(points) if is_area else LineString(points)
        add(way,geographic,t)
    for node in source.findall('node'):
        t=tags(node)
        if fid(node) in excluded_ids:continue
        if t.get('power') not in ['tower','pole'] and t.get('railway') not in ['signal','level_crossing','buffer_stop','milestone']:continue
        add(node,Point(nodes[node.get('id')]),t)
    features.sort(key=lambda f:(f['id'].split('/')[0],int(f['id'].split('/')[1])))
    final_ids={f['id'] for f in features}
    if len(final_ids)!=len(features) or final_ids.intersection(excluded_ids):
        raise ValueError('Duplicate/original raw element ID emitted')
    counts=Counter(category(f['properties']['tags']) for f in features)
    tag_counts=Counter(f"{k}={v}" for f in features for k,v in f['properties']['tags'].items()
                      if k in ['building','landuse','natural','highway','waterway','railway','power'])
    collection=dict(type='FeatureCollection',name='Tortuna additional bounded environment context',
        crs=dict(type='name',properties=dict(name='EPSG:3006')),axisOrder=['easting','northing'],
        sourceId=SOURCE_ID,attribution='© OpenStreetMap contributors',licence='ODbL-1.0',features=features)
    write(OUTPUT,collection)
    target_wgs=transform_geometry(inverse.transform,TARGET)
    coverage=box(*BBOX)
    original_bounds=old.find('bounds').attrib
    previous_bbox=[float(original_bounds[k]) for k in ['minlon','minlat','maxlon','maxlat']]
    original_coverage=transform_geometry(trans.transform,box(*previous_bbox))
    report=dict(schemaVersion=1,groundId='tortuna',sourceId=SOURCE_ID,sourceUrl=URL,
        acquiredAt=download['acquiredAt'],sourceBytes=download['bytes'],sourceSha256=download['sha256'],
        sourcePath=RAW.relative_to(ROOT).as_posix(),sourceCrs='OGC:CRS84',horizontalCrs='EPSG:3006',
        queryBoundsWgs84=BBOX,targetBoundsEpsg3006=TARGET_BOUNDS,nativeBoundsEpsg3006=NATIVE_BOUNDS,
        requestedTargetAreaSquareMetres=TARGET.area,queryEnvelopeCoversTarget=coverage.covers(target_wgs),
        previousQueryBoundsWgs84=previous_bbox,previousTargetAreaCoveredSquareMetres=original_coverage.intersection(TARGET).area,
        rawCounts={k:len(source.findall(k)) for k in ['node','way','relation']},
        transform=dict(engine='pyproj/PROJ',projVersion=__proj_version__,alwaysXY=True),
        baselineRaw=identity(BASE_RAW),excludedOriginalElementIdCount=len(excluded_ids),
        originalIdOverlapCount=len(final_ids.intersection(excluded_ids)),
        outputPath=OUTPUT.relative_to(ROOT).as_posix(),outputSha256=sha(OUTPUT),featureCounts=dict(counts),
        geometryCounts=dict(Counter(f['geometry']['type'] for f in features)),tagCounts=dict(tag_counts),
        clippedFeatureCount=sum(f['properties']['clippedToNativeDTM'] for f in features),
        intersectsTargetFeatureCount=sum(f['properties']['intersectsTargetEnvironment'] for f in features),
        licence='ODbL-1.0',licenceUrl='https://www.openstreetmap.org/copyright',attribution='© OpenStreetMap contributors',
        privacy='Contact tags, user IDs, usernames, changesets and contributor identities excluded from derived data.',
        withheldMultipolygonMembers=withheld,skipped=skipped,
        limitations=['Query envelope covers target; OSM completeness is not guaranteed. Bounding-box API can miss ways with no node inside the query.',
            'Elements matching any ID in the original retained XML are excluded, even if the previous importer omitted that element.',
            'Database edit timestamps do not establish imagery date, field condition, or geometric accuracy.',
            'Complete source WGS84 geometry is retained as provenance. Only projected non-building features can clip to the native DTM rectangle.',
            'Open routes and waterways remain centrelines; no widths, water levels, bridge decks, tree stems or building heights are invented.',
            'Forest/wood polygons are mapped land cover, not measured canopy or automatic tree-placement permission.'])
    write(RECEIPT,report)
    write(REVIEW,dict(schemaVersion=1,groundId='tortuna',output=identity(OUTPUT),sourceReceipt=identity(RECEIPT),
        counts=dict(counts),featureCount=len(features),polygonTopology=topology,
        validation=dict(allGeometriesValid=True,allWithinNativeDTM=True,originalOsmIdsExcluded=True,
            completeBuildingsOnly=True,noBuildingClipping=True,polygonHolesRetained=True,
            completeMultipolygonMemberWaysWithheld=True,sourceCoordinatesRetained=True,
            sourceHashesVerified=True,contactsAndContributorIdentitiesOmitted=True),
        reviewStatus='automated source/topology review; current orthophoto/field accuracy not approved',
        withheldMultipolygonMembers=withheld,omitted=skipped,limitations=report['limitations']))
    print(json.dumps(dict(features=len(features),counts=dict(counts),clipped=report['clippedFeatureCount'],
                         targetFeatures=report['intersectsTargetFeatureCount'],skipped=len(skipped))))


if __name__=='__main__': main()
