"""Explicit April 2025 green and sand traces, expressed in checked image pixels."""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw
from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parents[2]
PANELS = ROOT/'angsobuild/cache/lm-ortho/review-panels'

# Each ring was interpreted on its individual plain orthophoto panel. Shadowed
# portions carry larger interpretation uncertainty; these are not survey claims.
GREENS = {
1: [[270,215],[292,204],[318,199],[343,198],[364,206],[379,222],[386,243],[382,261],[372,287],[364,313],[364,340],[363,355],[355,371],[341,383],[318,391],[290,390],[267,384],[250,375],[239,360],[238,344],[244,328],[251,310],[253,287],[252,266],[255,243],[261,228]],
2: [[210,331],[227,315],[252,301],[278,284],[299,263],[318,243],[338,231],[356,224],[371,227],[382,239],[386,258],[382,280],[373,305],[361,330],[352,345],[337,356],[318,361],[291,365],[266,373],[242,382],[224,382],[209,376],[200,364],[200,347]],
3: [[225,294],[246,278],[273,263],[302,249],[329,238],[351,235],[371,242],[384,258],[388,280],[391,304],[403,327],[413,348],[413,371],[403,391],[384,409],[361,417],[335,423],[308,424],[285,417],[266,404],[253,385],[241,362],[232,338]],
4: [[249,250],[265,238],[284,231],[307,231],[327,238],[343,250],[353,269],[354,289],[350,313],[348,335],[350,360],[345,385],[336,406],[321,420],[300,425],[280,419],[265,406],[256,388],[248,364],[242,338],[239,311],[238,287],[240,266]],
5: [[274,309],[292,300],[309,300],[328,305],[348,317],[371,330],[395,340],[420,347],[439,358],[450,374],[453,391],[447,408],[432,420],[411,428],[389,433],[369,440],[349,444],[329,439],[311,430],[295,415],[282,395],[270,374],[262,353],[261,334],[266,319]],
6: [[266,267],[286,253],[307,249],[330,253],[352,267],[373,286],[392,307],[406,329],[422,351],[431,372],[430,390],[422,404],[405,414],[385,417],[365,422],[347,431],[327,439],[305,443],[284,441],[266,434],[251,420],[240,399],[235,376],[236,353],[241,331],[248,309],[256,285]],
7: [[336,280],[352,277],[368,283],[380,299],[387,318],[388,337],[381,358],[375,379],[371,403],[365,429],[359,457],[351,481],[335,502],[316,517],[293,524],[272,519],[256,509],[246,493],[245,476],[253,455],[265,435],[276,413],[284,391],[290,371],[301,350],[313,332],[322,314],[325,294]],
8: [[302,284],[319,276],[337,278],[357,289],[375,306],[387,329],[393,350],[390,373],[379,396],[370,419],[364,444],[354,464],[338,476],[319,479],[299,472],[283,461],[269,444],[261,424],[257,401],[259,379],[270,355],[282,331],[289,310]],
9: [[287,323],[306,304],[328,293],[351,286],[376,284],[398,288],[417,297],[429,311],[433,326],[427,339],[415,347],[396,353],[378,365],[365,384],[355,406],[342,422],[326,430],[308,428],[291,420],[278,404],[269,386],[267,367],[273,345]],
}

# (panel kind, sand ring); the complete inventory deliberately excludes former
# algorithmic sand polygons now visibly occupied by turf, trees or a path.
SAND = {
1: [('green',[[278,146],[281,135],[290,124],[304,120],[316,124],[324,134],[324,146],[316,158],[304,166],[291,168],[283,162]]),
    ('green',[[423,128],[427,117],[440,108],[451,109],[463,118],[469,131],[470,144],[463,154],[451,158],[437,153],[427,143]]),
    ('green',[[384,291],[389,280],[398,275],[406,279],[409,289],[405,301],[397,309],[388,310],[383,305]]),
    ('hole',[[388,907],[392,900],[398,900],[402,908],[403,918],[400,929],[395,935],[389,933],[386,925],[386,915]])],
2: [('green',[[217,406],[228,399],[245,393],[262,387],[274,386],[281,393],[283,402],[280,410],[270,417],[256,421],[240,423],[226,421],[219,416]]),
    ('hole',[[829,386],[837,382],[847,382],[855,382],[859,388],[858,396],[851,400],[839,401],[829,398],[827,393]])],
3: [('green',[[366,426],[375,422],[389,419],[401,421],[407,427],[406,434],[399,439],[385,444],[372,446],[365,442],[364,435]])],
4: [('green',[[381,353],[388,339],[399,331],[408,333],[417,346],[423,360],[423,373],[416,387],[406,401],[394,412],[382,415],[376,409],[376,398],[379,381]])],
5: [],
6: [('green',[[309,485],[316,469],[328,459],[342,456],[352,450],[364,437],[376,433],[388,437],[395,445],[394,455],[383,472],[378,488],[372,504],[360,516],[343,522],[326,527],[313,529],[305,520],[304,506]]),
    ('hole',[[278,434],[280,431],[287,433],[298,440],[310,439],[323,433],[336,422],[344,418],[352,420],[356,426],[351,438],[346,448],[340,455],[329,456],[318,452],[310,455],[305,462],[297,460],[289,451],[282,444]]),
    ('hole',[[256,470],[263,467],[271,469],[275,475],[274,481],[269,486],[262,488],[257,484],[254,478]])],
7: [('hole',[[380,357],[384,347],[397,341],[401,332],[403,323],[410,320],[416,324],[417,335],[418,343],[413,349],[402,355],[393,362],[386,366],[379,367]]),
    ('hole',[[184,1259],[189,1251],[195,1249],[201,1254],[205,1263],[208,1272],[207,1278],[201,1281],[194,1277],[189,1270]])],
8: [('green',[[370,206],[374,195],[382,190],[392,192],[403,199],[417,204],[431,202],[441,199],[451,204],[457,212],[458,222],[454,231],[444,236],[427,240],[413,248],[402,253],[393,252],[386,245],[382,230],[375,220],[369,214]])],
9: [('green',[[255,289],[261,278],[273,270],[283,272],[291,278],[293,286],[289,298],[280,308],[268,313],[260,311],[255,302]]),
    ('green',[[381,377],[390,368],[403,360],[414,357],[424,362],[432,373],[433,383],[424,391],[411,399],[397,406],[386,409],[380,404],[378,394]])],
}


