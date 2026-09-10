"""Reproduce the bounded front-nine review from retained orthophoto pixels.

No source file is rewritten. The output is a replacement/addition layer whose
replacesFeatureIds must be applied before the ordinary source assembly. Native
terrain, old routing references and current coloured tee positions are untouched.
"""
import hashlib
import json
from collections import Counter
from pathlib import Path

import rasterio
from PIL import Image, ImageDraw
from rasterio.windows import Window
from shapely.geometry import Polygon, shape

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'tortunabuild/cache/front9-improvements'
OUTPUT = 'tortunabuild/mapping/improvements-front9.geojson'
REVIEW = 'tortunabuild/mapping/improvements-front9-review.json'
RECEIPTS = {
    'geo_data/course-v2/tortuna/acquisition/orthophoto-native-crops.json':
        'e0253a03c004e10f37263ed836792997ce75769c9ba2fcbe40b13e486fe8d4a6',
    'geo_data/course-v2/tortuna/acquisition/orthophoto-review.json':
        '25dd5fdaac59cd4dde9f6a3961804a9b5a87cbeba7ca1ae7e0dc1be2cff4a6d5',
}
BASELINES = {
    'tortunabuild/mapping/surfaces-front9.geojson':
        '6a0560e6d8456545c33e4d8d77a0f33397ed28bfe293ad20149ff2df905d253f',
    'tortunabuild/mapping/surfaces-front9-fairways.geojson':
        'b27324aa0db3aeb8b55a8f271322be15310078fc4cefad436f197d772cca159a',
}
REVIEW_ONLY_WINDOWS = {'h06-tees-wide': Window(1156, 2531, 469, 719)}


def trace(hole, kind, pixels, *, suffix='native-detail', replaces=True,
          number=1, source=None, uncertainty=1.0, note='', **properties):
    return {'hole': hole, 'kind': kind, 'pixels': pixels,
            'id': f'tortuna-h{hole:02}-{kind}-{suffix}',
            'source': source or f'hole-{hole:02}-green',
            'replacesFeatureIds': [f'tortuna-h{hole:02}-{kind}-{number}'] if replaces else [],
            'boundaryInterpretationUncertaintyMetres': uncertainty,
            'interpretation': note, **properties}


