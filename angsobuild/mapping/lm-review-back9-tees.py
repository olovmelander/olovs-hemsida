"""Native-pixel back-nine physical tee inspection and accepted trace export."""
import importlib.util
import json
from pathlib import Path
import sys
from PIL import Image, ImageDraw
from shapely.geometry import Polygon

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('tee_panels',Path(__file__).with_name('lm-review-front9-tees-water.py'))
helper=importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
helper.OUT=helper.CACHE/'back9-tees'
helper.OUT.mkdir(exist_ok=True)

TRACES={
10:[
 [(504,878),(535,878),(547,891),(551,914),(546,939),(537,952),(517,955),(502,951),(493,939),(493,914),(498,892)],
 [(318,1275),(333,1278),(336,1295),(327,1320),(322,1353),(314,1390),(306,1421),(293,1453),(281,1488),(268,1520),(250,1550),(237,1556),(226,1542),(229,1518),(237,1487),(245,1450),(253,1410),(266,1370),(282,1335),(300,1304)]
],
11:[
 [(267,484),(280,480),(291,486),(299,504),(301,530),(298,553),(288,570),(275,571),(264,558),(259,535),(259,511)],
 [(285,810),(299,813),(306,834),(308,865),(308,901),(309,938),(307,977),(303,1014),(296,1041),(283,1050),(273,1042),(269,1018),(270,981),(270,944),(273,908),(275,871),(279,836)],
 [(255,1134),(271,1129),(284,1138),(291,1159),(294,1185),(289,1204),(278,1218),(261,1222),(249,1215),(242,1194),(241,1173),(245,1150)]
],
12:[
 [(520,429),(537,425),(552,434),(567,449),(581,465),(594,484),(597,497),(587,510),(571,506),(555,489),(540,469),(527,450)],
 [(657,591),(674,594),(691,611),(710,631),(727,651),(733,667),(726,677),(710,673),(694,658),(679,641),(664,622),(654,605)]
],
13:[
 [(435,485),(448,484),(463,501),(478,523),(487,541),(480,553),(463,555),(450,545),(438,529),(430,509)],
 [(652,709),(669,712),(686,740),(704,774),(723,810),(744,846),(764,881),(775,910),(771,929),(755,938),(738,930),(721,908),(705,880),(690,848),(675,814),(665,782),(652,751),(644,726)],
 [(805,1023),(820,1019),(835,1030),(850,1053),(868,1079),(884,1106),(890,1126),(880,1139),(864,1136),(849,1117),(834,1095),(818,1071),(807,1052),(799,1036)]
],
14:[
 [(300,235),(311,234),(320,244),(329,270),(335,302),(341,338),(346,375),(351,408),(347,428),(335,435),(323,424),(317,401),(312,367),(305,332),(299,300),(294,269),(293,249)],
 [(341,628),(355,625),(365,636),(369,655),(366,679),(354,691),(341,687),(335,672),(335,650)],
 [(390,819),(404,817),(414,829),(421,849),(425,869),(421,884),(408,891),(395,883),(386,867),(381,846),(382,828)]
],
15:[
 [(344,517),(355,511),(373,504),(389,503),(399,510),(400,523),(389,534),(369,542),(353,542),(343,533)],
 [(603,347),(622,332),(646,315),(669,299),(695,283),(713,278),(728,285),(736,298),(733,312),(713,327),(687,344),(659,361),(633,376),(617,375),(605,363)],
 [(838,326),(855,320),(879,314),(899,313),(912,321),(917,333),(910,344),(892,350),(868,351),(850,347),(839,338)]
],
16:[
 [(222,251),(238,245),(266,249),(280,249),(291,236),(310,230),(339,230),(367,232),(391,236),(398,247),(399,269),(390,281),(370,285),(339,285),(310,285),(282,285),(258,284),(235,283),(220,275),(215,263)],
 [(526,209),(546,206),(572,210),(599,215),(619,225),(621,236),(609,245),(586,243),(559,239),(535,233),(520,223)],
 [(664,228),(686,231),(710,235),(733,241),(744,248),(743,255),(732,259),(708,256),(684,252),(664,245),(658,237)]
],
17:[
 [(354,244),(366,242),(375,253),(378,272),(377,291),(371,308),(361,316),(349,310),(342,294),(341,274),(346,255)],
 [(428,353),(444,349),(459,356),(470,371),(474,391),(471,418),(460,442),(447,451),(429,449),(416,437),(414,414),(420,381)],
 [(411,578),(425,576),(436,587),(440,603),(437,619),(427,628),(413,625),(406,613),(405,595)],
 [(238,752),(249,750),(259,761),(261,782),(256,803),(251,825),(242,840),(228,841),(219,832),(218,817),(224,794),(230,770)]
],
18:[
 [(250,293),(262,288),(274,298),(283,319),(290,342),(292,362),(283,377),(270,377),(259,363),(250,343),(245,320),(245,304)],
 [(385,600),(399,598),(413,612),(426,631),(435,651),(437,668),(427,680),(413,678),(401,665),(390,647),(381,627),(378,610)],
 [(568,918),(581,916),(593,929),(606,948),(618,969),(619,982),(607,993),(593,989),(581,972),(571,953),(564,934)],
 [(715,1110),(728,1107),(738,1120),(744,1140),(750,1164),(745,1182),(731,1187),(718,1177),(711,1157),(706,1133),(708,1118)]
]}

