"""Reproducible native-pixel panels for physical tee and wet-edge review."""
import hashlib
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw
from pyproj import Transformer

ROOT=Path(__file__).resolve().parents[2]
CACHE=ROOT/'angsobuild/cache/lm-ortho'
OUT=CACHE/'front9-tees-water'
OUT.mkdir(exist_ok=True)
PLAN=json.loads((CACHE/'plan.json').read_text(encoding='utf-8'))
MODEL=json.loads((ROOT/'angsobuild/course-model.json').read_text(encoding='utf-8'))
PROJECT=Transformer.from_crs(4326,3006,always_xy=True)

def panel(key, points, source_key, padding=25, scale=1, explicit_box=None):
    source=next(w for w in PLAN['windows'] if w['id']==source_key)
    bounds=source['boundsEpsg3006']
    resolution=source['resolutionMetres']
    pixels=[((p[0]-bounds[0])/resolution,(bounds[3]-p[1])/resolution) for p in points]
    margin=padding/resolution
    box=[max(0,int(min(p[0] for p in pixels)-margin)),max(0,int(min(p[1] for p in pixels)-margin)),
         min(source['width'],int(max(p[0] for p in pixels)+margin)),min(source['height'],int(max(p[1] for p in pixels)+margin))]
    if explicit_box is not None:
        box=list(explicit_box)
    width=(box[2]-box[0])//scale
    height=(box[3]-box[1])//scale
    box[2]=box[0]+width*scale
    box[3]=box[1]+height*scale
    record=dict(key=key,sourceKey=source_key,box=box,scale=scale,width=width,height=height)
    for overlay in [False,True]:
        suffix='-overlay' if overlay else ''
        im=Image.open(CACHE/(source_key+suffix+'.png')).crop(box)
        if scale!=1:
            im=im.resize((width,height),Image.Resampling.LANCZOS)
        draw=ImageDraw.Draw(im,'RGBA')
        for x in range(0,width,50):
            draw.line((x,0,x,height),fill=(255,255,255,50))
            draw.text((x+2,2),str(x),fill='white',stroke_width=1,stroke_fill='black')
        for y in range(50,height,50):
            draw.line((0,y,width,y),fill=(255,255,255,50))
            draw.text((2,y+2),str(y),fill='white',stroke_width=1,stroke_fill='black')
        im.save(OUT/(key+suffix+'.png'))
    (OUT/(key+'.json')).write_text(json.dumps(record,indent=2)+'\n')
    return record

def projected(p):
    return PROJECT.transform(MODEL['origin']['lon']+p[0]/MODEL['mPerLon'],MODEL['origin']['lat']-p[1]/MODEL['mPerLat'])

