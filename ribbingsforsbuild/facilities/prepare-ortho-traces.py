"""Reproduce manually reviewed native-pixel facility traces and review overlays.

Roof rings describe visible eaves, not surveyed wall footprints. No inferred
height is encoded. Image pixels are never resampled or used as runtime textures.
"""
from pathlib import Path
import json
import math
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).parent
REFERENCE=HERE/'reference'
manifest=json.loads((REFERENCE/'orthophoto-manifest.json').read_text(encoding='utf8'))
panels={p['id']:p for p in manifest['panels']}
features=[]


def add(ident,kind,panel,ring,confidence='high',note='',**extra):
    p=panels[panel]
    r=p['pixelSizeMetres'];b=p['boundsEpsg3006'];origin=manifest['frame']['originEpsg3006']
    xy=[[round(b[0]+u*r-origin[0],4),round(b[3]-v*r-origin[1],4)] for u,v in ring]
    item=dict(id=ident,kind=kind,panelId=panel,ringPixels=ring,ringBlenderXY=xy,
        ringEngineXZ=[[x,-y] for x,y in xy],
        ringEpsg3006=[[round(x+origin[0],4),round(y+origin[1],4)] for x,y in xy],
        centerBlenderXY=[round(sum(v[a] for v in xy)/len(xy),4) for a in range(2)],
        confidence=confidence,note=note or 'Manually reviewed native orthophoto pixels; visible roof edge excludes cast shadow.',
        sourceCaptureDate='2024-05-17',readingUncertaintyMetres=.5,**extra)
    features.append(item)


def ellipse(ident,panel,cx,cy,rx,ry,note):
    add(ident,'practice-green',panel,[[round(cx+rx*math.cos(i*math.tau/24),2),round(cy+ry*math.sin(i*math.tau/24),2)] for i in range(24)],
        'medium',note,geometryStatus='approximate perimeter from visibly mown surface')


add('clubhouse-main','roof','clubhouse-close',[[283,316],[385,341],[370,396],[269,373]],
    note='Single gabled clubhouse roof, with terrace to south/west. Dark north rectangle is a cast shadow, not an annex.',roofForm='gable',roofColour='weathered grey-brown')
add('clubhouse-terrace','terrace','clubhouse-close',[[250,334],[276,341],[268,374],[370,398],[359,429],[340,440],[278,424],[276,411],[244,404],[227,374],[237,362]],
    'medium','Visible hard terrace/deck surrounds west and south sides. Furniture and umbrellas are excluded from building footprint.')
add('clubhouse-south-timber-platform-west','platform','clubhouse-close',[[316,452],[378,469],[374,493],[310,476]],
    'medium','Rectangular timber-looking platform south of access road, separate from clubhouse terrace; functional use unconfirmed.')
add('clubhouse-south-timber-platform-east','platform','clubhouse-close',[[388,473],[438,486],[431,508],[381,494]],
    'medium','Second timber-looking platform south of road. Do not infer a roof.')
ellipse('clubhouse-practice-green','clubhouse-close',519,384,113,91,
    'Clearly visible mown practice putting surface east of clubhouse; ellipse is a review approximation, not a final terrain boundary.')

add('range-shelter','roof','range-mats-detail',[[256,49],[362,34],[367,66],[262,81]],
    note='Long narrow gable roof over covered driving range bays. North dark band above this ring is cast shadow.',roofForm='gable',roofColour='weathered grey-brown')
add('range-apron','range-apron','range-mats-detail',[[22,90],[255,58],[262,82],[26,105]],
    note='Concrete-looking open tee apron aligned with the shelter; all nine visible open mats lie on this strip.')
for i,(x,y) in enumerate([(85,91),(106,88),(125,85),(145,82),(165,80),(185,77),(205,75),(225,72),(245,69)],1):
    add(f'range-mat-{i:02d}','range-mat','range-mats-detail',[[x-4,y-4],[x+4,y-4],[x+4,y+4],[x-4,y+4]],
        note='Visible open tee mat center. First five appear round, final four rectangular; ring is a position envelope.',
        centerPixels=[x,y],matShape='round' if i<=5 else 'rectangular',pointPositionPreferred=True)
