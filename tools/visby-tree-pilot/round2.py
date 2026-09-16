"""Second Visby experiment: retain round-one evidence and a fresh blind sample."""
from prepare import *
from shapely.geometry import shape,Point,box
from shapely.geometry import Polygon,mapping
from shapely.affinity import scale
from shapely.ops import unary_union
from rasterio.features import geometry_mask
from datetime import datetime,timezone
import shutil

WORK=OUT/'round2'
DOC=ROOT/'geo_data/course-v2/visby/vegetation/pilot/round2'
SCENES=[
    dict(id='fresh05',hole=5,easting=687325,northing=6371710,size=100,split='fresh-evaluation'),
    dict(id='fresh07',hole=7,easting=687465,northing=6371320,size=100,split='fresh-evaluation'),
    dict(id='fresh11',hole=11,easting=688045,northing=6370655,size=100,split='fresh-evaluation'),
    dict(id='fresh12',hole=12,easting=688000,northing=6370780,size=100,split='fresh-evaluation'),
    dict(id='fresh17',hole=17,easting=687855,northing=6370655,size=100,split='fresh-evaluation'),
    dict(id='fresh18',hole=18,easting=687470,northing=6370670,size=100,split='fresh-evaluation'),
]
REVIEW_SCENES=[
    dict(id='review06',hole=6,easting=687345,northing=6371420,size=80,split='placement-review'),
    dict(id='review13',hole=13,easting=688050,northing=6370900,size=80,split='placement-review'),
    dict(id='review15',hole=15,easting=687975,northing=6371190,size=80,split='placement-review'),
    dict(id='review15west',hole=15,easting=687875,northing=6371200,size=80,split='placement-review'),
]

def prepare(scenes=SCENES,review_only=False):
    WORK.mkdir(exist_ok=True);(WORK/'review').mkdir(exist_ok=True)
    # Benchmark readers use an isolated directory but the identical source raster.
    source=OUT/'chm.tif';target=WORK/'chm.tif'
    if not target.exists():
        try:target.hardlink_to(source)
        except OSError:shutil.copyfile(source,target)
    assert digest(target)==digest(source),'Second-pass CHM differs from frozen input'
    (WORK/'detections').mkdir(exist_ok=True)
    for calibration in read(OUT/'scenes.json'):
        if calibration['split']!='calibration':continue
        for suffix in ['.json','.i32']:
            name=calibration['id']+'-node-current'+suffix
            original=OUT/'detections'/name;copy=WORK/'detections'/name
            if not copy.exists():shutil.copyfile(original,copy)
            assert digest(copy)==digest(original),'Retained calibration detector differs'
    previous=[box(*read(OUT/'review'/(s['id']+'.json'))['bounds']) for s in read(OUT/'scenes.json')]
    if review_only:previous += [box(*read(WORK/'review'/(s['id']+'.json'))['bounds']) for s in SCENES]
    for scene in scenes:
        side=scene['size'];w=scene['easting']-side/2;n=scene['northing']+side/2;bounds=[w,n-side,w+side,n]
        assert not any(box(*bounds).intersection(b).area>0 for b in previous),'Fresh scene overlaps previous reference'
        rgb,transform,sources=rgbi_window(bounds,.16);chm=chm_window(bounds,.25)
        directory=WORK/'review';write_tif(directory/(scene['id']+'-rgbi.tif'),rgb,transform)
        views=[('RGB 2026-04-10',np.moveaxis(rgb[:3],0,-1)),('CIR 2026-04-10',np.moveaxis(rgb[[3,0,1]],0,-1)),('LiDAR height 2024',canopy_rgb(chm))]
        canvas=Image.new('RGB',(1230,445),'#15201c');draw=ImageDraw.Draw(canvas)
        for k,((title,arr),name) in enumerate(zip(views,['rgb','cir','chm'])):
            im=Image.fromarray(arr);im.save(directory/(scene['id']+'-'+name+'.png'));canvas.paste(im.resize((400,400)),(k*410,30));draw.text((k*410,8),scene['id']+' / '+title,fill='white')
        canvas.save(directory/(scene['id']+'-panel.png'))
        save(directory/(scene['id']+'.json'),dict(**scene,bounds=bounds,sources=sources))
        print('Prepared blind sample',scene['id'],flush=True)
    if review_only:
        save(WORK/'review-scenes.json',scenes)
        return
    save(WORK/'scenes.json',SCENES)
    save(DOC/'protocol.json',dict(version=2,previousPilotSha256=digest(OUT/'publication.json'),
        calibration='Previous calibration areas only. No previous evaluation or fresh-sample scores may select parameters.',
        freshEvaluationScenes=SCENES,matchingToleranceMetres=4,
        annotationMethod='Visual RGB/CIR/CHM interpretation before viewing new detector outputs; approximate crown centre and extent.',
        deployment='isolated local preview; production baseline remains unchanged'))