TEE_TRACES={
1:('h01-extended',[
 [(532,281),(558,283),(578,294),(584,315),(578,337),(569,353),(549,368),(523,373),(507,359),(504,337),(515,306)],
 [(381,540),(409,548),(415,571),(410,611),(397,650),(388,668),(366,668),(364,641),(372,600)],
 [(366,1009),(397,1018),(397,1049),(387,1076),(374,1092),(350,1088),(342,1074),(348,1043)]
]),
2:('h02-tees',[
 [(181,245),(203,241),(256,241),(302,237),(346,237),(347,264),(302,270),(254,274),(210,276),(185,271)],
 [(778,209),(810,209),(841,215),(849,225),(844,240),(815,244),(782,239),(767,231),(769,216)]
]),
3:('h03-tees',[
 [(304,192),(320,188),(348,196),(378,211),(385,224),(375,242),(352,240),(324,227),(304,217)],
 [(559,330),(587,326),(632,336),(682,351),(709,365),(710,395),(698,417),(670,422),(632,410),(601,389),(580,362)]
]),
4:('h04-tees',[
 [(490,279),(512,285),(514,308),(502,341),(489,355),(465,347),(467,323),(478,293)],
 [(282,712),(309,720),(312,744),(297,788),(281,825),(267,859),(254,898),(240,930),(230,955),(210,970),(197,963),(207,941),(227,924),(239,903),(247,869),(258,833),(265,799),(270,754)]
]),
5:('h05-tees',[
 [(270,128),(291,126),(301,137),(301,171),(290,187),(269,186),(261,172),(262,144)],
 [(269,280),(289,276),(307,284),(309,318),(305,362),(309,402),(305,440),(287,451),(264,445),(256,428),(255,388),(258,344),(258,300)],
 [(277,696),(305,696),(317,707),(315,737),(307,766),(284,776),(268,763),(266,731)]
]),
6:('h06-tees',[
 [(500,507),(519,503),(539,520),(550,545),(545,564),(528,571),(511,554),(500,531)],
 [(650,661),(667,652),(692,672),(701,691),(691,708),(672,706),(650,687),(642,674)],
 [(709,776),(731,771),(751,785),(757,802),(746,820),(726,822),(708,807),(701,791)]
]),
7:('h07-tees',[
 [(351,951),(368,955),(381,973),(391,995),(389,1010),(375,1018),(361,1009),(350,987),(344,967)],
 [(835,1163),(852,1164),(870,1182),(884,1200),(878,1216),(862,1219),(843,1208),(824,1189),(822,1176)],
 [(912,1292),(932,1295),(947,1312),(954,1336),(942,1352),(925,1354),(910,1340),(904,1316)]
]),
8:('h08-tees',[
 [(202,485),(223,490),(242,505),(241,522),(225,531),(206,527),(193,518),(191,500)],
 [(240,554),(260,558),(270,574),(267,591),(251,600),(236,592),(226,577),(229,563)],
 [(263,767),(285,770),(296,786),(293,808),(284,827),(268,835),(254,826),(252,807),(256,785)]
]),
9:('h09-tees',[
 [(302,240),(325,245),(342,258),(341,284),(334,316),(326,344),(312,358),(292,357),(279,340),(282,312),(290,283)],
 [(235,416),(260,426),(263,447),(254,477),(244,498),(225,492),(219,474),(224,447)]
])}

WATER_TRACES={
't1':[(121,103),(151,101),(185,109),(213,124),(249,133),(281,154),(309,171),(337,164),(349,156),(379,163),(396,181),(399,213),(384,244),(358,264),(339,279),(317,290),(287,297),(255,298),(231,291),(210,268),(193,243),(168,230),(139,210),(115,195),(105,172),(103,145),(111,118)],
't2':[(289,113),(312,111),(333,120),(347,133),(341,150),(321,164),(306,176),(297,192),(294,217),(295,244),(298,272),(309,295),(324,316),(319,333),(303,344),(276,359),(251,377),(222,391),(196,398),(165,401),(139,397),(121,390),(112,380),(114,362),(129,351),(151,349),(179,351),(199,345),(220,334),(234,318),(241,294),(244,265),(243,227),(246,190),(254,162),(265,138),(277,120)],
't3':[(129,126),(151,128),(174,139),(201,148),(229,145),(252,133),(277,115),(302,102),(330,94),(354,95),(373,109),(384,132),(387,156),(382,182),(368,207),(351,230),(331,247),(316,270),(304,295),(298,326),(299,360),(298,393),(290,423),(279,444),(258,456),(231,463),(203,466),(174,461),(148,451),(126,436),(110,412),(102,384),(101,358),(114,329),(128,299),(133,271),(131,245),(118,220),(102,198),(95,176),(94,156),(103,138)],
't4':[(113,101),(140,95),(165,109),(187,130),(210,144),(224,166),(226,193),(228,218),(214,239),(199,253),(190,274),(172,269),(158,258),(135,250),(115,236),(102,217),(96,191),(96,161),(98,132)],
't5':[(131,119),(151,118),(172,126),(188,144),(201,166),(208,190),(200,214),(182,231),(158,243),(136,248),(115,237),(102,220),(95,197),(94,172),(103,145),(116,128)],
't6':[(263,405),(280,413),(294,433),(297,461),(296,494),(296,527),(299,557),(301,588),(293,615),(279,634),(260,641),(244,632),(240,613),(239,580),(240,550),(245,521),(250,493),(247,467),(244,441),(250,421)],
't7':[(113,101),(129,106),(147,123),(158,143),(167,165),(170,187),(164,210),(151,228),(138,233),(124,226),(112,219),(111,199),(114,180),(109,157),(104,140),(101,119)],
't8':[(128,102),(142,105),(150,120),(150,145),(146,173),(148,196),(158,217),(175,233),(185,250),(184,269),(173,281),(151,281),(133,273),(119,260),(112,240),(107,216),(102,194),(100,168),(104,141),(111,119)]}