# These integer coordinates were observed on the retained images, not generated
# from card lengths, buffers, best-fit circles or a terrain classifier. Pixel
# coordinates describe edges: E = west + x*spacing; N = north - y*spacing.
TRACES = [
    trace(4, 'tee', [[253,446],[260,436],[274,435],[286,443],[292,462],
                    [290,483],[284,501],[273,511],[257,507],[247,495],[245,475],[248,455]],
          suffix='forward-observed-2026', replaces=False, source='h04-tees-wide',
          teeRole='forward-observed-platform',
          note='Visible oval maintained platform beyond the original 128 m tee crop; its worn centre and outer cut edge are distinguishable in the retained 0.32 m overview. Does not resolve the shadowed back platform or current colours.'),
    trace(7, 'tee', [[436,95],[467,95],[480,105],[486,129],[485,163],
                    [481,192],[476,218],[432,225],[421,211],[425,179],[431,142]],
          suffix='forward-observed-2026', replaces=False, source='hole-07-tee',
          teeRole='forward-observed-platform',
          note='Separate maintained platform north of the previously mapped tee. The full visible cut platform is retained, including its worn central turf. Current tee colours are unverified.'),
    trace(1, 'green', [[354,332],[382,333],[412,348],[431,371],[445,400],
                      [451,430],[441,455],[421,472],[397,479],[370,469],
                      [348,449],[332,419],[319,389],[317,365],[328,343]],
          note='Native-pixel putting-surface boundary; excludes the darker collar and adjacent bunker.'),
    trace(2, 'green', [[376,345],[403,348],[430,361],[454,379],[468,403],
                      [470,425],[458,443],[432,456],[402,464],[374,462],
                      [350,449],[332,433],[325,412],[326,389],[343,365]],
          uncertainty=1.5,
          note='Native-pixel putting-surface boundary. Thin branch shadows cross the western edge; interpolation is limited to the contiguous visible mowing transition.'),
    trace(6, 'green', [[404,324],[427,326],[449,339],[464,354],[473,378],
                      [473,400],[460,423],[441,442],[416,456],[388,466],
                      [363,461],[345,450],[333,433],[326,411],[327,389],[343,367],[369,344]],
          note='Visible native-pixel putting-surface edge; darker surrounding apron is separate.'),
    trace(7, 'green', [[384,338],[407,341],[428,355],[445,374],[455,398],
                      [454,423],[446,447],[429,465],[407,475],[384,479],
                      [364,474],[349,460],[338,442],[332,417],[331,391],[339,367],[357,347]],
          note='Visible native-pixel putting-surface edge beneath power lines; no inferred circular geometry.'),
    trace(8, 'green', [[374,347],[405,349],[429,358],[450,376],[461,395],
                      [462,421],[452,447],[435,459],[407,466],[377,463],
                      [348,452],[329,434],[323,411],[326,388],[342,365],[359,353]],
          uncertainty=1.5,
          note='Native-pixel putting-surface edge. Thin western branch shadows remain an interpretation limitation; the unobservable outer tree boundaries are not traced.'),
    trace(9, 'green', [[368,328],[389,326],[413,338],[435,358],[449,383],
                      [454,410],[450,433],[437,451],[417,464],[394,470],
                      [371,464],[350,451],[338,430],[329,402],[328,376],[338,352],[353,336]],
          note='Native-pixel putting-surface edge between source pond and sand; does not use the daily flag or change the current short-hole routing.'),
    trace(1, 'bunker', [[363,291],[381,276],[397,271],[413,272],[431,280],
                       [451,294],[466,307],[473,317],[471,324],[465,329],
                       [450,331],[431,327],[410,320],[388,317],[373,316],[363,311],[359,303]],
          uncertainty=.75, note='Visible sand edge; turf bank excluded.'),
    trace(2, 'bunker', [[411,303],[425,299],[445,302],[465,311],[482,321],
                       [491,331],[491,341],[486,347],[475,349],[461,343],
                       [449,336],[434,330],[419,325],[409,321],[406,314]],
          suffix='north-native-detail', uncertainty=.75, note='Visible northern sand edge; turf bank excluded.'),
    trace(2, 'bunker', [[481,454],[498,448],[509,449],[515,456],[515,467],
                       [509,480],[500,489],[487,496],[473,498],[460,494],
                       [452,488],[452,479],[460,470]],
          suffix='south-native-detail', number=2, uncertainty=.75,
          note='Visible southern sand edge; turf bank excluded.'),
    trace(3, 'bunker', [[424,237],[435,236],[445,241],[453,251],[464,268],
                       [474,290],[481,311],[480,324],[473,333],[463,339],
                       [453,338],[446,331],[438,320],[425,310],[413,303],
                       [408,297],[406,286],[408,268],[413,252]],
          uncertainty=.75, note='Visible sand boundary; the heavily shadowed putting green is deliberately left unchanged.'),
    trace(4, 'bunker', [[511,299],[531,301],[551,307],[563,316],[567,328],
                       [562,341],[551,353],[536,368],[520,381],[500,393],
                       [488,395],[481,388],[478,374],[476,354],[477,332],
                       [483,315],[494,302]],
          uncertainty=.75, note='Visible sand boundary, separate from path and turf; shadowed green remains unchanged.'),
    trace(7, 'bunker', [[307,433],[315,434],[321,440],[327,454],[337,471],
                       [344,484],[346,493],[341,501],[332,503],[325,500],
                       [317,492],[308,478],[300,464],[293,452],[294,442],[300,435]],
          uncertainty=.75, note='Visible elongated sand boundary; turf bank excluded.'),
    trace(9, 'bunker', [[434,252],[451,252],[471,257],[478,264],[475,279],
                       [470,293],[470,302],[476,315],[480,324],[477,331],
                       [470,331],[457,321],[442,312],[430,300],[425,285],[426,269]],
          suffix='north-native-detail', uncertainty=.75, note='Visible northern sand boundary; path excluded.'),
    trace(9, 'bunker', [[513,385],[532,384],[550,384],[560,390],[564,402],
                       [563,421],[565,435],[569,448],[568,455],[560,461],
                       [553,461],[546,457],[539,447],[527,444],[515,438],
                       [506,427],[500,414],[498,402],[502,391]],
          suffix='east-native-detail', number=2, uncertainty=.75,
          note='Visible eastern sand boundary; path and grass bank excluded.'),
    trace(6, 'fairway', [[403,314],[433,318],[460,331],[478,353],[484,377],
                        [484,402],[472,430],[449,451],[422,466],[391,478],
                        [364,475],[340,464],[322,445],[316,420],[316,393],
                        [328,368],[353,343],[382,322]],
          suffix='green-apron-observed-2026', replaces=False,
          surfaceRole='green-apron', coverageStatus='green-apron-only; hole-long-fairway-unresolved',
          note='Only the distinguishable darker close-cut apron immediately around the putting surface. Intentionally overlaps the green, whose surface class has priority. No width or corridor buffer is inferred.'),
]

