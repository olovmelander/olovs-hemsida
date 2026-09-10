"""Adopt the reviewed source vectors into a single projected course input.

GolfTraxx remains a routing reference; forward-only observations preserve its
back-camera reference. Card lengths never generate or stretch geometry.
"""
import hashlib
import importlib.util
import json
import math
import os
import tempfile
from collections import Counter
from copy import deepcopy
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import Point, Polygon, box, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
SURFACES = ['tortunabuild/mapping/surfaces-front9.geojson',
            'tortunabuild/mapping/surfaces-back9.geojson',
            'geo_data/course-v2/tortuna/mapping/hole-09-tee-review.geojson',
            'tortunabuild/mapping/surfaces-front9-fairways.geojson']
FACILITIES = 'tortunabuild/mapping/facilities.geojson'
CONTEXT = 'geo_data/course-v2/tortuna/reference/osm-context-epsg3006.geojson'
EXTRA_CONTEXT = 'tortunabuild/mapping/environment-context-extra.geojson'
EXTRA_CONTEXT_REVIEW = 'tortunabuild/mapping/environment-context-extra-review.json'
WATER = 'geo_data/course-v2/tortuna/mapping/water-runtime-epsg3006.geojson'
IMPROVEMENTS = [
    ('tortunabuild/mapping/improvements-front9.geojson', 'tortunabuild/mapping/improvements-front9-review.json'),
    ('tortunabuild/mapping/improvements-back9.geojson', 'tortunabuild/mapping/improvements-back9-review.json'),
]
ENVIRONMENT = 'tortunabuild/mapping/environment.geojson'
ENVIRONMENT_REVIEW = 'tortunabuild/mapping/environment-review.json'
BUILDING_OBSERVATIONS = 'tortunabuild/mapping/building-observations.json'
BUILDING_ROOFS = 'tortunabuild/mapping/building-roof-meshes.json'
ROOF_ENVELOPES = 'tortunabuild/mapping/building-roof-envelopes.geojson'
EXTENT = box(595352.5, 6612851.5, 599448.5, 6616947.5)


def read(p):
    return json.loads((ROOT/p).read_text(encoding='utf8'))


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)+'\n').encode('utf8')


def publish(outputs):
    """Validate and serialize the entire assembly before replacing any output."""
    payloads = {ROOT/p: encoded(value) for p, value in outputs.items()}
    staged = {}
    try:
        for target, payload in payloads.items():
            target.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as stream:
                stream.write(payload)
                staged[target] = Path(stream.name)
        for target, temporary in staged.items():
            os.replace(temporary, target)
    finally:
        for temporary in staged.values():
            temporary.unlink(missing_ok=True)


def ident(p):
    return {'path': p, 'sha256': hashlib.sha256((ROOT/p).read_bytes()).hexdigest()}


def verify_identity(record):
    raw = (ROOT/record['path']).read_bytes()
    key = 'sha256LfNormalized' if 'sha256LfNormalized' in record else 'sha256'
    if key == 'sha256LfNormalized':
        raw = raw.replace(b'\r\n', b'\n')
    if hashlib.sha256(raw).hexdigest() != record[key]:
        raise ValueError(f"Source identity changed: {record['path']}")


def feature_collection(path):
    data = read(path)
    if data.get('crs', {}).get('properties', {}).get('name') != 'EPSG:3006':
        raise ValueError(f'Unexpected source CRS: {path}')
    return data


def validate_playing_feature(feature):
    g, p = feature['geometry'], feature['properties']
    if (g['type'] != 'Polygon' or len(g['coordinates']) != 1
            or not shape(g).is_valid or shape(g).area <= 0
            or not EXTENT.covers(shape(g))
            or p.get('hole') not in range(1, 19)
            or p.get('kind') not in ['tee', 'green', 'bunker', 'fairway']):
        raise ValueError(f"Unsupported playing topology/identity: {feature['id']}")


