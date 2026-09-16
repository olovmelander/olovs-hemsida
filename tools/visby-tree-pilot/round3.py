"""Incremental coverage review using the frozen round-two candidate method.

Review cells own centres on half-open 100 m grid squares. Source panels include
a 15 m context border; detection has a 20 m halo. The six fresh evaluation
windows remain protected. Nothing here writes to the production public root.
"""
from round2 import *
from shapely.geometry import LineString
import round2_benchmark as detector
import benchmark as core

PREVIOUS=OUT/'round2'
PRIOR_DOC=ROOT/'geo_data/course-v2/visby/vegetation/pilot/round2'
WORK=OUT/'round3'
DOC=PRIOR_DOC.parent/'round3'
AUDIT=PRIOR_DOC.parent/'coverage-audit'
SELECTED=[
    (687100,6370600),(687100,6370700),(687100,6370800),(687100,6370900),
    (687200,6370600),(687200,6370700),(687200,6370800),(687200,6370900),(687200,6371000),
    (687300,6370700),(687300,6370800),(687400,6370700),(687400,6370800),
    (687500,6370700),(687500,6370800),(687600,6370700),(687600,6370800),(687700,6370700),
    (687300,6371000),(687300,6371100),(687300,6371200),
    (687400,6371800),(687400,6371900),(687500,6371800),(687500,6371700),(687600,6371700),
]

def collection(features):
    return dict(type='FeatureCollection',crs=dict(type='name',properties=dict(name='EPSG:3006')),features=features)

def protected():
    return unary_union([box(*read(PREVIOUS/'review'/(s['id']+'.json'))['bounds']) for s in read(PREVIOUS/'scenes.json')])

def corridor():
    return shape(next(f['geometry'] for f in read(AUDIT/'coverage.geojson')['features'] if f['properties']['role']=='playing-and-practice-surfaces-plus-30m'))

def owns(bounds,x,y):
    w,s,e,n=bounds
    return w<=x<e and s<=y<n

def check_lock():
    lock=read(DOC/'input-lock.json')
    for file,value in lock['sha256'].items():
        assert digest(ROOT/file)==value, 'Frozen input changed: '+file
    return lock