ellipse('range-practice-green','range-tee-close',1038,70,139,65,
    'Distinct oval mown putting/practice surface north of range shelter. Current terrain role to corroborate with official photos.')

# Manor estate: material names describe image appearance, not unobserved walls.
add('manor-main','roof','manor-close',[[473,699],[567,719],[528,906],[434,886]],
    note='Main manor roof, elongated north/south; white triangular cross-gable/pediment roof details visible on both long sides.',
    roofForm='complex-gabled',roofColour='pale weathered grey')
add('manor-west-conservatory','roof','manor-close',[[422,748],[459,756],[445,823],[408,815]],
    'medium','Glazed or ribbed lean-to roof attached to west side of manor. Partly in shadow.',roofForm='lean-to',roofColour='grey translucent')
add('manor-wing-north','roof','manor-close',[[695,647],[817,675],[807,727],[683,700]],
    roofForm='gable',roofColour='pale weathered grey')
add('manor-wing-north-west-porch','roof','manor-close',[[674,660],[695,665],[688,694],[668,690]],
    'medium','Small visible roof projection on west side of north wing.',roofForm='lean-to',roofColour='grey')
add('manor-wing-south','roof','manor-close',[[611,981],[732,1006],[714,1070],[594,1042]],
    roofForm='gable',roofColour='pale weathered grey')
add('manor-wing-south-porch','roof','manor-close',[[643,1039],[673,1045],[668,1063],[638,1058]],
    'medium','Small projecting porch roof at south wing entrance.',roofForm='gable',roofColour='pale grey')
add('manor-garden-hut-west','roof','manor-close',[[347,578],[395,589],[390,616],[340,606]],
    roofForm='gable',roofColour='muted red-brown')
add('manor-small-shed-north','roof','manor-close',[[609,624],[644,632],[637,668],[603,661]],
    roofForm='gable',roofColour='dark grey')
add('manor-outbuilding-east-south','roof','manor-close',[[951,560],[1032,580],[1018,629],[937,607]],
    roofForm='gable',roofColour='muted red-brown')
add('manor-outbuilding-east-north','roof','manor-close',[[1036,517],[1063,527],[1049,572],[1022,562]],
    roofForm='gable',roofColour='muted red-brown')
add('lakeside-boathouse','roof','manor-close',[[210,77],[297,75],[304,136],[214,141]],
    'medium','Boathouse roof at shore; west eave/side structure is partly obscured. Functional boathouse label inferred from shoreline placement.',
    roofForm='gable',roofColour='weathered grey-brown')
add('lakeside-pier','pier','manor-close',[[349,12],[385,9],[393,62],[387,119],[374,169],[344,161],[355,103]],
    'medium','Visible pier/breakwater outline; use with lake water elevation, not land-ground sample.')

add('estate-barn-north','roof','estate-close',[[245,304],[465,355],[434,459],[222,406]],
    roofForm='gable',roofColour='orange red metal')
add('estate-barn-east','roof','estate-close',[[491,448],[582,468],[521,696],[431,675]],
    roofForm='gable',roofColour='weathered grey-brown')
add('estate-barn-south','roof','estate-close',[[181,580],[391,631],[365,737],[155,686]],
    roofForm='gable',roofColour='weathered grey-brown')
add('estate-shed-east','roof','estate-close',[[597,589],[653,603],[598,811],[543,797]],
    roofForm='gable',roofColour='weathered grey-brown')
add('estate-courtyard','yard','estate-close',[[207,429],[438,484],[457,569],[426,703],[362,771],[255,742],[289,687],[362,634],[194,584]],
    'medium','Visible farm courtyard and hardstanding between three large roofs; includes concrete storage pad.')
add('estate-outbuilding-northwest','roof','estate-north-close',[[404,432],[466,451],[414,609],[353,590]],
    roofForm='gable',roofColour='muted red-brown')
add('estate-outbuilding-northeast','roof','estate-north-close',[[703,491],[777,510],[745,627],[669,608]],
    roofForm='gable',roofColour='silver metal')
add('estate-small-l-wing-west','roof','estate-north-close',[[264,674],[302,685],[287,727],[250,717]],
    'medium','West segment of small L-shaped outbuilding, partially tree obscured.',roofForm='gable',roofColour='muted red-brown')