def assemble_surfaces():
    """Apply the reviewed additions, replacements and removals as one changeset.

    Every removed ID must belong to an exact-byte pinned original source. All
    checks finish before returning a new collection; source objects are copied.
    """
    original, owners = {}, {}
    for path in SURFACES:
        for feature in feature_collection(path)['features']:
            fid = feature['id']
            if fid in original:
                raise ValueError(f'Duplicate playing-surface ID: {fid}')
            validate_playing_feature(feature)
            original[fid], owners[fid] = feature, path
    additions, removed, reports = [], set(), []
    for path, review_path in IMPROVEMENTS:
        review = read(review_path)
        output = review.get('geometry', {'path': review.get('outputPath'), 'sha256': review.get('outputSha256')})
        if output['path'] != path:
            raise ValueError('Improvement review names a different output')
        verify_identity(output)
        pins = review.get('baselineInputs', [review['originalFeatures']] if 'originalFeatures' in review else [])
        if not pins:
            raise ValueError('Improvement lacks pinned original sources')
        for pin in pins:
            if pin['path'] not in SURFACES:
                raise ValueError('Improvement pins an unrelated original source')
            verify_identity(pin)
        receipts = review.get('acquisitionReceipts', [review['sourceReceipt']] if 'sourceReceipt' in review else [])
        for receipt in receipts:
            verify_identity(receipt)
        guarded_paths = {pin['path'] for pin in pins}
        changed = feature_collection(path)['features']
        claimed, pure_additions = 0, 0

        def remove(fid, expected):
            if fid not in original or owners[fid] not in guarded_paths:
                raise ValueError(f'Improvement removal lacks a guarded original: {fid}')
            if fid in removed:
                raise ValueError(f'Improvement removes the same original twice: {fid}')
            if any(original[fid]['properties'][key] != expected[key] for key in ['hole', 'kind']):
                raise ValueError(f'Improvement changes original hole or surface identity: {fid}')
            removed.add(fid)

        for feature in changed:
            validate_playing_feature(feature)
            p = feature['properties']
            replaced = p.get('replacesFeatureIds')
            if not isinstance(replaced, list) or not all(isinstance(fid, str) for fid in replaced):
                raise ValueError('Improvement requires explicit replacesFeatureIds array')
            for fid in replaced:
                remove(fid, p)
            claimed += len(replaced)
            pure_additions += not replaced
            additions.append(feature)
        for removal in review.get('removals', []):
            remove(removal['featureId'], removal)
        if review.get('replacements') != claimed or review.get('additions') != pure_additions:
            raise ValueError('Improvement counts differ from the reviewed changeset')
        reports.append({'geometry': ident(path), 'review': ident(review_path),
                        'replacements': claimed, 'additions': pure_additions,
                        'removals': deepcopy(review.get('removals', [])), 'guardedOriginals': pins})
    result = [deepcopy(f) for fid, f in original.items() if fid not in removed] + deepcopy(additions)
    if len({f['id'] for f in result}) != len(result):
        raise ValueError('Improvement creates duplicate playing-surface IDs')
    for feature in result:
        feature['properties'].setdefault('sourceId', 'imagery-lm-ortho')
    return result, reports


def inside(feature):
    poly = shape(feature['geometry'])
    c = poly.centroid
    if not poly.contains(c):
        c = poly.representative_point()
    result = [round(c.x, 3), round(c.y, 3)]
    if not poly.covers(Point(result)):
        raise ValueError('Rounded display point leaves its observed polygon')
    return result


def choose_start(number, pads, historical_tee):
    eligible = pads if number == 9 else [f for f in pads if f['properties'].get('teeRole') != 'forward-observed-platform']
    nearest = min(eligible, key=lambda f: Point(historical_tee).distance(shape(f['geometry']))) if eligible else None
    return inside(nearest) if nearest else [round(v, 3) for v in historical_tee], eligible


def polygon(feature):
    return {**deepcopy(feature['properties']), 'ring': deepcopy(feature['geometry']['coordinates'][0]),
            'sourceFeatureId': feature['id']}


