"""Render exact native-pixel diagnostics and source-pinned estate review data."""
import hashlib
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT/'johannesbergbuild/cache/lm-ortho'
OUT = ROOT/'johannesbergbuild/cache/lm-estate-review'
MODEL = json.loads((ROOT/'johannesbergbuild/course-model.json').read_text(encoding='utf-8'))
FORWARD = Transformer.from_crs(4326,3006,always_xy=True)
INVERSE = Transformer.from_crs(3006,4326,always_xy=True)
M_PER_LON = 111320*math.cos(math.radians(59.72733))
font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf',18)

def project(p):
    return FORWARD.transform(18.19202+p[0]/M_PER_LON,59.72733-p[1]/111320)

def inverse(p):
    lon,lat = INVERSE.transform(*p)
    return [round((lon-18.19202)*M_PER_LON,2),round((59.72733-lat)*111320,2)]

def model_features():
    out=[]
    for i,w in enumerate(MODEL['water']): out.append(dict(id=w['id'],kind='water',modelPath=f'/water/{i}/ring',points=w['ring'],closed=True))
    for key in ['buildings','parking','paths','tracks','roads']:
        for i,w in enumerate(MODEL['infra'][key]):
            geom='ring' if 'ring' in w else 'line'
            out.append(dict(id=w['id'],kind=key,modelPath=f'/infra/{key}/{i}/{geom}',points=w[geom],closed=geom=='ring'))
    for key in ['practiceGreens','range']:
        for i,r in enumerate(MODEL['scenery'][key]): out.append(dict(id=f'{key}-{i}',kind=key,modelPath=f'/scenery/{key}/{i}',points=r,closed=True))
    return out

def render(identifier):
    record=json.loads((CACHE/(identifier+'.json')).read_text(encoding='utf-8'))
    image=Image.open(CACHE/(identifier+'.png')).convert('RGB')
    draw=ImageDraw.Draw(image); b=record['boundsEpsg3006']; r=record['resolutionMetres']
    def pixel(p):
        e,n=project(p)
        return [(e-b[0])/r,(b[3]-n)/r]
    colours={'water':'cyan','buildings':'#ff80ff','parking':'#ff8800','paths':'#ffaa30','tracks':'#ffaa30','roads':'#ffaa30','practiceGreens':'#00ff00','range':'#ffff00'}
    visible=[]
    for f in model_features():
        pts=[pixel(p) for p in f['points']]
        if max(p[0] for p in pts)<0 or min(p[0] for p in pts)>image.width or max(p[1] for p in pts)<0 or min(p[1] for p in pts)>image.height: continue
        draw.line(pts+[pts[0]] if f['closed'] else pts,fill=colours[f['kind']],width=3)
        centre=[sum(p[a] for p in pts)/len(pts) for a in range(2)]
        draw.text(centre,f['id'],fill=colours[f['kind']],font=font,stroke_width=2,stroke_fill='black')
        visible.append({**f,'originalPixels':pts})
    for x in range(0,image.width,100):
        draw.line([(x,0),(x,image.height)],fill='#a0a0a0',width=1)
        draw.text((x+3,3),str(x),fill='white',font=font,stroke_width=2,stroke_fill='black')
    for y in range(100,image.height,100):
        draw.line([(0,y),(image.width,y)],fill='#a0a0a0',width=1)
        draw.text((3,y+3),str(y),fill='white',font=font,stroke_width=2,stroke_fill='black')
    OUT.mkdir(parents=True,exist_ok=True)
    image.save(OUT/(identifier+'-estate-overlay.png'))
    (OUT/(identifier+'-estate-features.json')).write_text(json.dumps(visible,indent=2)+'\n',encoding='utf-8')

