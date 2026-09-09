"""Native TIFF pixel-edge fairway traces, reviewed on exact-affine display panels."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw
from shapely.geometry import Polygon

ROOT=Path(__file__).resolve().parents[2]
CACHE=ROOT/'angsobuild/cache/lm-ortho'
PANELS=CACHE/'review-panels'
OUT=CACHE/'front9-fairways'
OUT.mkdir(exist_ok=True)
PANEL_SOURCES=json.loads((PANELS/'sources-1-2-3-4-5-6-7-8-9.json').read_text())

TRACES={
1:[[(385,596),(408,597),(429,610),(439,634),(437,660),(429,688),(431,719),(432,744),(421,770),(404,793),(397,818),(388,851),(378,883),(372,918),(367,950),(361,982),(354,1016),(344,1051),(334,1090),(321,1130),(306,1164),(290,1197),(276,1226),(257,1248),(240,1261),(218,1260),(212,1245),(224,1215),(236,1178),(247,1135),(256,1092),(266,1048),(276,1004),(281,961),(289,918),(298,877),(305,838),(318,798),(337,765),(355,735),(366,708),(364,680),(357,653),(356,632),(364,611)]],
2:[[(587,259),(609,257),(631,266),(652,282),(680,294),(710,302),(741,310),(775,315),(811,312),(845,305),(879,295),(913,284),(947,274),(980,263),(1016,253),(1052,247),(1082,246),(1112,243),(1141,235),(1170,224),(1190,211),(1199,228),(1189,249),(1172,267),(1147,281),(1117,293),(1086,308),(1054,319),(1022,330),(988,340),(953,350),(919,358),(884,365),(853,369),(826,374),(795,379),(764,383),(735,384),(705,381),(676,375),(647,365),(620,352),(595,340),(574,327),(559,311),(556,294),(566,274)]],
3:[[(267,268),(294,276),(324,286),(355,294),(384,301),(415,308),(446,311),(467,318),(480,332),(478,346),(463,357),(441,362),(416,360),(388,352),(361,342),(333,331),(307,318),(282,307),(256,295),(243,284),(245,271)]],
4:[[(335,922),(357,925),(375,911),(385,887),(389,856),(385,825),(385,793),(390,762),(400,731),(415,704),(432,679),(446,650),(458,618),(465,585),(473,550),(477,517),(477,488),(470,459),(460,432),(445,405),(428,383),(409,363),(390,349),(367,350),(349,357),(337,375),(341,394),(352,415),(364,438),(376,463),(383,490),(384,516),(380,542),(371,568),(365,599),(361,628),(354,659),(348,691),(344,723),(340,755),(334,785),(329,815),(324,846),(321,877),(324,904)]],
5:[[(249,579),(278,583),(292,603),(299,629),(301,658),(295,699),(292,746),(297,789),(305,828),(321,867),(341,901),(365,935),(393,963),(426,992),(454,1021),(486,1051),(519,1082),(552,1114),(584,1145),(616,1178),(644,1211),(670,1247),(693,1288),(711,1324),(723,1358),(725,1390),(732,1424),(748,1454),(738,1472),(713,1462),(693,1429),(674,1397),(654,1365),(633,1333),(606,1302),(577,1272),(547,1244),(513,1215),(482,1187),(451,1159),(422,1131),(392,1103),(365,1072),(339,1044),(315,1016),(294,987),(274,956),(257,923),(244,888),(234,851),(226,810),(219,770),(216,729),(217,691),(221,658),(227,627),(237,596)]],
6:[[(399,782),(418,779),(432,765),(435,743),(422,716),(405,686),(389,656),(374,626),(356,597),(342,569),(330,543),(322,518),(310,498),(292,486),(277,477),(266,463),(275,450),(291,445),(305,438),(320,423),(339,407),(353,391),(366,371),(376,349),(381,324),(381,298),(375,277),(356,264),(337,267),(327,286),(310,306),(289,322),(267,339),(247,357),(229,377),(214,401),(204,428),(201,452),(208,478),(216,508),(229,537),(242,565),(258,595),(277,626),(298,659),(320,691),(341,723),(363,754),(382,774)]],
7:[[(344,1478),(364,1479),(379,1466),(380,1447),(370,1421),(355,1391),(339,1362),(322,1334),(307,1305),(293,1274),(281,1243),(274,1211),(275,1176),(283,1142),(286,1108),(286,1077),(291,1044),(298,1011),(305,977),(314,944),(320,913),(325,879),(332,846),(342,815),(349,784),(352,751),(354,717),(358,685),(363,650),(369,617),(374,584),(382,552),(389,520),(391,489),(390,460),(387,432),(383,405),(380,378),(376,352),(370,329),(348,320),(326,322),(314,341),(310,368),(307,396),(303,426),(300,457),(296,488),(289,520),(282,551),(277,583),(274,616),(270,650),(269,683),(266,714),(264,746),(256,776),(247,806),(237,836),(226,867),(216,899),(211,933),(205,966),(201,999),(196,1032),(190,1068),(184,1103),(179,1138),(176,1173),(175,1207),(179,1239),(191,1270),(207,1298),(225,1327),(244,1356),(265,1387),(287,1418),(308,1448),(325,1468)]],
8:[[(325,655),(347,652),(365,665),(377,684),(382,705),(381,733),(376,758),(365,782),(349,803),(335,825),(325,850),(314,880),(303,911),(292,943),(281,974),(271,1006),(264,1039),(258,1073),(252,1108),(246,1143),(240,1170),(231,1197),(214,1211),(191,1210),(179,1196),(184,1172),(191,1144),(200,1111),(207,1078),(212,1047),(217,1014),(221,981),(224,949),(227,918),(231,889),(237,861),(246,835),(263,810),(278,786),(290,762),(299,735),(304,708),(309,683),(315,666)]],
9:[[(235,475),(254,470),(271,481),(279,504),(281,528),(275,551),(263,571),(248,581),(230,580),(214,566),(207,546),(209,523),(219,497)]]
}

def source(n):
    key=f'angso-{n:02}-hole'
    ledger=json.loads((CACHE/(key+'.json')).read_text())
    ledger['horizontalCrs']='EPSG:3006'
    ledger['sourceIds']=[s['id'] for s in ledger['sources']]
    return key,ledger

def display(n,accepted=False):
    key=f'h{n:02}-hole'
    im=Image.open(PANELS/(key+'.png')).convert('RGB')
    assert hashlib.sha256((PANELS/(key+'.png')).read_bytes()).hexdigest()==PANEL_SOURCES[key]['sha256']
    draw=ImageDraw.Draw(im,'RGBA')
    for x in range(0,im.width,50):
        draw.line((x,0,x,im.height),fill=(255,255,255,50))
        draw.text((x+2,2),str(x),fill='white',stroke_width=1,stroke_fill='black')
    for y in range(50,im.height,50):
        draw.line((0,y,im.width,y),fill=(255,255,255,50))
        draw.text((2,y+2),str(y),fill='white',stroke_width=1,stroke_fill='black')
    if accepted:
        for ring in TRACES.get(n,[]):
            draw.line(ring+[ring[0]],fill='cyan',width=2)
    target=OUT/(key+('-accepted' if accepted else '')+'.png')
    im.save(target)

def write_review():
    review=dict(schemaVersion=1,groundId='angso',reviewedAt='2026-09-09',sources={},holes=[],
                method='Manual short-mown fairway and approach boundaries interpreted from 2025-04-24 Lantmateriet RGBI, using exact-affine 0.32m display panels and native TIFF source hashes.',
                limitations=['Spring turf colour and shadows leave some local mowing boundaries uncertain.',
                             'Where fairway meets the putting-green surround without a distinct mowing break, the approach ends at the visible green apron.',
                             'Image coordinates are native pixel edges; native GSD is not survey accuracy.'])
    for n,rings in TRACES.items():
        key,ledger=source(n)
        review['sources'][key]=ledger
        panel_key=f'h{n:02}-hole'
        panel=PANEL_SOURCES[panel_key]
        t,pt=ledger['geoTransform'],panel['geoTransform']
        entries=[]
        for index,ring in enumerate(rings):
            pixels=[[round((pt[0]+p[0]*pt[1]-t[0])/t[1],6),round((pt[3]+p[1]*pt[5]-t[3])/t[5],6)] for p in ring]
            pixels.append(pixels[0])
            assert Polygon(pixels).is_valid and Polygon(pixels).area>1
            assert all(0<=p[0]<=ledger['width'] and 0<=p[1]<=ledger['height'] for p in pixels)
            entries.append(dict(id=f'lm-angso-{n:02}-fairway-{index+1:02}',sourceKey=key,ringPixels=pixels,
                                reviewedPanel=dict(key=panel_key,sha256=panel['sha256'],geoTransform=pt)))
        review['holes'].append(dict(n=n,fairways=dict(replaceAll=True,sourceKey=key,accepted=entries)))
        display(n,accepted=True)
    target=ROOT/'angsobuild/mapping/lm-review-front9-fairways.json'
    target.write_text(json.dumps(review,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(output=str(target.relative_to(ROOT)),holes=len(review['holes']),fairways=sum(len(h['fairways']['accepted']) for h in review['holes']))))

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--write-review',action='store_true')
    args=parser.parse_args()
    if args.write_review:
        write_review()
    else:
        for n in range(1,10):display(n)