def polygon_parts(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == 'Polygon':
        return [geometry]
    return [p for child in getattr(geometry, 'geoms', []) for p in polygon_parts(child)]


def merge_small_partition_pieces(pieces):
    """Join artificial slivers to adjacent pieces without moving any boundary."""
    result = list(pieces)
    while True:
        small = [(i, p) for i, p in enumerate(result) if p.area < 1]
        if not small:
            return result
        merged = False
        for i, piece in small:
            candidates = sorted(((piece.boundary.intersection(other.boundary).length, j)
                                 for j, other in enumerate(result) if j != i), reverse=True)
            for shared, j in candidates:
                if shared <= 1e-8:
                    break
                combined = piece.union(result[j])
                if combined.geom_type == 'Polygon' and combined.is_valid and not combined.interiors:
                    result[j] = combined
                    result.pop(i)
                    merged = True
                    break
            if merged:
                break
        if not merged:
            raise ValueError('Isolated sub-square-metre land-cover piece requires explicit review')


def exclude_maintained_surfaces(feature, exclusions, partition):
    """Subtract exact maintained polygons and preserve the complete remainder."""
    original = shape(feature['geometry'])
    remainder = original.difference(exclusions)
    pieces = merge_small_partition_pieces([part for poly in polygon_parts(remainder) for part in partition(poly)[0]])
    combined = unary_union(pieces)
    difference = combined.symmetric_difference(remainder).area
    overlap = sum(p.area for p in pieces) - combined.area
    tolerance = max(1e-6, original.area*1e-10)
    if (difference > tolerance or abs(overlap) > tolerance
            or combined.intersection(exclusions).area > tolerance
            or any(not p.is_valid or p.interiors for p in pieces)):
        raise ValueError(f"Land-cover exclusion changed topology: {feature['id']}")
    records = []
    for index, part in enumerate(pieces, 1):
        records.append({**deepcopy(feature['properties']),
                        'id': feature['id'] if len(pieces) == 1 else f"{feature['id']}/maintained-exclusion-part-{index}",
                        'sourceFeatureId': feature['properties'].get('sourceFeatureId', feature['id']),
                        'environmentFeatureId': feature['id'], 'ring': [list(v) for v in part.exterior.coords],
                        'maintainedSurfaceExclusion': 'exact polygon difference; no buffers',
                        'partitionEdgesArePhysicalBoundaries': False})
    return records, {'sourceFeatureId': feature['id'], 'pieces': len(pieces),
                     'sourceAreaSquareMetres': original.area, 'excludedAreaSquareMetres': original.area-remainder.area,
                     'symmetricDifferenceSquareMetres': difference, 'overlapSquareMetres': overlap}


def assemble_environment(features, facilities, water, buildings):
    environment = feature_collection(ENVIRONMENT)
    output = read(ENVIRONMENT_REVIEW)['output']
    if output['path'] != ENVIRONMENT:
        raise ValueError('Environment review names a different output')
    verify_identity(output)
    for source in environment.get('inputs', []):
        verify_identity(source)
    spec = importlib.util.spec_from_file_location('water_partition', ROOT/'geo_data/course-v2/visby/vegetation/decompose-water.py')
    partition = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(partition)
    protected = unary_union([shape(f['geometry']) for f in features]
                            + [Polygon(f['rings'][0], f['rings'][1:]) for f in facilities]
                            + [Polygon(f['rings'][0], f['rings'][1:]) for f in water]
                            + [Polygon(b['ring']) for b in buildings])
    result = {k: [] for k in ['paths', 'landuse', 'clearfells', 'streams', 'railways', 'powerLines', 'powerSupports']}
    checks, omitted = [], []
    seen = set()
    for feature in environment['features']:
        fid, p, geometry = feature['id'], deepcopy(feature['properties']), feature['geometry']
        if fid in seen or not shape(geometry).is_valid or not EXTENT.covers(shape(geometry)):
            raise ValueError(f'Invalid environment feature: {fid}')
        seen.add(fid)
        kind, tags = p['kind'], p.get('tags', {})
        if kind in ['path', 'railway'] and (tags.get('bridge') not in [None, 'no'] or tags.get('tunnel') not in [None, 'no']):
            omitted.append({'id': fid, 'reason': 'Bridge/tunnel deck geometry and elevation unverified'})
            continue
        base = {**p, 'id': fid, 'sourceFeatureId': p.get('sourceFeatureId', fid)}
        if kind in ['landuse', 'clearfell']:
            records, check = exclude_maintained_surfaces(feature, protected, partition.decompose)
            checks.append(check)
            for record in records:
                if kind == 'landuse':
                    record['kind'] = p['landuse']
                else:
                    record['canopyExclusion'] = False
            result['landuse' if kind == 'landuse' else 'clearfells'].extend(records)
        elif kind in ['path', 'watercourse', 'railway', 'power_line']:
            if geometry['type'] != 'LineString':
                raise ValueError(f'Expected environment centreline: {fid}')
            base['line'] = deepcopy(geometry['coordinates'])
            if kind in ['path', 'watercourse']:
                if not isinstance(p.get('widthMetres'), (int, float)) or not math.isfinite(p['widthMetres']) or p['widthMetres'] <= 0:
                    raise ValueError(f'Invalid environment display width: {fid}')
            if kind == 'path':
                base.update(kind=p.get('highway', 'path'), material=p.get('material', p.get('surface', 'unknown')),
                            surface=p.get('surface', p.get('material', 'unknown')))
                if base.get('network') not in ['paths', 'tracks', 'roads']:
                    raise ValueError(f'Unknown path network: {fid}')
                result['paths'].append(base)
            elif kind == 'watercourse':
                base.update(kind=p.get('waterway', 'watercourse'), sourceKind='watercourse',
                            contextOnly=True, inferWaterSurface=False, inferChannelBanks=False)
                result['streams'].append(base)
            else:
                base['inferMasts'] = False
                if kind == 'power_line' and tags.get('voltage'):
                    base['voltage'] = tags['voltage']
                result['railways' if kind == 'railway' else 'powerLines'].append(base)
        elif kind == 'power_support':
            if geometry['type'] != 'Point' or p.get('supportKind') not in ['tower', 'pole']:
                raise ValueError(f'Invalid mapped power support: {fid}')
            base.update(c=deepcopy(geometry['coordinates']), kind=p['supportKind'])
            result['powerSupports'].append(base)
        else:
            raise ValueError(f'Unhandled environment kind: {kind}')
    return result, {'polygonExclusions': checks, 'omitted': omitted,
                    'counts': {key: len(value) for key, value in result.items()}}


def assemble_context(collections, partition):
    """Keep complete building footprints and clip land cover without filling holes."""
    buildings, vegetation = [], {k: [] for k in ['forest', 'wood', 'scrub', 'wetland', 'sand', 'rock']}
    seen, omitted, topology = set(), [], []
    for collection in collections:
        for feature in collection['features']:
            fid, properties = feature['id'], feature['properties']
            if fid in seen:
                raise ValueError(f'Duplicate surrounding source feature: {fid}')
            seen.add(fid)
            tags, geometry = properties.get('tags', {}), shape(feature['geometry'])
            building = tags.get('building') not in [None, 'no']
            kind = 'forest' if tags.get('landuse') == 'forest' else tags.get('natural')
            if not building and kind not in vegetation:
                continue
            if not geometry.is_valid or geometry.geom_type not in ['Polygon', 'MultiPolygon']:
                raise ValueError(f'Invalid surrounding polygon: {fid}')
            if building:
                if not EXTENT.covers(geometry) or geometry.geom_type != 'Polygon' or geometry.interiors or geometry.area < 1:
                    omitted.append({'id': fid, 'reason': 'Complete supported building footprint not available inside terrain'})
                    continue
                record = {'id': fid, 'ring': [list(v) for v in geometry.exterior.coords],
                          'sourceId': properties['sourceId'], 'heightMetres': 5,
                          'heightStatus': 'generic display estimate; not measured', 'name': tags.get('name')}
                if fid == 'way/1163533127':
                    record.update(amenity='clubhouse', name='Tortuna GK klubbhus', heightMetres=6.2,
                                  heightStatus='photograph-informed display estimate; not surveyed')
                buildings.append(record)
            if kind in vegetation:
                clipped = geometry.intersection(EXTENT)
                pieces = [part for polygon in polygon_parts(clipped) for part in partition(polygon)[0]]
                union = unary_union(pieces)
                difference = union.symmetric_difference(clipped).area
                overlap = sum(p.area for p in pieces) - union.area
                if difference > 1e-5 or abs(overlap) > 1e-5:
                    raise ValueError(f'Surrounding land-cover topology changed: {fid}')
                topology.append({'sourceFeatureId': fid, 'pieces': len(pieces),
                                 'clippedToMeasuredTerrain': properties.get('clippedToMeasuredTerrain', properties.get('clippedToNativeDTM', False)) or not geometry.equals(clipped),
                                 'symmetricDifferenceSquareMetres': difference, 'overlapSquareMetres': overlap})
                for index, piece in enumerate(pieces, 1):
                    if piece.area < 1:
                        omitted.append({'id': fid, 'part': index, 'reason': 'Below runtime minimum polygon area',
                                        'areaSquareMetres': piece.area})
                        continue
                    vegetation[kind].append({'ring': [list(v) for v in piece.exterior.coords],
                        'sourceId': properties['sourceId'], 'sourceFeatureId': fid,
                        'clippedToMeasuredTerrain': properties.get('clippedToMeasuredTerrain', properties.get('clippedToNativeDTM', False)) or not geometry.equals(clipped),
                        'clippedBoundaryIsPhysicalEdge': False, 'partitionEdgesArePhysicalBoundaries': False})
    return buildings, vegetation, {'omitted': omitted, 'landCoverTopology': topology,
                                  'buildings': len(buildings), 'vegetation': {k: len(v) for k, v in vegetation.items()}}


def attach_building_roofs(buildings):
    observations, roofs = read(BUILDING_OBSERVATIONS), read(BUILDING_ROOFS)
    if observations['groundFootprintReplacements'] or any(o['replacesGroundFootprint'] for o in observations['buildings']):
        raise ValueError('Building observations cannot silently replace original ground footprints')
    if roofs['horizontalCrs'] != 'EPSG:3006' or roofs['verticalCrs'] != 'EPSG:5613':
        raise ValueError('Roof mesh CRS differs from canonical source frame')
    for source in [*observations['inputs'], *roofs['inputs'], roofs['evidence']]:
        verify_identity(source)
    by_id = {building['id']: building for building in buildings}
    by_observation = {observation['id']: observation for observation in observations['buildings']}
    attached = set()
    for record in roofs['buildings']:
        fid = record['id']
        if fid not in by_id or fid in attached or record['groundFootprintReplaced']:
            raise ValueError(f'Roof mesh lacks an unchanged unique source building: {fid}')
        observation = by_observation[record['observationId']]
        if observation['associatedBuildingId'] != fid or record.get('parentBuildingId'):
            raise ValueError('Roof observation/building identity differs')
        mesh = record['mesh']
        vertices, indices = mesh['verticesEpsg3006RH2000'], mesh['triangleIndices']
        if (not vertices or not indices or len(indices) % 3
                or any(len(v) != 3 or not all(math.isfinite(x) for x in v) or not EXTENT.covers(Point(v[:2])) for v in vertices)
                or any(type(i) is not int or not 0 <= i < len(vertices) for i in indices)):
            raise ValueError(f'Invalid source roof mesh: {fid}')
        building = by_id[fid]
        if building['ring'] != observation['sourceFootprintGeometryEpsg3006']['coordinates'][0]:
            raise ValueError(f'Roof evidence pins a different original ground footprint: {fid}')
        attached.add(fid)
    exclusions = []
    for feature in feature_collection(ROOF_ENVELOPES)['features']:
        observation = by_observation.get(feature['id'])
        if (not observation or feature['geometry'] != observation['observedRoofGeometryEpsg3006']
                or feature['properties']['associatedBuildingId'] != observation['associatedBuildingId']
                or feature['geometry']['type'] != 'Polygon' or len(feature['geometry']['coordinates']) != 1
                or not shape(feature['geometry']).is_valid or not EXTENT.covers(shape(feature['geometry']))):
            raise ValueError(f"Roof vegetation envelope differs from original observation: {feature['id']}")
        exclusions.append({**deepcopy(feature['properties']), 'id': feature['id'],
                           'sourceFeatureId': feature['id'], 'ring': deepcopy(feature['geometry']['coordinates'][0]),
                           'groundFootprintReplaced': False, 'exclusionRole': 'vegetation-only-observed-roof-envelope'})
    if len(exclusions) != len(by_observation) or {e['id'] for e in exclusions} != set(by_observation):
        raise ValueError('Roof vegetation envelope coverage differs from source observations')
    return deepcopy(roofs['buildings']), exclusions, {
        'attachedBuildingIds': sorted(attached), 'withheld': deepcopy(roofs['withheld']),
        'vegetationExclusionEnvelopes': len(exclusions), 'groundFootprintsReplaced': False}


def main():
    card = read('tortunabuild/reference/scorecard.json')
    routes = read('tortunabuild/reference/routing-golftraxx.json')
    if len(card['holes']) != 18 or len(routes['holes']) != 18:
        raise ValueError('Tortuna requires exactly 18 card and routing records')
    projected = Transformer.from_crs(4326, 3006, always_xy=True)
    features, improvement_review = assemble_surfaces()
    playing_path = 'tortunabuild/mapping/playing-surfaces.geojson'
    playing = {
        'type': 'FeatureCollection', 'crs': {'type':'name','properties':{'name':'EPSG:3006'}},
        'axisOrder': ['easting','northing'], 'features': features,
        'status': 'provisional-orthophoto-interpretation-not-surveyed',
        'inputs': [ident(p) for p in [*SURFACES, *(p for pair in IMPROVEMENTS for p in pair)]],
        'improvements': improvement_review}

    holes = []
    decisions = []
    for c, route in zip(card['holes'], routes['holes']):
        n = c['number']
        if route['number'] != n:
            raise ValueError('Routing/card order differs')
        source_tee = list(projected.transform(*route['teeBack']))
        greens = [f for f in features if f['properties']['hole']==n and f['properties']['kind']=='green']
        pads = [f for f in features if f['properties']['hole']==n and f['properties']['kind']=='tee']
        if len(greens)!=1:
            raise ValueError(f'Hole{n} lacks exactly one observed green')
        green = greens[0]
        pin = inside(green)
        start, camera_pads = choose_start(n, pads, source_tee)
        if n == 9 and (not camera_pads or c['par']!=3 or Point(start).distance(Point(pin))>130):
            raise ValueError('Current short ninth must use its independently observed platform')
        line = [start]
        target = list(projected.transform(*route['teeTarget']))
        dx,dy = pin[0]-start[0],pin[1]-start[1]
        if dx*dx+dy*dy < 1:
            raise ValueError(f'Hole{n} routing has no distinct tee and green')
        along = ((target[0]-start[0])*dx+(target[1]-start[1])*dy)/(dx*dx+dy*dy)
        if c['par']>3 and .12<along<.90:
            line.append([round(v,3) for v in target])
        line.append(pin)
        references = []
        for length in c['teeLengths']:
            # Choose among observed platforms only, without creating a pad or
            # claiming current tee-colour associations from card length.
            if camera_pads:
                p = min(camera_pads, key=lambda f: abs(Point(inside(f)).distance(Point(pin))-length))
                references.append(inside(p))
            else:
                references.append(start)
        h = {**{k:c[k] for k in ['number','par','strokeIndex','teeLengths']}, 'strokeIndexStatus':'verified',
             'sourceFeatureId':f'tortuna-routing-{n:02}', 'line':line,'pin':pin,
             'green':polygon(green), 'teePlatforms':[polygon(f) for f in pads], 'teeReferences':references,
             'teeReferenceStatus':'nominal-reference-on-observed-platform; current colour positions unknown' if camera_pads else 'forward-platforms-only; unresolved-back-platform; legacy-GolfTraxx-camera-reference-only' if pads else 'unresolved-physical-platform; legacy-GolfTraxx-camera-reference-only',
             'inferPads':False,
             'fairways':[polygon(f) for f in features if f['properties']['hole']==n and f['properties']['kind']=='fairway'],
             'bunkers':[polygon(f) for f in features if f['properties']['hole']==n and f['properties']['kind']=='bunker'],
             'note':'Preliminär kartläggning från ortofoto 2026 och Lantmäteriets terräng. Flaggor och färgade teemarkeringar är inte inmätta.'}
        holes.append(h)
        decisions.append({'hole':n,'historicalTeeEpsg3006':source_tee,'displayStart':start,
                          'teeShiftMetres':round(Point(start).distance(Point(source_tee)),3),
                          'platforms':len(pads),'routing':'current-short-par3' if n==9 else 'GolfTraxx reference with observed endpoints',
                          'forwardOnlyPlatformsPreserveHistoricalCamera':bool(pads and not camera_pads),
                          'cameraPlatformCandidates':len(camera_pads),
                          'pin':'virtual target inside observed green; not daily flag position'})

    spec = importlib.util.spec_from_file_location('context_partition', ROOT/'geo_data/course-v2/visby/vegetation/decompose-water.py')
    partition = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(partition)
    context = [feature_collection(p) for p in [CONTEXT, EXTRA_CONTEXT]]
    extra_review = read(EXTRA_CONTEXT_REVIEW)
    if extra_review['output']['path'] != EXTRA_CONTEXT:
        raise ValueError('Supplementary context review names a different output')
    verify_identity(extra_review['output'])
    verify_identity(extra_review['sourceReceipt'])
    for source in context[1].get('inputs', []):
        verify_identity(source)
    buildings, vegetation, context_review = assemble_context(context, partition.decompose)
    water=[]
    for f in read(WATER)['features']:
        level=f['properties']['heightRH2000']
        rings=[[[p[0],p[1]] for p in ring] for ring in f['geometry']['coordinates']]
        water.append({'id':f['id'],'rings':rings,'heightRH2000':level,'sourceId':'water-breaks-lm-1m'})
    facilities=[]
    for f in read(FACILITIES)['features']:
        p=f['properties']
        facilities.append({**p,'id':f['id'],'kind':p['kind'],'rings':f['geometry']['coordinates'],
                           'sourceId':p.get('sourceId','imagery-lm-ortho'),'material':p.get('material','unknown')})
    environment, environment_review = assemble_environment(features, facilities, water, buildings)
    building_roofs, _, roof_review = attach_building_roofs(buildings)
    inputs=['tortunabuild/reference/scorecard.json','tortunabuild/reference/routing-golftraxx.json',
            FACILITIES,CONTEXT,EXTRA_CONTEXT,EXTRA_CONTEXT_REVIEW,extra_review['sourceReceipt']['path'],WATER,'tortunabuild/reference/clubhouse-review.json',
            ENVIRONMENT,ENVIRONMENT_REVIEW,BUILDING_OBSERVATIONS,BUILDING_ROOFS,ROOF_ENVELOPES]
    result={'schemaVersion':1,'groundId':'tortuna','horizontalCrs':'EPSG:3006',
            'status':'provisional-source-derived','card':{k:card[k] for k in ['source','teeNames','par','teeTotals']},
            'holes':holes,'water':water,'buildings':buildings,'buildingRoofs':building_roofs,
            'vegetation':vegetation,**environment,
            'facilities':facilities,'inputs':[ident(p) for p in inputs]+[{'path':playing_path,'sha256':hashlib.sha256(encoded(playing)).hexdigest()}]}
    review = {'schemaVersion':1,'groundId':'tortuna',
          'inputs':result['inputs'],'holes':decisions,'surfaceCounts':dict(Counter(f['properties']['kind'] for f in features)),
          'playingChangesets':improvement_review,'environment':environment_review,'buildingRoofs':roof_review,
          'surroundingContext':context_review,
          'limits':['No card-derived polygon generation, terrain flattening, or daily-flag claims.',
                    'Forward tee completeness, shadow-obscured edges, current tree presence and independent controls remain unverified.']}
    publish({playing_path:playing,'tortunabuild/mapping/course-input.json':result,'tortunabuild/mapping/assembly-review.json':review})
    print(json.dumps({'holes':len(holes),'surfaces':len(features),'buildings':len(buildings),
                      'paths':len(environment['paths']),'water':len(water),'facilities':len(facilities),
                      'measuredRoofSurfaces':len(roof_review['attachedBuildingIds'])}))


if __name__=='__main__':
    main()