def write_review():
    def at(pointer):
        value=MODEL
        for key in pointer.strip('/').split('/'):
            value=value[int(key)] if isinstance(value,list) else value[key]
        return value
    def native(identifier,pixels):
        record=json.loads((CACHE/(identifier+'.json')).read_text(encoding='utf-8'))
        b=record['boundsEpsg3006'];r=record['resolutionMetres']
        return [inverse([b[0]+x*r,b[3]-y*r]) for x,y in pixels]
    def feature(identifier,kind,pointer,source,pixels,closed,note,uncertainty,mirrors=None):
        old=at(pointer)
        record=json.loads((CACHE/(source+'.json')).read_text(encoding='utf-8'))
        return dict(id=identifier,kind=kind,status='accepted',action='replace',modelPath=pointer,
                    targetPaths=[pointer]+(mirrors or []),closed=closed,
                    originalRingSha256=hashlib.sha256(json.dumps(old,separators=(',',':')).encode()).hexdigest(),
                    **({'ring':native(source,pixels),'pixelRing':pixels} if closed else {'line':native(source,pixels),'pixelPoints':pixels}),
                    sourceWindow=source,
                    evidence=dict(sourceFiles=[dict(path=f'johannesbergbuild/cache/lm-ortho/{source}.png',sha256=record['rgbSha256'])],
                                  sourceCaptureDates=['2025-06-14'],uncertaintyM=uncertainty,note=note))
    practice=[(255,152),(258,138),(273,130),(290,132),(313,142),(342,165),(366,197),(389,233),(412,267),(431,301),(436,322),(429,338),(414,350),(391,353),(370,344),(349,330),(330,309),(315,286),(306,264),(304,241),(294,222),(278,201),(263,180)]
    features=[
      feature('estate-practice-green','practice-green','/scenery/practiceGreens/0','estate-club-practice',
              [[x+700,y+930] for x,y in practice],True,
              'Trace the lighter maintained putting surface inside the darker collar; the outer raised oval, rocky inset, bank and surrounding path are excluded. Both duplicate practice-green arrays must change atomically.',1.0,['/scenery/greens/0']),
      feature('estate-range-shelter','building',f"/infra/buildings/{next(i for i,b in enumerate(MODEL['infra']['buildings']) if b['id']=='trace-range-shelter')}/ring",'estate-club-practice',
              [[700,627],[726,631],[725,652],[699,648]],True,
              'The visible small range shelter roof stands southeast of the old traced rectangle. Trace the bright roof perimeter, not its much larger northwest shadow; low-building footprint uncertainty includes roof overhang/parallax.',1.0),
      feature('estate-club-range-path','path',f"/infra/paths/{next(i for i,p in enumerate(MODEL['infra']['paths']) if p['id']=='trace-path-club-range')}/line",'estate-club-practice',
              [[741.9,874.3],[730,818],[716,759],[704,697],[695,649],[691,612]],False,
              'Replace the old diagonal across lawn with the visible surfaced walkway along the range mats. The south endpoint joins the existing OSM clubhouse path at its unchanged mapped junction; the north end approaches the shelter.',0.8),
      feature('estate-pond-causeway-path','path',f"/infra/paths/{next(i for i,p in enumerate(MODEL['infra']['paths']) if p['id']=='trace-path-18-causeway')}/line",'estate-ponds-north',
              [[665,985],[661,1033],[658,1080],[656,1121],[637,1145],[609,1161]],False,
              'The old traced causeway line is on mown fairway east of the ponds. The visible narrow crossing is the strip between the western pond and the reed-covered pond arm, continuing into the short grass south of the crossing. Trace that visible corridor; its partly grassy ends carry greater uncertainty.',1.5),
    ]
    observations=[
      dict(category='water',status='reviewed-retained',featureIds=[w['id'] for w in MODEL['water'][3:]],
           note='All nine near-play water outlines checked against native pond panels and whole-estate context. They track the physical pond/reed margins to roughly 1–3 m at most visible edges. Preserve the inherited bank outline and measured water level; a single June waterline or floating vegetation is not a replacement bank survey. The north end of trace-pond-18-north differs by several metres inside a graded/reedy shore, so retained pending bank-versus-seasonal-water interpretation.'),
      dict(category='buildings',status='reviewed-retained-except-listed-shelter',featureIds=['w296165896','w296165891','w296165892','w296165893','w296165894','w296165897','w296165898','w296165899','w296165901','w296165904','w296165905','w296165906','w378922988'],
           note='Clubhouse, manor and immediate estate buildings occupy the mapped footprints. Roof overhang and orthophoto building displacement prevent defensible sub-metre footprint corrections from these pixels alone; no bulk shift is justified. The independently traced small range shelter is the clear exception.'),
      dict(category='practice-ground',status='reviewed-retained-except-listed-putting-green',
           note='The driving-range mown outline, western hut, practice bunker, mats and westward hitting direction are visible in the native range panel. Range boundary broadly follows mowing; retain it. Mat row has hidden sections under tree crown/shadow, so the existing pitch/count and net absence are retained rather than inferred from incomplete slots.'),
      dict(category='paths-and-parking',status='reviewed-retained-except-listed-paths',
           note='Whole-estate context confirms farm-road and playing-corridor connections; the clubhouse OSM path follows the visible fork. Main forecourt, clubhouse car park and apron occupy the correct hardstands, but exact parking-versus-road separation is not a visible ground boundary everywhere. Retain these semantic polygons. Only the two clearly misplaced traced path lines are changed.'),
      dict(category='trees',status='reviewed-no-tree-movement',
           note='2025 leaf-on imagery shows real woods east of holes 4–9 and mixed deciduous groups around the manor, water and nine. Leaf-off 2021 canopy under-represents broadleaf crown spread; expanding or shifting individual measured stems from crown shadows would be unsupported. Mature canopy remains around the two southern/eastern clearfell contexts, with low regeneration and open gaps that cannot establish new stem positions. Published crown/stand conflicts with accepted surfaces have a separate source-pinned audit; no vegetation mutations are part of this estate ledger.'),
      dict(category='distant-context',status='outside-new-imagery-review',featureIds=[w['id'] for w in MODEL['water'][:3]],
           note='Uttran, Hävsjön and Rotsjön, plus outlying buildings/roads beyond the bounded estate orthophoto, were not reviewed in this intake.'),
    ]
    report=dict(schemaVersion=1,groundId='johannesberg',course='johannesberg-estate',kind='orthophoto-estate-feature-review',observedOn='2026-09-09',
                frame={k:MODEL[k] for k in ['origin','mPerLat','mPerLon']},features=features,observations=observations,
                limitations=['Source imagery is 2025-06-14, not a survey of conditions in September 2026.','Native pixel spacing is 0.16 m; recorded interpretation uncertainty is larger.','Height, water levels and measured tree positions are not changed.'])
    (ROOT/'johannesbergbuild/mapping/lm-review-estate.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    print(json.dumps(dict(features=len(features),path='johannesbergbuild/mapping/lm-review-estate.json')))

if __name__=='__main__':
    for identifier in ['estate-club-practice','estate-range','estate-ponds-north','estate-ponds-h2','estate-ponds-h3','estate-pond-h11']:
        render(identifier)
    write_review()
