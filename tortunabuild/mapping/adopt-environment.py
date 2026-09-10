"""Retain mapped surroundings and reviewed paths without making new terrain.

Clip to the acquired terrain explicitly, preserve polygon holes by exact
partitioning, and leave tunnel/bridge decks with unknown heights unresolved.
"""
import hashlib
import importlib.util
import json
from collections import Counter
from pathlib import Path
import xml.etree.ElementTree as ET

from pyproj import Transformer
from shapely.geometry import LineString, Point, Polygon, box, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
OUT = 'tortunabuild/mapping/environment.geojson'
CONTEXT = 'geo_data/course-v2/tortuna/reference/osm-context-epsg3006.geojson'
EXTRA_CONTEXT = 'tortunabuild/mapping/environment-context-extra.geojson'
EXTRA_REVIEW = 'tortunabuild/mapping/environment-context-extra-review.json'
OBSERVATIONS = 'tortunabuild/mapping/environment-observations.json'
EXTENT = box(595352.5, 6612851.5, 599448.5, 6616947.5)


def read(p):
    return json.loads((ROOT / p).read_text(encoding='utf8'))


def identity(p):
    return {'path': p, 'sha256': hashlib.sha256((ROOT / p).read_bytes()).hexdigest()}


def write(p, value):
    (ROOT / p).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8', newline='\n')


def parts(g, kind):
    if g.is_empty:
        return []
    if g.geom_type == kind:
        return [g]
    return [p for child in getattr(g, 'geoms', []) for p in parts(child, kind)]