add('estate-small-l-wing-east','roof','estate-north-close',[[297,699],[350,715],[340,745],[287,729]],
    'medium','East segment of same L-shaped outbuilding, partially tree obscured.',roofForm='gable',roofColour='muted red-brown')

add('maintenance-north-shelter','roof','maintenance-close',[[390,277],[510,283],[510,316],[387,309]],
    note='Short roof only at north end of fenced open arena; prior tall long building trace confused arena surface with roof.',
    roofForm='gable',roofColour='dark grey metal')
add('maintenance-east-shed','roof','maintenance-close',[[530,567],[594,570],[585,739],[522,734]],
    roofForm='gable',roofColour='silver corrugated metal')
add('maintenance-south-shed','roof','maintenance-close',[[514,830],[550,836],[536,906],[501,899]],
    roofForm='gable',roofColour='dark grey metal')
add('maintenance-small-green-shed','roof','maintenance-close',[[355,568],[386,570],[381,607],[347,603]],
    'medium','Small green roof west of main silver shed.',roofForm='gable',roofColour='green metal')
add('maintenance-southern-hut','roof','maintenance-close',[[381,1055],[398,1051],[403,1077],[385,1083]],
    'medium','Small freestanding hut at southern yard entrance.',roofForm='gable',roofColour='dark grey')
add('maintenance-open-arena','arena','maintenance-close',[[389,312],[510,317],[497,560],[375,552]],
    note='Open fenced sand/aggregate arena or paddock. Clearly no enclosing roof. Functional use is an interpretation.')
add('maintenance-yard','yard','maintenance-close',[[389,246],[526,255],[548,382],[704,408],[637,659],[540,927],[447,1028],[285,1004],[198,926],[210,642],[257,540],[359,542]],
    'medium','Visible general gravel hardstanding; exclude roof and arena sub-polygons during final surfacing.')

report=dict(schemaVersion=1,groundId='ribbingsfors',reviewedAt='2026-09-10',
    sourceManifest='ribbingsforsbuild/facilities/reference/orthophoto-manifest.json',frame=manifest['frame'],
    method='Visual tracing of native 0.16 metre RGB source panels. All ringPixels use continuous pixel-edge coordinates.',
    features=features,
    rejectedInheritedFeatures=[dict(id='ribbingsfors-clubhouse-annex',reason='Dark rectangle north of single clubhouse roof is cast shadow, not a separate roof.'),
        dict(id='ribbingsfors-yard-0',reason='Large footprint covers an open arena; only a narrow roof along its north boundary is supported.'),
        dict(id='ribbingsfors-manor-farm-2',reason='Inherited farm trace overlaps concrete storage pad and shadows, not a distinct visible roof.'),
        dict(id='ribbingsfors-manor-farm-3',reason='Inherited farm trace overlaps north cast shadow of south barn, not a distinct visible roof.')],
    limitations=['No roof heights or wall heights measured here.',
        'Visible roof outline may differ from wall footprint due to overhang and off-nadir relief.',
        'Confidence refers to image identification, not surveyed positional accuracy.',
        'Small attached parts can overlap main roof polygons and must not create duplicate full buildings.',
        'Ground or facade photos may show changes since 2024-05-17.'])
out=REFERENCE/'reviewed-ortho-traces.json'
out.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',14)
for ident,panel in panels.items():
    selected=[f for f in features if f['panelId']==ident]
    if not selected:continue
    img=Image.open(ROOT/panel['png']).convert('RGB');draw=ImageDraw.Draw(img)
    for f in selected:
        pts=[tuple(p) for p in f['ringPixels']]
        colour='#ff9c40' if f['kind']=='roof' else '#70ffdd'
        draw.line(pts+[pts[0]],fill=colour,width=2)
        label=f['id'].replace('maintenance-','').replace('estate-','').replace('manor-','').replace('clubhouse-','')
        if f['kind']=='range-mat':label=f['id'][-2:]
        draw.text(pts[0],label,font=font,fill=colour,stroke_width=1,stroke_fill='black')
    annotated=ROOT/panel['png'].replace('.png','-reviewed-traces.png')
    img.save(annotated)
print(json.dumps(dict(file=out.relative_to(ROOT).as_posix(),features=len(features),roofs=sum(f['kind']=='roof' for f in features))))
