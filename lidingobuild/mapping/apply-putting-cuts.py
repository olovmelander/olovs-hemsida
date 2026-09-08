#!/usr/bin/env python3
"""Apply the reviewed 2025 putting cuts to the provisional source collection.

No imagery request or terrain rebuild is required. Exact original assertions
prevent a later source revision from being overwritten by an older review.
Imported by build-playing-surfaces.py; run directly to update existing intake.
"""
import copy
import json
from hashlib import sha256
from pathlib import Path
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[2]
REVIEW = ROOT / 'lidingobuild/mapping/putting-cuts-2025.json'


def apply(features):
    review = json.loads(REVIEW.read_text(encoding='utf8'))
    assert review['groundId'] == 'lidingo' and review['horizontalCrs'] == 'EPSG:3006'
    assert review['state'] == 'reviewed-provisional-geometry-not-surveyed'
    image = review['sourceCapture']
    assert image['sha256'] == 'bcec0932c68497b690fe1020e3426ca2596519ebf5875eb3a65ed0c120660c2e'
    result = copy.deepcopy(features)
    assert len({f['id'] for f in result}) == len(result)
    for decision in review['features']:
        matches = [f for f in result if f['id'] == decision['id']]
        assert len(matches) == 1, decision['id']
        feature = matches[0]
        assert feature['properties']['kind'] == 'green' and feature['properties']['hole'] == decision['hole']
        assert feature['geometry'] in [decision['beforeGeometry'], decision['geometry']], ('re-review changed source', decision['id'])
        crop = decision['sourceCrop']
        world = crop['worldfile']
        points = [[round(world[4] + world[0] * (crop['left'] + x), 3),
                   round(world[5] + world[3] * (crop['top'] + y), 3)] for x, y in decision['pixels']]
        points.append(points[0])
        assert decision['geometry'] == {'type': 'Polygon', 'coordinates': [points]}
        polygon = shape(decision['geometry'])
        assert polygon.is_valid and polygon.area > 100
        assert abs(polygon.area - decision['afterAreaM2']) < .006
        feature['geometry'] = copy.deepcopy(decision['geometry'])
        feature['properties'] = {
            'kind': 'green', 'hole': decision['hole'], 'sourceId': 'imagery-lm-ortho',
            'observedYear': 2025, 'captureDate': image['captureDate'],
            'sourceImageSha256': image['sha256'], 'sourceReview': 'lidingobuild/mapping/putting-cuts-2025.json',
            'reviewStatus': 'machine-visual-review', 'notSurveyed': True,
            'method': 'manual-image-putting-cut-digitization',
            'interpretationUncertaintyMetres': decision['interpretationUncertaintyMetres'],
            'registrationAccuracy': 'not independently checked',
            'areaSquareMetres': round(polygon.area, 2),
            'geometryReview': decision['review'],
            'licence': image['licence']['id'], 'attribution': image['licence']['attribution'],
        }
    bunkers = [shape(f['geometry']) for f in result if f['properties']['kind'] == 'bunker']
    for decision in review['features']:
        assert sum(shape(decision['geometry']).intersection(b).area for b in bunkers) < .001, 'putting cut overlaps mapped sand'
    return result


if __name__ == '__main__':
    approaches = json.loads((ROOT/'lidingobuild/mapping/approaches-2025.geojson').read_text(encoding='utf8'))
    for feature in approaches['features']:
        props = feature['properties']; crop = props['sourceCrop']; world = crop['worldfile']
        points = [[round(world[4]+world[0]*(crop['left']+x*crop['width']/crop['displayWidth']),3),
                   round(world[5]+world[3]*(crop['top']+y*crop['height']/crop['displayHeight']),3)] for x,y in props['displayPixels']]
        points.append(points[0])
        assert feature['geometry'] == {'type':'Polygon','coordinates':[points]}
        assert shape(feature['geometry']).is_valid and shape(feature['geometry']).area > 100
    source = ROOT / 'lidingobuild/mapping/playing-surfaces.geojson'
    collection = json.loads(source.read_text(encoding='utf8'))
    collection['features'] = apply(collection['features'])
    source.write_text(json.dumps(collection, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    report_path = ROOT / 'lidingobuild/mapping/playing-surfaces-review.json'
    report = json.loads(report_path.read_text(encoding='utf8'))
    report['puttingCuts2025'] = {'review': 'lidingobuild/mapping/putting-cuts-2025.json',
        'sha256': sha256(REVIEW.read_bytes()).hexdigest(),
        'replacedHoles': [f['hole'] for f in json.loads(REVIEW.read_text(encoding='utf8'))['features']],
        'independentRegistrationAccuracyMetres': None, 'independentHumanReview': False}
    report['output']['sha256'] = sha256(source.read_bytes()).hexdigest()
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(json.dumps(report['puttingCuts2025']))