def plan():
    WORK.mkdir(exist_ok=True);DOC.mkdir(parents=True,exist_ok=True)
    freeze=[OUT/'baseline.json',OUT/'chm.tif',OUT/'first-returns.tif',OUT/'exclusions.json',OUT/'publication.json',
        PREVIOUS/'publication.json',PREVIOUS/'pilot-records.json',PREVIOUS/'pilot-footprints.geojson',PREVIOUS/'stand-output/index.json',
        PRIOR_DOC/'reference.geojson',PRIOR_DOC/'detector-lock.json',PRIOR_DOC/'evaluation.json',PRIOR_DOC/'corrections.json',
        PRIOR_DOC.parent/'corrections.json',CACHE/'acquisition.json',ROOT/'tools/visby-tree-pilot/round2_benchmark.py',
        ROOT/'tools/visby-tree-pilot/round2-detect.R',ROOT/'tools/visby-tree-pilot/round2-annotations.json',
        ROOT/'apps/golf/public/courses/v2-index.json',OUT/'after/courses/v2-index.json',PREVIOUS/'after/courses/v2-index.json']
    freeze += [PREVIOUS/j['file'] for j in read(PREVIOUS/'stand-output/index.json')]
    lock=dict(previous='round2',sha256={str(p.relative_to(ROOT)).replace('\\','/'):digest(p) for p in freeze})
    if (DOC/'input-lock.json').exists():assert read(DOC/'input-lock.json')==lock
    else:save(DOC/'input-lock.json',lock)
    area=corridor();holdout=protected();lines={h['n']:LineString(h['line']) for h in read(OUT/'exclusions.json')['geometry']['holes']}
    w,s,e,n=area.bounds;features=[];scenes=[]
    for x in range(int(w//100)*100,int(e//100+1)*100,100):
      for y in range(int(s//100)*100,int(n//100+1)*100,100):
        cell=box(x,y,x+100,y+100);owned=cell.intersection(area)
        if owned.area==0:continue
        selected=(x,y) in SELECTED;reviewable=owned.difference(holdout)
        props=dict(id=f'cell-{x}-{y}',bounds=[x,y,x+100,y+100],selected=selected,status='unreviewed',
            areaMetres2=owned.area,protectedEvaluationAreaMetres2=owned.intersection(holdout).area,
            reviewableAreaMetres2=reviewable.area,holes=[h for h,line in lines.items() if line.buffer(90).intersects(owned)])
        features.append(dict(type='Feature',geometry=mapping(owned),properties=props))
    for i,(x,y) in enumerate(SELECTED):
        f=next(f for f in features if f['properties']['bounds']==[x,y,x+100,y+100])
        p=f['properties'];p['scene']=f'r3-{i+1:02}'
        scenes.append(dict(id=p['scene'],cellId=p['id'],easting=x+50,northing=y+50,size=100,
            hole=min(lines,key=lambda h:lines[h].distance(Point(x+50,y+50))),holes=p['holes'],split='placement-review',ownedBounds=p['bounds']))
    save(WORK/'review-scenes.json',scenes);save(DOC/'coverage-plan.geojson',collection(features))
    save(DOC/'protocol.json',dict(scope='26 systematic source-review cells around holes 1, 2, 4 and 10, plus investigation of eight retained suppressed records',
        reviewer='agent visual source review',sourceDates=dict(lidar=['2024-02-03','2024-04-28'],rgbi='2026-04-10',seasonal='2022; exact date unknown'),
        method='Frozen round-two Dalponte + small measured canopy islands; candidate generation only, no new detector tuning or accuracy claim',
        previousDetectorLockSha256=digest(PRIOR_DOC/'detector-lock.json'),coverageDefinition='100 m grid clipped to playing/practice surfaces + 30 m. Six fresh evaluation windows reserved and not edited.',
        centreOwnership='west/south inclusive, east/north exclusive; full crown footprint retained across cell/tile seams',
        minimumHeightMetres=3,sourcePanelBorderMetres=15,detectorHaloMetres=20,deployment='isolated local preview; production/default unchanged'))
    print('Planned',len(scenes),'cells;',len(features),'in whole-corridor ledger',flush=True)

def source_panels():
    check_lock();directory=WORK/'review';directory.mkdir(exist_ok=True);(WORK/'detections').mkdir(exist_ok=True)
    if not (WORK/'chm.tif').exists():shutil.copyfile(OUT/'chm.tif',WORK/'chm.tif')
    assert digest(WORK/'chm.tif')==digest(OUT/'chm.tif')
    seasonal=read(ROOT/'geo_data/course-v2/visby/reference/gotland-ortho-2022.json')
    source=ROOT/seasonal['image']['path'];assert digest(source)==seasonal['image']['sha256'];old=Image.open(source).convert('RGB')
    sw,ss,se,sn=seasonal['bboxEpsg3006'];step=seasonal['outputSampleSpacingMetres']
    scenes=read(WORK/'review-scenes.json')
    scenes += [dict(id='suppressed-'+r['id'].split('-')[-1],recordId=r['id'],hole=r['nearestHole'],easting=r['easting'],northing=r['northing'],size=30,split='suppression-review') for r in read(AUDIT/'coverage.json')['suppressedRegistryRecords']]
    records=read(PREVIOUS/'pilot-records.json')
    for scene in scenes:
        if (directory/(scene['id']+'-source.png')).exists():continue
        half=scene['size']/2+(15 if scene['split']=='placement-review' else 0)
        w=scene['easting']-half;s=scene['northing']-half;e=w+half*2;n=s+half*2;bounds=[w,s,e,n]
        rgb,transform,sources=rgbi_window(bounds,.16);heights=chm_window(bounds,.25)
        write_tif(directory/(scene['id']+'-rgbi.tif'),rgb,transform)
        season=old.crop(((w-sw)/step,(sn-n)/step,(e-sw)/step,(sn-s)/step))
        views=[('rgb',Image.fromarray(np.moveaxis(rgb[:3],0,-1))),('cir',Image.fromarray(np.moveaxis(rgb[[3,0,1]],0,-1))),('chm',Image.fromarray(canopy_rgb(heights))),('2022',season)]
        canvas=Image.new('RGB',(1600,450),'#15201c');draw=ImageDraw.Draw(canvas)
        for col,(name,im) in enumerate(views):
            im.save(directory/(scene['id']+'-'+name+'.png'));im=im.resize((400,400));d=ImageDraw.Draw(im)
            def xy(x,y):return ((x-w)/(e-w)*400,(n-y)/(n-s)*400)
            if 'ownedBounds' in scene:
                a,b,c,f=scene['ownedBounds'];d.rectangle((*xy(a,f),*xy(c,b)),outline='white',width=1)
            for r in records:
                if owns(bounds,r['easting'],r['northing']):
                    x,y=xy(r['easting'],r['northing']);d.rectangle((x-2,y-2,x+2,y+2),outline='#52eafa')
            if scene['split']=='suppression-review':
                d.ellipse((194,194,206,206),outline='#ff5c3d',width=2)
            canvas.paste(im,(col*400,30));draw.text((col*400+5,8),scene['id']+' '+name,fill='white')
        draw.text((5,432),'RGB/CIR 2026-04-10; CHM 2024; seasonal RGB 2022 exact date unknown. Cyan: existing records. White: owned cell.',fill='white')
        canvas.save(directory/(scene['id']+'-source.png'))
        save(directory/(scene['id']+'.json'),dict(**scene,bounds=bounds,sources=sources,seasonalSourceSha256=seasonal['image']['sha256']))
        print('Prepared',scene['id'],flush=True)
    check_lock()

def candidates():
    check_lock();core.OUT=WORK;lock=read(PRIOR_DOC/'detector-lock.json');all_features=[]
    records=read(PREVIOUS/'pilot-records.json');area=corridor();holdout=protected()
    for scene in read(WORK/'review-scenes.json'):
        meta=read(WORK/'review'/(scene['id']+'.json'));w,s,e,n=meta['bounds']
        preds=detector.recover(core.geometry_candidates(scene,lock['method']),detector.components(scene,lock['maximumIslandAreaMetres2']))
        preds=[p for p in preds if owns(scene['ownedBounds'],p['point'].x,p['point'].y) and area.covers(p['point'])]
        preds.sort(key=lambda p:(-p['point'].y,p['point'].x))
        for i,p in enumerate(preds):
            nearest=min(records,key=lambda r:p['point'].distance(Point(r['easting'],r['northing'])))
            p.update(scene=scene['id'],reviewNumber=i+1,hole=scene['hole'],nearestExistingId=nearest['id'],nearestExistingMetres=p['point'].distance(Point(nearest['easting'],nearest['northing'])),
                protectedEvaluation=bool(p['geometry'].buffer(2).intersects(holdout)))
        all_features+=detector.export(preds)
        canvas=Image.new('RGB',(1950,710),'#15201c');draw=ImageDraw.Draw(canvas)
        for col,name in enumerate(['rgb','cir','chm']):
            im=Image.open(WORK/'review'/(scene['id']+'-'+name+'.png')).resize((650,650));d=ImageDraw.Draw(im)
            def xy(x,y):return ((x-w)/(e-w)*650,(n-y)/(n-s)*650)
            a,b,c,f=scene['ownedBounds'];d.rectangle((*xy(a,f),*xy(c,b)),outline='white',width=1)
            for p in preds:
                for g in [p['geometry']] if p['geometry'].geom_type=='Polygon' else p['geometry'].geoms:
                    d.line([xy(x,y) for x,y in g.exterior.coords],fill='#e68cf5' if p['protectedEvaluation'] else '#ffc65c',width=1)
                x,y=xy(p['point'].x,p['point'].y);d.ellipse((x-2,y-2,x+2,y+2),fill='white');d.text((x+3,y-10),str(p['reviewNumber']),fill='white',stroke_width=1,stroke_fill='black')
            for r in records:
                if owns(meta['bounds'],r['easting'],r['northing']):
                    x,y=xy(r['easting'],r['northing']);d.rectangle((x-3,y-3,x+3,y+3),outline='#52eafa',width=2)
            canvas.paste(im,(col*650,30));draw.text((col*650+5,8),scene['id']+' '+name,fill='white')
        draw.text((5,685),'Orange: candidates; purple: protected evaluation overlap; cyan: existing records. White square: owned cell; context is not completed review.',fill='white')
        canvas.save(WORK/'review'/(scene['id']+'-candidates.png'))
        print(scene['id'],[(p['reviewNumber'],round(p['height'],1),round(p['nearestExistingMetres'],1),p['protectedEvaluation']) for p in preds],flush=True)
    save(WORK/'placement-candidates.geojson',collection(all_features));check_lock()

if __name__=='__main__':
    if '--plan' in sys.argv:plan()
    elif '--candidates' in sys.argv:candidates()
    else:source_panels()