GAPS = [
    {'hole': 4, 'kind': 'tee', 'status': 'back-platform-unresolved',
     'reason': 'Historical back reference remains in tree shadow. New forward platform must not be interpreted as a surveyed back tee or assigned a colour.'},
    {'hole': 6, 'kind': 'tee', 'status': 'unresolved',
     'reason': 'Native 128 m crop and additional 150 x 230 m retained overview inspect the historical start and forward corridor; no complete platform boundary can be distinguished from shadows/rough.'},
    {'hole': 6, 'kind': 'fairway', 'status': 'only-green-apron-added',
     'reason': 'Dormant May grass shows mowing texture beside the pond but no defensible complete fairway cut line. The new apron does not claim full fairway coverage.'},
    {'holes': [3, 4, 5], 'kind': 'green', 'status': 'existing-source-trace-retained',
     'reason': 'Large tree shadows hide substantial putting boundaries; no higher-precision outline claimed.'},
    {'holes': [1, 2, 4, 7, 8], 'kind': 'fairway', 'status': 'existing-partial-traces-retained',
     'reason': 'Hole-wide strips were reviewed against the retained south/north raster. Remaining May fairway/rough transitions are too weak for a defensible larger perimeter.'},
    {'holes': [1, 2, 3, 5, 8, 9], 'kind': 'tee', 'status': 'existing-observed-platforms-retained',
     'reason': 'No additional complete platform perimeter was sufficiently distinct in the reviewed native crops; colours and complete tee census remain unverified.'},
]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(relative):
    return json.loads((ROOT / relative).read_text(encoding='utf8'))


def write(relative, value):
    target = ROOT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes((json.dumps(value, ensure_ascii=False, indent=2)+'\n').encode())