def main():
    panels = json.loads((PANELS/'sources-1-2-3-4-5-6-7-8-9.json').read_text())
    sources = {}
    for n in range(1,10):
        key = f'angso-{n:02}-hole'
        sources[key] = json.loads((PANELS.parent/(key+'.json')).read_text())
        sources[key]['horizontalCrs'] = 'EPSG:3006'
    review = dict(schemaVersion=1,groundId='angso',reviewedAt='2026-09-09',sources=sources,holes=[],water=[],
                  notes=['Manual visible putting-surface and sand boundaries on the 2025-04-24 orthophoto. Source pixel spacing is not positional accuracy.',
                         'Hole 5 and 7 green edges cross deciduous tree shadows: about 1.5 m interpretation uncertainty. Other putting edges about 0.6 m; sand about 0.4 m.',
                         'All 9 front-nine full-hole panels inspected for sand, including fairway bunkers. Physical tee and fairway review in separate ledgers.'])
    overlays = {}
    def entry(n, kind, ring, suffix):
        if not Polygon(ring).is_valid or Polygon(ring).area <= 1:
            raise ValueError(f'Invalid ring {n} {suffix}')
        key = f'h{n:02}-{kind}'
        source_key = f'angso-{n:02}-hole'
        pt, nt = panels[key]['geoTransform'], sources[source_key]['geoTransform']
        native = [[round((pt[0]+p[0]*pt[1]-nt[0])/nt[1],6),round((pt[3]+p[1]*pt[5]-nt[3])/nt[5],6)] for p in ring]
        value = dict(id=f'angso-{n:02}-{suffix}',sourceKey=source_key,ringPixels=native+[native[0]],
                     reviewedPanel=dict(path=panels[key]['rasterFile'],sha256=panels[key]['sha256'],geoTransform=pt,ringPixels=ring+[ring[0]]),
                     interpretationUncertaintyMetres=1.5 if n in (5,7) and suffix=='green' else (0.6 if suffix=='green' else 0.4))
        if key not in overlays:
            overlays[key] = Image.open(PANELS/(key+'.png')).convert('RGB')
        ImageDraw.Draw(overlays[key]).line(ring+[ring[0]], fill='cyan' if suffix=='green' else 'yellow', width=2)
        return value
    for n in range(1,10):
        green = entry(n,'green',GREENS[n],'green')
        bunkers = [entry(n,kind,ring,f'bunker-{i+1}') for i,(kind,ring) in enumerate(SAND[n])]
        review['holes'].append(dict(n=n,green=green,bunkers=dict(replaceAll=True,sourceKey=f'angso-{n:02}-hole',accepted=bunkers)))
    used = {f['sourceKey'] for h in review['holes'] for f in [h['green'],*h['bunkers']['accepted']]}
    used.update(f'angso-{n:02}-hole' for n in range(1,10))
    review['sources'] = {key:sources[key] for key in sorted(used)}
    path = ROOT/'angsobuild/mapping/lm-review-front9-surfaces.json'
    path.write_text(json.dumps(review,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    for key,img in overlays.items():
        img.save(PANELS/(key+'-accepted.png'))
    print(f'{path}: 9 greens, {sum(len(v) for v in SAND.values())} sand outlines')


if __name__ == '__main__':
    main()