def main():
    spec = importlib.util.spec_from_file_location('water_partition', ROOT / 'geo_data/course-v2/visby/vegetation/decompose-water.py')
    partition = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(partition)
    features, omitted, topology = [], [], []
    source = read(CONTEXT)
    extra = read(EXTRA_CONTEXT)
    extra_review = read(EXTRA_REVIEW)
    if extra_review['output']['path'] != EXTRA_CONTEXT:
        raise ValueError('Supplementary context review names a different output')
    for record in [extra_review['output'], extra_review['sourceReceipt']]:
        if identity(record['path'])['sha256'] != record['sha256']:
            raise ValueError(f"Changed supplementary context evidence: {record['path']}")
    for record in extra.get('inputs', []):
        if identity(record['path'])['sha256'] != record['sha256']:
            raise ValueError(f"Changed supplementary context source: {record['path']}")
    all_features = source['features'] + extra['features']
    if len({f['id'] for f in all_features}) != len(all_features):
        raise ValueError('Supplementary context repeats original source features')

    def adopt(fid, geometry, properties):
        if not geometry.is_valid:
            raise ValueError(f'Invalid source {fid}')
        clipped = geometry.intersection(EXTENT)
        clipped_boundary = properties.get('clippedToMeasuredTerrain', properties.get('clippedToNativeDTM', False)) or not geometry.equals(clipped)
        expected_type = 'Polygon' if geometry.geom_type in ['Polygon', 'MultiPolygon'] else 'LineString' if geometry.geom_type in ['LineString', 'MultiLineString'] else 'Point'
        pieces = parts(clipped, expected_type)
        if expected_type == 'Polygon':
            pieces = [child for p in pieces for child in partition.decompose(p)[0]]
            if pieces:
                difference = unary_union(pieces).symmetric_difference(clipped).area
                if difference > 1e-5:
                    raise ValueError(f'Polygon topology changed for {fid}')
                topology.append({'sourceFeatureId': fid, 'pieces': len(pieces), 'areaDifferenceSquareMetres': difference})
        for index, piece in enumerate(pieces):
            if expected_type == 'LineString' and piece.length < 0.1:
                continue
            if expected_type == 'Polygon' and piece.area < 1:
                continue
            features.append({'type': 'Feature', 'id': fid if len(pieces) == 1 else f'{fid}/part-{index+1}',
                             'properties': {**properties, 'sourceFeatureId': fid,
                                            'clippedToMeasuredTerrain': clipped_boundary,
                                            'clippedBoundaryIsPhysicalEdge': False},
                             'geometry': mapping(piece)})

    for f in all_features:
        t, g = f['properties']['tags'], shape(f['geometry'])
        props = {**f['properties'], 'reviewStatus': 'supplementary-source; current geometry not independently surveyed'}
        if t.get('landuse') in ['farmland', 'farmyard', 'residential', 'industrial', 'commercial', 'meadow', 'grass', 'allotments']:
            adopt(f['id'], g, {**props, 'kind': 'landuse', 'landuse': t['landuse'],
                              'appearanceStatus': 'generic seasonal colour; crop type and grass height unknown'})
        if t.get('highway'):
            if t.get('tunnel') in ['yes', 'culvert'] or t.get('bridge') == 'yes' or t['highway'] in ['construction', 'proposed', 'platform']:
                omitted.append({'id': f['id'], 'reason': 'covered/noncurrent route or bridge deck without verified elevation'}); continue
            group = 'paths' if t['highway'] in ['path', 'footway', 'cycleway', 'steps', 'pedestrian'] else 'tracks' if t['highway'] in ['track', 'service'] else 'roads'
            width = float(t['width'].removesuffix(' m')) if t.get('width') else (2 if group == 'paths' else 3.5 if group == 'tracks' else 6)
            adopt(f['id'], g, {**props, 'kind': 'path', 'network': group, 'highway': t['highway'],
                              'surface': t.get('surface', 'unknown'), 'widthMetres': width,
                              'widthStatus': 'OSM-width-tag-unverified' if t.get('width') else 'generic display width; not measured'})
        if t.get('waterway'):
            if t.get('tunnel') in ['yes', 'culvert'] or t.get('covered') == 'yes':
                omitted.append({'id': f['id'], 'reason': 'covered watercourse; no open channel inferred'}); continue
            adopt(f['id'], g, {**props, 'kind': 'watercourse', 'waterway': t['waterway'],
                              'widthMetres': 2 if t['waterway'] == 'ditch' else 4,
                              'widthStatus': 'generic context band; channel banks not surveyed',
                              'waterSurfaceStatus': 'unknown; retains centreline only; no new water plane or carve'})
        if t.get('railway') == 'rail' or t.get('power') in ['line', 'minor_line']:
            if t.get('bridge') not in [None, 'no'] or t.get('tunnel') not in [None, 'no']:
                omitted.append({'id': f['id'], 'reason': 'bridge/tunnel elevation and deck not verified'})
            else:
                adopt(f['id'], g, {**props, 'kind': 'railway' if t.get('railway') == 'rail' else 'power_line', 'inferMasts': False})
        if t.get('power') in ['tower', 'pole'] and g.geom_type == 'Point':
            adopt(f['id'], g, {**props, 'kind': 'power_support', 'supportKind': t['power'],
                              'dimensionStatus': 'generic rendering estimate, not measured'})

    # The first intake kept way context only; recover explicit railway/support
    # records from the same dated XML without contributor/contact metadata.
    raw_path = 'tortunabuild/cache/reference/osm.xml'
    raw_identity = identity(raw_path)
    if raw_identity['sha256'] != read('geo_data/course-v2/tortuna/acquisition/osm-context.json')['sourceSha256']:
        raise ValueError('Retained OSM source differs from acquisition receipt')
    raw = ET.fromstring((ROOT/raw_path).read_bytes())
    transform = Transformer.from_crs(4326, 3006, always_xy=True)
    nodes = {n.attrib['id']: transform.transform(float(n.attrib['lon']), float(n.attrib['lat'])) for n in raw.findall('node')}
    allowed = {'railway', 'bridge', 'tunnel', 'layer', 'service', 'electrified', 'power', 'voltage', 'cables', 'wires', 'height'}
    for element in raw:
        tags = {t.attrib['k']: t.attrib['v'] for t in element.findall('tag') if t.attrib['k'] in allowed}
        fid = f"{element.tag}/{element.attrib['id']}" if 'id' in element.attrib else ''
        props = {'sourceId': 'tortuna-osm-2026-09-09', 'sourceSha256': raw_identity['sha256'],
                 'sourceTimestamp': element.get('timestamp'), 'tags': tags,
                 'reviewStatus': 'explicit mapped feature; dimensions/currentness unverified'}
        if element.tag == 'way' and (tags.get('railway') == 'rail' or tags.get('power') == 'line'):
            ids = [n.attrib['ref'] for n in element.findall('nd')]
            if len(ids) < 2 or any(i not in nodes for i in ids):
                omitted.append({'id': fid, 'reason': 'incomplete source nodes'}); continue
            if tags.get('bridge') == 'yes' or tags.get('tunnel') == 'yes':
                omitted.append({'id': fid, 'reason': 'bridge/tunnel elevation and deck not verified'}); continue
            adopt(fid, LineString([nodes[i] for i in ids]), {**props, 'kind': 'railway' if tags.get('railway') == 'rail' else 'power_line', 'inferMasts': False})
        if element.tag == 'node' and tags.get('power') in ['tower', 'pole']:
            adopt(fid, Point(nodes[element.attrib['id']]), {**props, 'kind': 'power_support', 'supportKind': tags['power'],
                  'dimensionStatus': 'generic rendering estimate, not measured'})

    observations = read(OBSERVATIONS)
    receipt = read(observations['sourceReceipt'])
    windows = {w['id']: w for w in receipt['windows']}
    for o in observations['features']:
        grid = observations['grids'][o['grid']]
        w, s, e, n = grid['boundsEpsg3006']
        xy = [[w+x*(e-w)/grid['width'], n-y*(n-s)/grid['height']] for x,y in o['pixels']]
        g = Polygon(xy) if o['geometryType'] == 'Polygon' else LineString(xy)
        props = {k:v for k,v in o.items() if k not in ['id','pixels','geometryType']}
        props.update(sourceId='imagery-lm-ortho', observedOn=observations['observedOn'], sourceCapture='2026-05-02',
                     pixelTrace=o['pixels'], pixelGrid=grid,
                     sourceWindows=[{'id': i, 'sha256': windows[i]['sha256']} for i in grid['sourceWindows']],
                     reviewStatus=observations['reviewStatus'], network='paths' if o['kind']=='path' else None,
                     widthStatus='visual full-width interpretation; independent measurement pending')
        adopt(o['id'], g, props)
    if len({f['id'] for f in features}) != len(features):
        raise ValueError('Duplicate environment feature IDs')
    for f in features:
        if not EXTENT.covers(shape(f['geometry'])):
            raise ValueError(f"Environment leaves native terrain: {f['id']}")
    write(OUT, {'type': 'FeatureCollection', 'crs': {'type':'name','properties':{'name':'EPSG:3006'}},
                'axisOrder':['easting','northing'], 'status':'provisional-source-derived-environment',
                'inputs':[identity(CONTEXT), identity(EXTRA_CONTEXT), identity(EXTRA_REVIEW), extra_review['sourceReceipt'], identity(OBSERVATIONS), identity(observations['sourceReceipt']),
                          identity('geo_data/course-v2/tortuna/acquisition/osm-context.json')], 'features':features})
    report = {'schemaVersion':1, 'groundId':'tortuna', 'output':identity(OUT),
              'rawSource':raw_identity, 'counts':dict(Counter(f['properties']['kind'] for f in features)),
              'pathNetworks':dict(Counter(f['properties'].get('network') for f in features if f['properties']['kind']=='path')),
              'polygonTopology':topology, 'omitted':omitted,
              'limitations':['Widths and seasonal materials remain estimates unless explicitly observed/tagged.',
                             'Watercourses are source centrelines, not measured banks or water levels.',
                             'Railway masts, covered routes and bridge elevations are not inferred.',
                             'Harvested ground changes floor appearance only; remaining canopy is retained.']}
    write('tortunabuild/mapping/environment-review.json', report)
    print(json.dumps({k:report[k] for k in ['counts','pathNetworks']}))


if __name__ == '__main__':
    main()