def errors():
    refs=read(ROOT/'geo_data/course-v2/visby/vegetation/pilot/reference.geojson')
    for scene in ['cal03','cal02','cal13']:
        meta=read(OUT/'review'/(scene+'.json'));w,s,e,n=meta['bounds'];side=e-w
        canvas=Image.new('RGB',(1500,520),'#142019');draw=ImageDraw.Draw(canvas)
        for k,method in enumerate(['reference','node-current','silva-d5-s1']):
            im=Image.open(OUT/'review'/(scene+'-chm.png')).resize((500,500));d=ImageDraw.Draw(im)
            features=refs['features'] if method=='reference' else read(OUT/'detections'/(method+'.geojson'))['features']
            for f in features:
                p=f['properties']
                if p.get('scene')!=scene or (method=='reference' and p.get('role')!='crown'):continue
                g=shape(f['geometry']);geoms=[g] if g.geom_type=='Polygon' else list(g.geoms)
                for poly in geoms:d.line([((x-w)/side*500,(n-y)/side*500) for x,y in poly.exterior.coords],fill='white' if method=='reference' else '#ff8060',width=1)
                x=(p['easting']-w)/side*500;y=(n-p['northing'])/side*500;d.ellipse((x-2,y-2,x+2,y+2),fill='yellow')
            canvas.paste(im,(k*500,20));draw.text((k*500,0),scene+' / '+method,fill='white')
        canvas.save(WORK/(scene+'-errors.png'))

def reference():
    annotations=read(ROOT/'tools/visby-tree-pilot/round2-annotations.json');features=[]
    with rasterio.open(OUT/'chm.tif') as src:
      for scene in SCENES:
        meta=read(WORK/'review'/(scene['id']+'.json'));w,s,e,n=meta['bounds']
        uncertain=[box(w+x0/4,n-y1/4,w+x1/4,n-y0/4) for x0,y0,x1,y1 in annotations['uncertainRectanglesPixels'].get(scene['id'],[])]
        area=box(w+5,s+5,e-5,n-5).difference(unary_union(uncertain))
        features.append(dict(type='Feature',geometry=mapping(area),properties=dict(role='scoring-area',scene=scene['id'],split=scene['split'])))
        im=Image.open(WORK/'review'/(scene['id']+'-chm.png')).resize((800,800));draw=ImageDraw.Draw(im)
        for index,(px,py,rx,ry) in enumerate(annotations['crowns'][scene['id']]):
            x,y=w+px/4,n-py/4;poly=scale(Point(x,y).buffer(1,quad_segs=16),rx/4,ry/4)
            win=from_bounds(*poly.bounds,transform=src.transform).round_offsets().round_lengths();a=src.read(1,window=win)
            mask=geometry_mask([mapping(poly)],out_shape=a.shape,transform=src.window_transform(win),invert=True)
            sample=a[mask&np.isfinite(a)];h=float(np.max(sample)) if len(sample) else None;valid=h is not None and h>=3
            scorable=bool(valid and area.covers(Point(x,y)))
            props=dict(id=f'ref-{scene["id"]}-{index+1:03}',role='crown',scene=scene['id'],hole=scene['hole'],split=scene['split'],
                easting=x,northing=y,heightMetres=h,radiusMetres=float(np.sqrt(poly.area/np.pi)),scorable=scorable,
                status='interpreted' if valid else 'unresolved-low-height',positionKind='interpreted-crown-centre',uncertaintyMetres=2,
                imageCapture='2026-04-10',lidarCaptureRange=['2024-02-03','2024-04-28'],sourceWindows=[r['id'] for r in meta['sources']])
            features.append(dict(type='Feature',geometry=mapping(poly),properties=props))
            colour='white' if scorable else '#ff9d60';draw.ellipse(((px-rx)*2,(py-ry)*2,(px+rx)*2,(py+ry)*2),outline=colour,width=2);draw.text((px*2,py*2),str(index+1),fill=colour)
        for index,ring in enumerate(annotations['clearingsMetres'].get(scene['id'],[])):
            features.append(dict(type='Feature',geometry=mapping(Polygon([(w+x,n-y) for x,y in ring])),properties=dict(id=f'gap-{scene["id"]}-{index}',role='clearing',scene=scene['id'],split=scene['split'])))
        im.save(WORK/'review'/(scene['id']+'-reference.png'))
    target=DOC/'reference.geojson';collection=dict(type='FeatureCollection',crs=dict(type='name',properties=dict(name='EPSG:3006')),method=annotations['method'],limits=annotations['limits'],features=features)
    if target.exists():assert read(target)==collection,'A frozen fresh reference cannot be changed after evaluation'
    else:save(target,collection)
    lock=DOC/'reference-lock.json'
    if not lock.exists():save(lock,dict(frozenAt=datetime.now(timezone.utc).isoformat(),referenceSha256=digest(target),annotationSha256=digest(ROOT/'tools/visby-tree-pilot/round2-annotations.json'),chmSha256=digest(OUT/'chm.tif'),predictionsViewed=False))
    counts={s['id']:sum(f['properties'].get('scorable',False) for f in features if f['properties']['scene']==s['id']) for s in SCENES}
    save(DOC/'reference-summary.json',dict(scorable=sum(counts.values()),scenes=counts,annotated=sum(f['properties']['role']=='crown' for f in features),clearings=6))
    print(read(DOC/'reference-summary.json'))

if __name__=='__main__':
    if '--errors' in sys.argv:errors()
    elif '--reference' in sys.argv:reference()
    elif '--placement-review' in sys.argv:prepare(REVIEW_SCENES,True)
    else:prepare()