def write_review():
    from shapely.geometry import Polygon
    review=dict(schemaVersion=1,groundId='angso',reviewedAt='2026-09-09',
                method='Manual visible physical tee-pad and open-water-edge review in native 0.16m Lantmateriet imagery; exact native pixel-edge rings.',
                sources={},holes=[],water=[],limitations=[
                    'Tee colours and official marker locations cannot be established from these photographs; all colour associations remain unverified.',
                    'The 2025-04-24 wet edge is seasonal and does not determine hazard markings or water level.',
                    'Tee surfaces under tree shadows (especially holes 7 and 8) have locally uncertain edges; short occlusions are interpolated between visible turf edges.',
                    'Contiguous mown tee surfaces are single polygons where physical subdivision is not visible.',
                    'Surrounding lakes, remote ponds, streams and canopy were not re-traced in this review.'])
    def feature(panel_key,identity,points):
        panel_meta=json.loads((OUT/(panel_key+'.json')).read_text())
        key=panel_meta['sourceKey']
        source=json.loads((CACHE/(key+'.json')).read_text())
        source['horizontalCrs']='EPSG:3006'
        source['sourceIds']=[s['id'] for s in source['sources']]
        review['sources'][key]=source
        box=panel_meta['box'];scale=panel_meta['scale']
        pixels=[[box[0]+p[0]*scale,box[1]+p[1]*scale] for p in points]
        pixels.append(pixels[0])
        assert Polygon(pixels).is_valid and Polygon(pixels).area>1
        assert all(0<=p[0]<=source['width'] and 0<=p[1]<=source['height'] for p in pixels)
        return dict(id=identity,sourceKey=key,ringPixels=pixels)
    for n,(panel_key,rings) in TEE_TRACES.items():
        entries=[feature(panel_key,f'lm-angso-{n:02}-physical-tee-{index+1:02}',ring) for index,ring in enumerate(rings)]
        review['holes'].append(dict(n=n,tees=dict(replaceAll=True,sourceKey=entries[0]['sourceKey'],accepted=entries,
                                                 identityStatus='unverified-colour-association')))
    for identity,points in WATER_TRACES.items():
        entry=feature('water-'+identity,'lm-angso-water-'+identity,points)
        entry['replaceId']=identity
        if identity in ('t6','t7','t8'):
            entry['note']='Accepted visible open-water edge; historic ring includes woodland/reeds whose wetness is not established by this image.'
        review['water'].append(entry)
    target=ROOT/'angsobuild/mapping/lm-review-front9-tees-water.json'
    target.write_text(json.dumps(review,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(output=str(target.relative_to(ROOT)),teePads=sum(len(h['tees']['accepted']) for h in review['holes']),water=len(review['water']))))

if __name__=='__main__' and '--write-review' in sys.argv:
    write_review()
elif __name__=='__main__':
    # Pinned display boxes reproduce the review after course geometry changes.
    definitions=[
        ('h01-tees',1,[618,156,1054,1391]),('h01-extended',1,[550,0,1212,1400]),
        ('h02-tees',2,[157,432,1330,845]),('h03-tees',3,[749,527,1614,1111]),
        ('h04-tees',4,[164,1655,866,2812]),('h05-tees',5,[259,156,743,1713]),
        ('h06-tees',6,[532,1340,1506,2359]),('h07-tees',7,[344,2234,1477,3766]),
        ('h08-tees',8,[505,156,929,1430]),('h09-tees',9,[324,218,809,1074]),
        ('water-t1',2,[2214,2,2853,461]),('water-t2',5,[1063,1275,1526,1799]),
        ('water-t3',15,[533,601,1021,1156]),('water-t4',17,[545,2298,872,2666]),
        ('water-t5',17,[465,2125,793,2481]),('water-t6',17,[324,72,702,800]),
        ('water-t7',18,[811,1756,1084,2125]),('water-t8',18,[882,1941,1386,2804])]
    records=[]
    for key,n,box in definitions:
        source=next(w for w in PLAN['windows'] if w.get('hole')==n)
        b=source['boundsEpsg3006']
        records.append(panel(key,[(b[0],b[1]),(b[2],b[3])],source['id'],padding=0,explicit_box=box))
    print(json.dumps(records))