NOTES={
10:'Two physically visible surfaces: one forward oval and one long contiguous rear platform. The rear edge is partly under bare-tree shadows; no artificial subdivision is inferred.',
11:'Three visible platforms; the middle platform is contiguous across tree shadows. Colour identities and exact marker positions remain unverified.',
12:'Two visible mown platforms along the path. Tree shadows partly obscure both; short obscured edges follow the visible cut-grass border. The bright rough/apron east of the rear platform is excluded.',
13:'Three visible mown platforms. The long middle platform and the rear platform are distinct; old rectangles over the path and rough are superseded. Local shadow edges remain uncertain.',
14:'Three visible cut-grass platforms including a small middle platform partly affected by shadow. The much larger pale surrounding turf is excluded.',
15:'Three separate cut-grass platforms, including the forward oval near the pond and the rear oval across the path. No colour association is asserted.',
16:'Three visible continuous platforms. The western surface has two contiguous mown lobes combined in one ring; the eastern narrow strip is separately traced after native-resolution inspection. Its upper edge has weaker contrast than the large western surface.',
17:'Four visible cut-grass platforms around the pond and path. The former narrow DTM polygon farther down the fairway has no separate visible tee border and is excluded.',
18:'Four visible cut-grass platforms; two forward platforms were omitted or misplaced in the legacy set. Tree shadows partly cover the rear platforms.'
}

def export_review():
    review=dict(schemaVersion=1,groundId='angso',reviewedAt='2026-09-09',
        method='Manual native 0.16 m pixel-edge inspection of physical mown tee platforms in the 2025-04-24 Lantmateriet capture.',
        sources={},holes=[],limitations=[
        'The imagery establishes visible mown platform boundaries, not official tee colours or permanent marker locations.',
        'Short boundary sections under bare-tree shadows are interpolated between visible adjacent turf edges; these local edges remain uncertain.',
        'Contiguous mown surfaces remain one polygon where physical subdivision is not visible.',
        'Complete replacement records the physically visible inventory in this capture; field inspection may reveal seasonal or obscured platforms.'])
    for n,rings in TRACES.items():
        key=f'angso-{n:02}-hole'
        source=json.loads((helper.CACHE/(key+'.json')).read_text(encoding='utf-8'))
        source['horizontalCrs']='EPSG:3006'
        source['sourceIds']=[s['id'] for s in source['sources']]
        review['sources'][key]=source
        meta=json.loads((helper.OUT/f'h{n:02}-tees.json').read_text())
        entries=[]
        accepted=Image.open(helper.OUT/f'h{n:02}-tees.png').convert('RGB')
        draw=ImageDraw.Draw(accepted)
        for i,ring in enumerate(rings):
            points=[[meta['box'][0]+x*meta['scale'],meta['box'][1]+y*meta['scale']] for x,y in ring]
            points.append(points[0])
            polygon=Polygon(points)
            assert polygon.is_valid and polygon.area>1,(n,i)
            assert all(0<=x<=source['width'] and 0<=y<=source['height'] for x,y in points)
            entries.append(dict(id=f'lm-angso-{n:02}-physical-tee-{i+1:02}',sourceKey=key,ringPixels=points,
                interpretation='visible-mown-physical-platform',colourAssociation='unverified'))
            draw.line(ring+[ring[0]],fill='cyan',width=2)
            draw.text(ring[0],str(i+1),fill='white',stroke_width=1,stroke_fill='black')
        accepted.save(helper.OUT/f'h{n:02}-tees-accepted.png')
        review['holes'].append(dict(n=n,tees=dict(replaceAll=True,sourceKey=key,accepted=entries,
            identityStatus='unverified-colour-association',note=NOTES[n])))
    target=ROOT/'angsobuild/mapping/lm-review-back9-tees.json'
    target.write_text(json.dumps(review,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(output=str(target.relative_to(ROOT)),holes=len(review['holes']),teePads=sum(len(h['tees']['accepted']) for h in review['holes']))))

if __name__=='__main__':
    if '--write-review' in sys.argv:
        export_review()
        sys.exit()
    for n in range(10,19):
        hole=next(h for h in helper.MODEL['holes'] if h['n']==n)
        points=[helper.projected(p) for pad in hole['tees']['pads'] for p in pad['ring']]
        points += [helper.projected(mark['c']) for mark in hole['tees']['marks']]
        helper.panel(f'h{n:02}-tees',points,f'angso-{n:02}-hole',padding=35)
    print(helper.OUT)
