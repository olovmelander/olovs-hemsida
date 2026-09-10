"""Adopt explicit pixel traces from the dated Lantmateriet tee review."""
from copy import deepcopy
import json
from shapely.geometry import Polygon


def apply_review(features, review_path):
    review = json.loads(review_path.read_text(encoding='utf8'))
    assert review['groundId'] == 'lidingo' and review['horizontalCrs'] == 'EPSG:3006'
    assert [h['hole'] for h in review['holes']] == list(range(1, 19))
    result = [f for f in features if not (f['properties']['kind'] == 'tee' and f['properties']['hole'])]
    for hole in review['holes']:
        image = hole['image']
        transform = image['geoTransform']
        assert len(transform) == 6 and transform[2] == transform[4] == 0
        assert transform[1] > 0 and transform[5] < 0
        assert len(image['sha256']) == 64
        assert hole['pads'], hole['hole']
        for pad in hole['pads']:
            if pad.get('status') == 'retained-unresolved':
                feature = deepcopy(pad['baselineFeature'])
                feature['id'] = pad['id']
                feature['properties'].update(currentReviewStatus='canopy-obscured-retained-historical-outline',
                    currentReviewNote=pad['note'], interpretationUncertaintyMetres=pad['uncertaintyMetres'])
                result.append(feature)
                continue
            pixels = pad['pixels']
            assert all(0 <= x <= image['width'] and 0 <= y <= image['height'] for x, y in pixels)
            ring = [[round(transform[0]+x*transform[1], 5), round(transform[3]+y*transform[5], 5)] for x, y in pixels]
            if ring[0] != ring[-1]:
                ring.append(ring[0])
            polygon = Polygon(ring)
            assert polygon.is_valid and polygon.area > 1, pad['id']
            result.append({'type': 'Feature', 'id': pad['id'], 'properties': {
                'kind': 'tee', 'hole': hole['hole'], 'sourceId': 'imagery-lm-ortho',
                'observedYear': 2025, 'captureDate': review['capturedAt'],
                'reviewStatus': 'machine-visual-review', 'notSurveyed': True,
                'method': 'manual-image-boundary-digitization', 'sourcePixelTrace': pad['id'],
                'sourceImageSha256': image['sha256'], 'interpretationUncertaintyMetres': pad.get('uncertaintyMetres', 1),
                'registrationAccuracy': 'not independently checked', 'note': pad['note'],
                'areaSquareMetres': round(polygon.area, 2), 'licence': 'CC-BY-4.0',
                **({'sharedPhysicalPlatformId': pad['sharedPhysicalPlatformId']} if pad.get('sharedPhysicalPlatformId') else {}),
            }, 'geometry': {'type': 'Polygon', 'coordinates': [ring]}})
    assert len({f['id'] for f in result}) == len(result)
    return result