def main():
    for relative, expected in RECEIPTS.items():
        if digest((ROOT / relative).read_bytes().replace(b'\r\n', b'\n')) != expected:
            raise ValueError(f'Retained acquisition receipt changed: {relative}')
    baseline = {}
    for relative, expected in BASELINES.items():
        if digest((ROOT / relative).read_bytes()) != expected:
            raise ValueError(f'Replacement baseline changed: {relative}')
        baseline.update({f['id']: f for f in read(relative)['features']})
    native = read(next(iter(RECEIPTS)))
    native_windows = {v['id']: v for v in native['windows']}
    overview = read(list(RECEIPTS)[1])
    south = next(v for v in overview['windows'] if v['id'] == 'south')
    sources, images = {}, {}
    OUT.mkdir(parents=True, exist_ok=True)
    for name in dict.fromkeys([t['source'] for t in TRACES] + list(REVIEW_ONLY_WINDOWS)):
        if name == 'h04-tees-wide' or name in REVIEW_ONLY_WINDOWS:
            source = {**south, 'file': 'tortunabuild/cache/orthophoto/south.tif'}
            # Exact enclosing pixel window for the additionally inspected tee
            # region. This retains the original averaged 0.32 m pixels.
            window = REVIEW_ONLY_WINDOWS.get(name, Window(1593, 1062, 470, 688))
        else:
            source, window = native_windows[name], None
        raw = (ROOT / source['file']).read_bytes()
        if digest(raw) != source['sha256']:
            raise ValueError(f'Source raster bytes changed: {source["file"]}')
        with rasterio.open(ROOT / source['file']) as src:
            if src.crs.to_epsg() != 3006:
                raise ValueError('Source raster CRS changed')
            if list(src.transform.to_gdal()) != source['geoTransform'] or src.width != source['width'] or src.height != source['height']:
                raise ValueError('Source raster grid differs from retained receipt')
            array = src.read([1, 2, 3], window=window).transpose(1, 2, 0)
            transform = src.window_transform(window) if window else src.transform
        image = Image.fromarray(array)
        images[name] = image
        image_path = OUT / (name + '-source.png')
        image.save(image_path)
        sources[name] = {
            'sourceRasterPath': source['file'], 'sourceRasterSha256': source['sha256'],
            'sourcePixelWindow': list(map(int, (window.col_off, window.row_off, window.width, window.height))) if window else [0, 0, source['width'], source['height']],
            'geoTransform': list(transform.to_gdal()), 'width': image.width, 'height': image.height,
            'resolutionMetres': source['resolutionMetres'],
            'resampling': source.get('resampling', native['resampling']),
            'pixelMeaning': 'pixel edge; E=west+x*spacing, N=north-y*spacing',
            'reviewImagePath': image_path.relative_to(ROOT).as_posix(),
            'reviewImageSha256': digest(image_path.read_bytes()),
        }
    features, replacements, checks = [], set(), []
    overlays = {key: im.copy() for key, im in images.items()}
    for item in TRACES:
        source = sources[item['source']]
        west, dx, _, north, _, dy = source['geoTransform']
        pixels = item['pixels']
        if any(not (0 <= x <= source['width'] and 0 <= y <= source['height']) for x, y in pixels):
            raise ValueError('Trace leaves observed source image')
        ring = [[round(west+x*dx, 3), round(north+y*dy, 3)] for x, y in pixels]
        ring.append(ring[0])
        polygon = Polygon(ring)
        if not polygon.is_valid or polygon.area < 5:
            raise ValueError(f'Invalid or negligible traced polygon: {item["id"]}')
        replaced = item['replacesFeatureIds']
        for old in replaced:
            if old not in baseline or old in replacements:
                raise ValueError('Replacement is missing or repeated')
            prior = baseline[old]
            if prior['properties']['kind'] != item['kind'] or prior['properties']['hole'] != item['hole']:
                raise ValueError('Replacement changes hole or surface identity')
            replacements.add(old)
        old_poly = shape(baseline[replaced[0]]['geometry']) if replaced else None
        props = {k: v for k, v in item.items() if k not in ['pixels', 'id', 'source']}
        props.update(sourceId='imagery-lm-ortho', sourceCollection='orto-n2-2026',
                     observedYear=2026, reviewedOn='2026-09-09',
                     reviewer='assistant-native-pixel-visual-review',
                     reviewStatus='provisional-not-human-accepted', notSurveyed=True,
                     sourceGrid=source, tracePixels=pixels, terrainModified=False,
                     currentTeeColours='unverified',
                     uncertaintyStatus='visual boundary interpretation allowance; not source positional accuracy',
                     areaSquareMetres=round(polygon.area, 3))
        features.append({'type': 'Feature', 'id': item['id'], 'properties': props,
                         'geometry': {'type': 'Polygon', 'coordinates': [ring]}})
        checks.append({'id': item['id'], 'replacesFeatureIds': replaced, 'areaSquareMetres': round(polygon.area, 3),
                       'valid': polygon.is_valid, 'vertices': len(pixels),
                       'previousAreaSquareMetres': round(old_poly.area, 3) if old_poly else None,
                       'symmetricDifferenceSquareMetres': round(polygon.symmetric_difference(old_poly).area, 3) if old_poly else None,
                       'centroidShiftMetres': round(polygon.centroid.distance(old_poly.centroid), 3) if old_poly else None})
        draw = ImageDraw.Draw(overlays[item['source']])
        color = {'tee': '#00ffff', 'green': '#ffff00', 'bunker': '#ff9900', 'fairway': '#ff55ff'}[item['kind']]
        draw.line([tuple(p) for p in pixels+[pixels[0]]], fill=color, width=2)
    if len({f['id'] for f in features}) != len(features):
        raise ValueError('Duplicate improvement IDs')
    output = {'type': 'FeatureCollection', 'crs': {'type': 'name', 'properties': {'name': 'EPSG:3006'}},
              'axisOrder': ['easting', 'northing'], 'groundId': 'tortuna',
              'status': 'provisional-observed-additions-and-explicit-replacements',
              'integration': 'Remove each listed replacesFeatureIds exactly once before adding features; forward-observed-platform does not resolve an unseen back tee.',
              'features': features, 'limitations': GAPS}
    write(OUTPUT, output)
    for name, image in overlays.items():
        image.save(OUT / f'{name}-overlay.png')
    report = {'schemaVersion': 1, 'groundId': 'tortuna', 'reviewedOn': '2026-09-09',
              'method': 'Direct visual trace of retained orthophoto pixel boundaries; explicit source grids and source checksums; no terrain or length-derived geometry.',
              'script': 'tortunabuild/mapping/trace-improvements-front9.py',
              'outputPath': OUTPUT, 'outputSha256': digest((ROOT / OUTPUT).read_bytes()),
              'baselineInputs': [{'path': p, 'sha256': h} for p, h in BASELINES.items()],
              'acquisitionReceipts': [{'path': p, 'sha256LfNormalized': h} for p, h in RECEIPTS.items()],
              'additionalReviewWindows': {name: sources[name] for name in REVIEW_ONLY_WINDOWS},
              'features': len(features), 'additions': sum(not f['properties']['replacesFeatureIds'] for f in features),
              'replacements': len(replacements), 'countsByKind': dict(Counter(f['properties']['kind'] for f in features)),
              'newTeeHoles': [4, 7], 'newFairwayCoverage': {'6': 'only observed green apron; full fairway unresolved'},
              'checks': checks, 'allPolygonsValid': all(c['valid'] for c in checks),
              'retainedGaps': GAPS, 'independentSurveyApproval': False,
              'rawImageryRedistributed': False, 'terrainOrFrameChanged': False}
    write(REVIEW, report)
    print(json.dumps({k: report[k] for k in ['features', 'additions', 'replacements', 'countsByKind', 'outputSha256']}))


if __name__ == '__main__':
    main()
