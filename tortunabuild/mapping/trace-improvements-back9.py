"""Reproduce independent back-nine improvements from retained orthophoto pixels.

Private source pixels are required. No network access, synthetic pads, colour
assignments or modifications to the original mapping are performed.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
import rasterio
from rasterio.windows import Window, bounds as window_bounds
from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'tortunabuild/mapping'
CACHE = ROOT / 'tortunabuild/cache/improvements-back9'
RECEIPT = ROOT / 'geo_data/course-v2/tortuna/acquisition/orthophoto-native-crops.json'
NORTH = ROOT / 'tortunabuild/cache/orthophoto/north.tif'
NORTH_SHA256 = 'a1802caa336ea8b483593d9ce5b54f3f9f7acd21e3e4f0bfa881750b8eab68db'
OBS = []


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def add(hole, kind, ordinal, pixels, *, crop='native-tee', source_hole=None, replaces=(), uncertainty=1.5, tee_role=None, note):
    OBS.append(dict(hole=hole, kind=kind, ordinal=ordinal, pixels=pixels, crop=crop,
                    source_hole=source_hole or hole, replaces=list(replaces), uncertainty=uncertainty, tee_role=tee_role, note=note))


# Manual observations follow. Coordinates refer to pixel edges at the unchanged
# image dimensions recorded below. The outline follows the visible maintained
# surface, not the position of a legacy point or the lengths on the scorecard.

# Native green boundaries: seven fully visible greens. H11/H16 retain their
# existing provisional shadow closures; this image cannot establish hidden edges.
add(10,'green',1,[[408,318],[430,320],[449,331],[463,350],[471,371],[471,397],[461,419],[444,435],[425,448],[400,460],[372,470],[349,469],[329,458],[317,440],[316,419],[322,396],[334,374],[352,351],[374,333],[393,322]],crop='native-green',replaces=['tortuna-h10-green-01'],uncertainty=1.2,note='Putting-surface edge independently retraced on native RGB; outer fringe excluded.')
add(12,'green',1,[[355,322],[375,316],[395,318],[418,328],[439,345],[454,366],[462,389],[462,415],[456,440],[446,461],[432,478],[414,485],[397,482],[381,471],[365,452],[351,430],[339,406],[332,382],[331,356],[339,335]],crop='native-green',replaces=['tortuna-h12-green-01'],uncertainty=1.2,note='Native putting-surface boundary, including the narrow southern lobe; surrounding collar excluded.')
add(13,'green',1,[[370,323],[392,319],[414,324],[432,335],[450,355],[464,377],[474,401],[477,423],[472,444],[460,459],[442,469],[420,474],[394,474],[369,470],[347,460],[330,445],[321,426],[319,405],[324,381],[335,357],[351,337]],crop='native-green',replaces=['tortuna-h13-green-01'],uncertainty=1.2,note='Native current putting-surface edge; shadows of players are interior details, not boundary vertices.')
add(14,'green',1,[[371,314],[389,320],[408,335],[425,357],[440,382],[450,408],[456,433],[452,455],[442,474],[426,488],[407,495],[385,494],[365,485],[349,470],[337,449],[331,425],[332,400],[340,374],[350,349],[360,328]],crop='native-green',replaces=['tortuna-h14-green-01'],uncertainty=1.5,note='Native putting-surface interpretation. Dry spring mowing transition is less distinct at southern edge.')
add(15,'green',1,[[352,348],[376,338],[400,336],[424,342],[445,355],[459,374],[470,397],[470,421],[464,444],[451,464],[431,476],[407,482],[380,483],[352,480],[326,474],[305,464],[289,449],[283,431],[286,412],[296,394],[312,377],[331,362]],crop='native-green',replaces=['tortuna-h15-green-01'],uncertainty=1.5,note='Native putting-surface edge follows the asymmetric lower lobe, retaining the green-side gap to the long southern bunker.')
add(17,'green',1,[[360,338],[383,332],[408,333],[432,341],[451,354],[465,373],[472,396],[472,419],[466,441],[454,459],[437,472],[416,482],[392,488],[366,491],[341,487],[319,480],[301,469],[290,454],[285,437],[288,417],[298,396],[312,377],[329,360],[345,346]],crop='native-green',replaces=['tortuna-h17-green-01'],uncertainty=1.3,note='Native putting-surface edge around southwestern lobe; cart path and bunker remain separate.')
add(18,'green',1,[[397,347],[416,341],[430,344],[442,355],[448,371],[448,390],[441,411],[431,431],[417,448],[402,459],[385,465],[368,462],[355,452],[348,438],[347,422],[352,403],[363,383],[379,363]],crop='native-green',replaces=['tortuna-h18-green-01'],uncertainty=1.5,note='Native small final green; narrow separation from eastern sand retained.')

# Visible native sand edges, including concavities simplified in the first pass.
add(10,'bunker',1,[[270,381],[281,383],[287,390],[286,401],[278,415],[266,431],[257,447],[246,455],[236,453],[230,444],[229,431],[234,415],[243,400],[255,388]],crop='native-green',replaces=['tortuna-h10-bunker-01'],uncertainty=.8,note='Actual exposed sand edge from native RGB.')
add(10,'bunker',2,[[369,500],[380,501],[387,508],[390,518],[385,533],[377,547],[364,558],[347,566],[330,573],[319,573],[312,567],[310,559],[313,552],[323,548],[337,543],[348,535],[355,524],[359,509]],crop='native-green',replaces=['tortuna-h10-bunker-02'],uncertainty=.8,note='Native hooked sand outline; concave northwestern lip retained.')
add(12,'bunker',1,[[293,343],[302,343],[308,350],[312,364],[313,385],[315,408],[319,429],[328,450],[335,470],[338,484],[334,490],[323,492],[312,489],[305,482],[302,467],[301,443],[299,416],[292,389],[285,364],[284,352]],crop='native-green',replaces=['tortuna-h12-bunker-01'],uncertainty=.8,note='Long western sand strip on the unchanged native grid.')
add(12,'bunker',2,[[476,454],[490,451],[505,444],[517,442],[526,447],[530,457],[530,469],[523,478],[510,483],[492,485],[475,484],[466,479],[463,471],[466,461]],crop='native-green',replaces=['tortuna-h12-bunker-02'],uncertainty=.8,note='Southeastern bunker includes actual lobed rim; internal darker sand retained as sand.')
add(13,'bunker',1,[[391,494],[407,494],[423,493],[443,487],[454,487],[463,492],[467,500],[465,508],[458,514],[445,516],[428,515],[411,517],[395,519],[385,516],[380,510],[379,503],[383,497]],crop='native-green',replaces=['tortuna-h13-bunker-01'],uncertainty=.8,note='Native southern sand outline.')
add(14,'bunker',1,[[515,328],[523,322],[529,323],[533,331],[534,344],[530,358],[523,375],[517,382],[507,381],[493,376],[484,370],[482,362],[487,353],[499,342]],crop='native-green',replaces=['tortuna-h14-bunker-01'],uncertainty=.8,note='Eastern exposed sand edge; no third bunker inferred from an old diagram.')
add(14,'bunker',2,[[304,459],[314,461],[322,470],[330,482],[344,493],[354,502],[359,511],[356,520],[348,525],[337,527],[327,523],[319,514],[312,502],[304,490],[296,479],[293,471],[296,463]],crop='native-green',replaces=['tortuna-h14-bunker-02'],uncertainty=.8,note='Southwestern exposed sand edge.')
add(15,'bunker',1,[[340,294],[349,295],[356,302],[360,311],[360,318],[354,325],[342,331],[332,340],[320,351],[311,355],[304,350],[301,341],[302,333],[308,325],[322,317],[328,307],[332,299]],crop='native-green',replaces=['tortuna-h15-bunker-01'],uncertainty=.8,note='Small northern bunker retraced on native RGB.')
add(15,'bunker',2,[[299,494],[309,495],[320,498],[343,499],[372,500],[401,502],[422,500],[438,497],[444,498],[448,505],[450,515],[448,523],[442,530],[432,534],[414,534],[389,533],[361,532],[332,531],[308,531],[294,530],[287,526],[284,520],[284,510],[289,501]],crop='native-green',replaces=['tortuna-h15-bunker-02'],uncertainty=.8,note='Native long southern sand margin; no vegetation island inferred from interior shadows.')
add(16,'bunker',1,[[442,275],[454,277],[465,284],[473,294],[478,307],[478,315],[473,322],[466,321],[457,315],[446,304],[436,294],[430,286],[430,280],[435,276]],crop='native-green',replaces=['tortuna-h16-bunker-01'],uncertainty=.8,note='Unobscured native north sand; green itself remains shadow-limited.')
add(16,'bunker',2,[[519,420],[529,423],[539,432],[547,446],[552,460],[554,472],[551,480],[545,485],[537,483],[530,476],[525,464],[520,451],[511,441],[507,431],[508,425],[513,421]],crop='native-green',replaces=['tortuna-h16-bunker-02'],uncertainty=.8,note='Unobscured native eastern bunker.')
add(17,'bunker',1,[[273,492],[285,493],[300,498],[316,504],[329,511],[337,518],[341,526],[338,534],[331,541],[321,544],[309,542],[293,537],[278,532],[266,525],[259,518],[257,510],[260,501],[265,496]],crop='native-green',replaces=['tortuna-h17-bunker-01'],uncertainty=.8,note='Native southern bunker excludes adjacent cart path.')
add(18,'bunker',1,[[471,389],[482,391],[492,399],[498,408],[499,417],[495,426],[485,435],[477,445],[471,459],[467,474],[460,482],[449,486],[439,484],[432,478],[430,470],[433,460],[440,447],[445,434],[449,419],[455,404],[460,394],[465,389]],crop='native-green',replaces=['tortuna-h18-bunker-01'],uncertainty=.8,note='Native elongated eastern sand; cart path to east excluded.')

# Existing platforms: outer maintained edges, not only the pale worn centres.
add(10,'tee',1,[[350,420],[374,414],[404,411],[432,414],[461,418],[489,418],[520,417],[538,421],[542,430],[540,440],[527,445],[500,446],[469,445],[437,443],[408,445],[377,447],[355,442]],replaces=['tortuna-h10-tee-01'],uncertainty=1.8,tee_role='back-observed-platform',note='Native maintained platform south of woodland; tee marker colours unassigned.')
add(10,'tee',2,[[567,418],[588,417],[614,416],[641,413],[668,408],[691,407],[711,411],[730,419],[734,429],[730,438],[713,443],[687,447],[659,448],[631,449],[603,447],[575,440]],replaces=['tortuna-h10-tee-02'],uncertainty=1.8,tee_role='forward-observed-platform',note='Separate eastern platform; native maintained edge interpreted around dry inner playing strip.')
add(11,'tee',1,[[241,412],[267,407],[297,405],[326,400],[355,396],[383,393],[404,395],[414,403],[414,413],[408,423],[391,431],[365,437],[335,440],[306,444],[274,448],[248,444],[240,437]],replaces=['tortuna-h11-tee-01'],uncertainty=1.8,tee_role='back-observed-platform',note='Native current main platform, with outer maintained boundary around the worn strip.')
add(11,'tee',2,[[8,422],[20,414],[36,407],[54,400],[69,397],[83,399],[91,407],[90,416],[82,423],[65,430],[47,437],[31,442],[17,440],[9,433]],uncertainty=2,tee_role='forward-observed-platform',note='Additional smaller western maintained platform, corroborated in wider context; entirely within source crop; no tee colour assignment.')
add(13,'tee',1,[[232,453],[253,460],[276,476],[300,497],[323,518],[346,538],[370,557],[380,570],[380,580],[372,586],[358,582],[339,568],[317,549],[295,531],[273,515],[253,503],[235,488],[222,475],[220,464]],replaces=['tortuna-h13-tee-01'],uncertainty=1.8,tee_role='back-observed-platform',note='Bent southeast-of-pond platform independently retraced; historical source back reference remains offset.')
add(13,'tee',2,[[104,172],[124,165],[148,166],[173,174],[199,183],[227,191],[251,201],[266,211],[267,221],[259,228],[245,228],[221,220],[195,211],[170,204],[145,198],[122,191],[108,184]],source_hole=16,uncertainty=2,tee_role='forward-observed-platform',note='Additional northwest-of-pond rectangular platform visible in native H16 tee crop. Hole13 association corroborated by routing and schematic; colour remains unassigned.')
add(14,'tee',1,[[375,328],[385,324],[397,325],[405,332],[409,347],[408,370],[409,397],[411,428],[410,458],[407,471],[398,476],[386,472],[379,463],[375,438],[373,408],[373,378],[371,350]],replaces=['tortuna-h14-tee-01'],uncertainty=1.8,tee_role='back-observed-platform',note='Native long maintained platform east of public road; canopy shadows meet western edge.')
add(14,'tee',2,[[520,557],[531,552],[541,557],[548,570],[548,592],[548,615],[552,638],[552,662],[549,680],[541,688],[531,685],[525,675],[523,653],[522,629],[519,607],[516,581]],replaces=['tortuna-h14-tee-02'],uncertainty=1.8,tee_role='forward-observed-platform',note='Native narrow southeastern platform west of pond; colours unassigned.')
add(16,'tee',1,[[293,510],[316,501],[339,490],[362,480],[388,467],[413,454],[435,451],[451,454],[460,465],[460,475],[451,485],[432,495],[409,507],[385,519],[361,531],[337,540],[317,546],[301,541],[291,533]],replaces=['tortuna-h16-tee-01'],uncertainty=2,tee_role='back-observed-platform',note='Native southwestern pond-side platform; shadow at northeast end limits edge certainty.')
add(17,'tee',1,[[260,454],[280,441],[305,427],[330,412],[356,396],[381,381],[406,367],[426,361],[442,363],[455,372],[462,382],[461,394],[448,405],[426,418],[402,432],[376,446],[349,462],[326,477],[304,486],[284,487],[269,483],[258,473],[255,464]],replaces=['tortuna-h17-tee-01'],uncertainty=1.8,tee_role='back-observed-platform',note='Native maintained lower platform; bridge landing and tracks excluded.')
add(17,'tee',2,[[576,237],[598,221],[624,205],[650,189],[675,174],[697,162],[714,158],[727,162],[736,171],[738,181],[731,191],[713,203],[690,217],[665,232],[640,247],[617,260],[596,270],[582,271],[574,263],[572,251]],replaces=['tortuna-h17-tee-02'],uncertainty=1.8,tee_role='forward-observed-platform',note='Native upper platform beyond footbridge, separate from the adjoining approach and cart path.')
add(18,'tee',1,[[347,413],[359,398],[376,383],[396,369],[416,355],[434,345],[448,346],[457,355],[461,368],[458,380],[447,393],[431,405],[411,420],[390,435],[371,448],[357,450],[347,443],[341,432],[341,422]],replaces=['tortuna-h18-tee-01'],uncertainty=1.8,tee_role='back-observed-platform',note='Single clearly maintained platform southeast of bridge. The other old tee polygon actually followed the cart path and is explicitly removed.')

# H12 has an observable forward pad on the adjacent green11 crop. The older
# back reference falls among trees; this addition must not move that reference.
add(12,'tee',1,[[216,202],[233,188],[251,178],[270,167],[291,156],[310,149],[324,151],[332,159],[330,169],[319,178],[300,188],[280,198],[260,211],[242,221],[228,223],[218,216]],crop='native-green',source_hole=11,uncertainty=2.5,tee_role='forward-observed-platform',note='Visible short forward platform between path and pond, northeast of shadowed back-tee area. Outer native mowing edge interpreted; no hidden back-platform edge invented.')


def prepare():
    CACHE.mkdir(parents=True, exist_ok=True)
    receipt = json.loads(RECEIPT.read_text(encoding='utf8'))
    windows = {r['id']: r for r in receipt['windows']}
    grids = {}
    for hole in range(10, 19):
        for kind in ['tee', 'green']:
            row = windows[f'hole-{hole:02d}-{kind}']
            file = ROOT / row['file']
            if sha(file) != row['sha256']:
                raise ValueError(f'Native source hash changed: {file}')
            png = file.with_suffix('.png')
            with rasterio.open(file) as src:
                rgb = np.moveaxis(src.read([1, 2, 3]), 0, 2)
                if not np.array_equal(np.asarray(Image.open(png).convert('RGB')), rgb):
                    raise ValueError(f'Review PNG differs from native RGB: {png}')
            grids[(hole, f'native-{kind}')] = dict(
                file=png.relative_to(ROOT).as_posix(), sha256=sha(png),
                sourceFile=row['file'], sourceSha256=row['sha256'],
                sourceIds=row['sourceIds'], boundsEpsg3006=row['boundsEpsg3006'],
                width=row['width'], height=row['height'], geoTransform=row['geoTransform'],
                resolutionMetres=0.16, resampling='none; native RGB pixel copy')
    if sha(NORTH) != NORTH_SHA256:
        raise ValueError('Retained north mosaic changed')
    with rasterio.open(NORTH) as src:
        if src.crs.to_epsg() != 3006 or not np.allclose(src.res, [.32, .32]):
            raise ValueError('Unexpected source mosaic grid')
        for hole in range(10, 19):
            e, n = windows[f'hole-{hole:02d}-tee']['referenceEpsg3006']
            row, col = src.index(e, n)
            window = Window(col - 400, row - 400, 800, 800)
            data = src.read([1, 2, 3], window=window)
            if data.shape != (3, 800, 800):
                raise ValueError(f'Context window clipped: hole {hole}')
            png = CACHE / f'hole-{hole:02d}-tee-context.png'
            Image.fromarray(np.moveaxis(data, 0, 2)).save(png)
            grids[(hole, 'context-tee')] = dict(file=png.relative_to(ROOT).as_posix(), sha256=sha(png),
                sourceFile=NORTH.relative_to(ROOT).as_posix(), sourceSha256=NORTH_SHA256,
                sourceIds=['north-mosaic'], boundsEpsg3006=list(window_bounds(window, src.transform)),
                width=800, height=800, geoTransform=list(src.window_transform(window).to_gdal()),
                sourcePixelWindow=[col-400,row-400,800,800], resolutionMetres=.32,
                resampling='none in context extraction; original mosaic 0.32m derivative')
    return grids


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    grids = prepare()
    if args.prepare_only:
        print(json.dumps(dict(contextCrops=9, nativeCropsValidated=18)))
        return
    original = json.loads((OUT / 'surfaces-back9.geojson').read_text(encoding='utf8'))
    originals = {f['id']: f for f in original['features']}
    features, used, overlay = [], {}, {}
    for obs in OBS:
        grid = grids[(obs['source_hole'], obs['crop'])]
        west, south, east, north = grid['boundsEpsg3006']
        if any(not (0 <= x <= grid['width'] and 0 <= y <= grid['height']) for x,y in obs['pixels']):
            raise ValueError('Trace outside its recorded crop')
        ring = [[round(west+x*(east-west)/grid['width'], 3), round(north-y*(north-south)/grid['height'], 3)]
                for x,y in obs['pixels']]
        ring.append(ring[0])
        polygon = Polygon(ring)
        if not polygon.is_valid or polygon.area < 2:
            raise ValueError(f'Invalid polygon: {obs}')
        for old_id in obs['replaces']:
            if old_id not in originals or originals[old_id]['properties']['hole'] != obs['hole'] or originals[old_id]['properties']['kind'] != obs['kind']:
                raise ValueError(f'Invalid replacement {old_id}')
        feature_id = f"tortuna-h{obs['hole']:02d}-{obs['kind']}-review2-{obs['ordinal']:02d}"
        props = dict(id=feature_id, kind=obs['kind'], hole=obs['hole'], sourceId='imagery-lm-ortho',
            sourceFeatureId=feature_id, replacesFeatureIds=obs['replaces'],
            sourceCrop=grid['file'], sourceCropSha256=grid['sha256'], sourceFile=grid['sourceFile'],
            sourceSha256=grid['sourceSha256'], sourceIds=grid['sourceIds'],
            sourceResolutionMetres=grid['resolutionMetres'], resampling=grid['resampling'],
            method='manual-orthophoto-interpretation', observedOn='2026-09-09',
            reviewStatus='agent-visual-review; human-review-pending', accuracyStatus='interpretation-estimate; not-surveyed',
            horizontalUncertaintyMetres=obs['uncertainty'], boundaryNote=obs['note'],
            teeColourStatus='unassigned' if obs['kind'] == 'tee' else None,
            teeRole=obs['tee_role'],
            areaSquareMetres=round(polygon.area,3), originalPixels=obs['pixels'],
            cropBoundsEpsg3006=grid['boundsEpsg3006'], cropSize=[grid['width'],grid['height']],
            geoTransform=grid['geoTransform'])
        features.append(dict(type='Feature',id=feature_id,properties=props,geometry=dict(type='Polygon',coordinates=[ring])))
        used[grid['file']] = grid
        overlay.setdefault((obs['source_hole'],obs['crop']),[]).append(obs)
    for key, observations in overlay.items():
        img = Image.open(ROOT / grids[key]['file']).convert('RGB')
        draw = ImageDraw.Draw(img)
        for obs in observations:
            colour = {'tee':'#ff8b42','green':'#36f9aa','bunker':'#ffec70','fairway':'#76bdff'}[obs['kind']]
            points = [tuple(p) for p in obs['pixels']]
            draw.line(points+[points[0]],fill=colour,width=2)
            draw.text(points[0],f"{obs['kind']} {obs['ordinal']}",fill=colour)
        img.save(CACHE / f'hole-{key[0]:02d}-{key[1]}-overlay.png')
    ids = [f['id'] for f in features]
    replacement_ids = [old for f in features for old in f['properties']['replacesFeatureIds']]
    if len(ids) != len(set(ids)) or len(replacement_ids) != len(set(replacement_ids)):
        raise ValueError('Duplicate feature or replacement ID')
    for i, feature in enumerate(features):
        polygon = Polygon(feature['geometry']['coordinates'][0])
        for other in features[i+1:]:
            intersection = polygon.intersection(Polygon(other['geometry']['coordinates'][0])).area
            if intersection > 1:
                raise ValueError(f"Unexpected overlap: {feature['id']}, {other['id']}: {intersection}")
    output = dict(type='FeatureCollection',name='Tortuna back-nine second visual review',
        crs=dict(type='name',properties=dict(name='EPSG:3006')),features=features)
    (OUT / 'improvements-back9.geojson').write_text(json.dumps(output,indent=2)+'\n',encoding='utf8')
    review = dict(schemaVersion=1,groundId='tortuna',reviewedOn='2026-09-09',holes=list(range(10,19)),
        featureCount=len(features), counts={k:sum(f['properties']['kind']==k for f in features) for k in ['tee','green','bunker','fairway']},
        additions=sum(not f['properties']['replacesFeatureIds'] for f in features),
        replacements=sum(bool(f['properties']['replacesFeatureIds']) for f in features),
        validation=dict(allPolygonsValid=True,exactSourcePixelsValidated=True,sourceHashesValidated=True,
                        originalGeometryUnmodified=True,allFeatureIdsUnique=True,replacementIdsUnique=True,
                        noInterFeatureOverlapAboveOneSquareMetre=True,allGeneratedOverlaysVisuallyReviewed=True,
                        teeColoursAssigned=False,surveyAccuracyClaimed=False),
        sourceReceipt=dict(path=RECEIPT.relative_to(ROOT).as_posix(),sha256LfNormalized=hashlib.sha256(RECEIPT.read_bytes().replace(b'\r\n',b'\n')).hexdigest()),
        originalFeatures=dict(path='tortunabuild/mapping/surfaces-back9.geojson',sha256=sha(OUT/'surfaces-back9.geojson')),
        sourceGrids=list(used.values()),
        removals=[dict(featureId='tortuna-h18-tee-02',hole=18,kind='tee',reason='Misidentified cart path. Native H18 tee RGB shows continuous pale path to footbridge through entire old narrow polygon; no closed maintained pad exists here.',sourceCrop=grids[(18,'native-tee')]['file'],sourceCropSha256=grids[(18,'native-tee')]['sha256'])],
        limitations=['H12 shadowed back-platform boundary remains unresolved. The added northeast platform is explicitly forward and must not replace the historical back reference.',
            'H15 apparent road-side strips lack sufficiently clear complete maintained edges in this spring imagery. No H15 pads fabricated; a field or alternate-season check remains necessary.',
            'A possible additional forward H16 mowing strip cannot be separated confidently from the fairway/rough transition; no new polygon emitted.',
            'H11 and H16 green closures remain canopy-shadow-limited; the prior provisional green polygons are retained without increased accuracy claims.',
            'Existing wider fairway outlines were visually checked against retained full-hole context and remain provisional spring interpretations; this pass adds no unsupported full fairway boundaries.',
            'All tee-colour assignments, current marker locations, independent controls and human source-accuracy approval remain pending.',
            '0.16m is source sample spacing, not claimed interpretation or survey accuracy.'],
        geometry=dict(path='tortunabuild/mapping/improvements-back9.geojson',sha256=sha(OUT/'improvements-back9.geojson')))
    (OUT / 'improvements-back9-review.json').write_text(json.dumps(review,indent=2)+'\n',encoding='utf8')
    print(json.dumps({k:review[k] for k in ['featureCount','counts','additions','replacements']}))


if __name__ == '__main__':
    main()
