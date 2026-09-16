"""Course-wide continuation: every previously uninspected, editable review cell.

Frozen round-two detector, round-three placement baseline and immutable review
history. Processing a cell does not certify inspection: decisions are separate.
"""
from round3 import *
from scipy.spatial import cKDTree
import prepare as imagery

PREVIOUS=OUT/'round3'
PRIOR_DOC=ROOT/'geo_data/course-v2/visby/vegetation/pilot/round3'
WORK=OUT/'round4'
DOC=PRIOR_DOC.parent/'round4'
DETECTOR_DOC=PRIOR_DOC.parent/'round2'

def protected():
    return unary_union([box(*read(OUT/'round2/review'/(s['id']+'.json'))['bounds']) for s in read(OUT/'round2/scenes.json')])

def check_lock():
    lock=read(DOC/'input-lock.json')
    for name,value in lock['sha256'].items():assert digest(ROOT/name)==value,'Frozen input changed: '+name
    return lock

def plan():
    WORK.mkdir(exist_ok=True);DOC.mkdir(parents=True,exist_ok=True);(WORK/'review').mkdir(exist_ok=True);(WORK/'detections').mkdir(exist_ok=True)
    old_lock=read(PRIOR_DOC/'input-lock.json')['sha256'];frozen={**old_lock}
    paths=[PREVIOUS/'publication.json',PREVIOUS/'pilot-records.json',PREVIOUS/'pilot-footprints.geojson',PREVIOUS/'stand-output/index.json',
        PREVIOUS/'after/courses/v2-index.json',PRIOR_DOC/'corrections.json',PRIOR_DOC/'clearings.geojson',PRIOR_DOC/'coverage.geojson',
        PRIOR_DOC/'issue-index.json',PRIOR_DOC/'reproduction-lock.json',PRIOR_DOC/'suppression-review.json',
        ROOT/'apps/golf/public/models/visby/facilities-v1.json']
    paths += [PREVIOUS/j['file'] for j in read(PREVIOUS/'stand-output/index.json')]
    paths += [ROOT/k for k in read(PRIOR_DOC/'reproduction-lock.json')['sha256']]
    for p in paths:frozen[str(p.relative_to(ROOT)).replace('\\','/')]=digest(p)
    lock=dict(previous='round3',sha256=frozen)
    if (DOC/'input-lock.json').exists():assert read(DOC/'input-lock.json')==lock
    else:save(DOC/'input-lock.json',lock)
    coverage=read(PRIOR_DOC/'coverage.geojson');scenes=[];lines={h['n']:LineString(h['line']) for h in read(OUT/'exclusions.json')['geometry']['holes']}
    for f in coverage['features']:
        p=f['properties'];p['priorStatus']=p['status'];p['priorInspected']=p.get('inspected',False);p['selected']=False
        if p.get('inspected'):continue
        if p['reviewableAreaMetres2']<.001:p['status']='protected-evaluation';continue
        sid=f'r4-{len(scenes)+1:02}';w,s,e,n=p['bounds'];p.update(selected=True,scene=sid,status='unreviewed')
        scenes.append(dict(id=sid,cellId=p['id'],easting=(w+e)/2,northing=(s+n)/2,size=100,ownedBounds=p['bounds'],
            hole=min(lines,key=lambda h:lines[h].distance(Point((w+e)/2,(s+n)/2))),holes=p['holes'],split='placement-review'))
    save(WORK/'review-scenes.json',scenes);save(DOC/'coverage-plan.geojson',coverage)
    save(DOC/'protocol.json',dict(scope='Every previously uninspected editable cell in the frozen playing/practice corridor plus 30 m',
        gridCells=len(coverage['features']),newReviewCells=len(scenes),previouslyInspectedCells=26,entirelyProtectedCells=2,
        method='Frozen round-two Dalponte plus measured canopy islands, followed by explicit source review; no detector retuning or new accuracy claim.',
        ownership='Half-open 100 m centre ownership, clipped to corridor; full crown geometry; 15 m image context and 20 m detection halo.',
        sourceDates=dict(lidar=['2024-02-03','2024-04-28'],rgbi='2026-04-10',seasonal='2022; exact date unknown'),
        uncertainty='Crown centres, not surveyed stems; 2 m horizontal and 1.5 m vertical are judgements, not measured accuracy.',
        release='Isolated local preview only; unchanged production and earlier previews.',
        completion='Every cell accounted for, with inspected/resolved/ambiguous/no-data/protected states kept separate. No forced acceptance of uncertain trees.'))
    target=WORK/'chm.tif'
    if not target.exists():shutil.copyfile(OUT/'chm.tif',target)
    assert digest(target)==digest(OUT/'chm.tif');check_lock();print('Planned',len(scenes),'new cells',flush=True)

def sources():
    check_lock();report=read(CACHE/'acquisition.json');verified=[]
    # Verify each source once in this process, rather than rehashing the same
    # large source for every overlapping panel. Retain per-file identities.
    for r in report['windows']:
        assert digest(CACHE/r['rasterFile'])==r['sha256']
        with rasterio.open(CACHE/r['rasterFile']) as src:
            assert src.count==4 and src.crs.to_epsg()==3006
            assert np.allclose(src.transform.to_gdal(),r['geoTransform'],atol=1e-8,rtol=0)
        verified.append(dict(id=r['id'],file=r['rasterFile'],sha256=r['sha256']))
    save(DOC/'verified-imagery.json',dict(files=verified,meaning='Hashes and four-band CRS/transforms verified before panel generation; source acquisition dates retained in each panel.'))
    seasonal=read(ROOT/'geo_data/course-v2/visby/reference/gotland-ortho-2022.json');assert digest(ROOT/seasonal['image']['path'])==seasonal['image']['sha256']
    season=Image.open(ROOT/seasonal['image']['path']).convert('RGB');sw,ss,se,sn=seasonal['bboxEpsg3006'];step=seasonal['outputSampleSpacingMetres']
    records=read(PREVIOUS/'pilot-records.json');coverage={f['properties']['scene']:f for f in read(DOC/'coverage-plan.geojson')['features'] if f['properties']['selected']}
    for scene in read(WORK/'review-scenes.json'):
        sid=scene['id'];directory=WORK/'review'
        if (directory/(sid+'.json')).exists():continue
        w=scene['easting']-65;n=scene['northing']+65;e=w+130;s=n-130;bounds=[w,s,e,n]
        count=round(130/.16);transform=from_origin(w,n,.16,.16);rgb=np.zeros((4,count,count),dtype=np.uint8);valid=np.zeros((count,count),dtype=np.uint8);provenance=[]
        matches=[r for r in report['windows'] if box(*r['boundsEpsg3006']).intersects(box(*bounds))];matches.sort(key=lambda r:-r['width']*r['height'])
        for r in matches:
            with rasterio.open(CACHE/r['rasterFile']) as src:
                local=np.zeros_like(rgb);mask=np.zeros_like(valid)
                for b in range(4):reproject(rasterio.band(src,b+1),local[b],src_transform=src.transform,src_crs=src.crs,dst_transform=transform,dst_crs=src.crs,resampling=Resampling.bilinear)
                reproject(src.dataset_mask(),mask,src_transform=src.transform,src_crs=src.crs,dst_transform=transform,dst_crs=src.crs,resampling=Resampling.nearest)
                rgb[:,mask>0]=local[:,mask>0];valid[mask>0]=255
            provenance.append({k:r[k] for k in ['id','sha256','sources']})
        g=shape(coverage[sid]['geometry']).difference(protected());mask=geometry_mask([mapping(g)],out_shape=valid.shape,transform=transform,invert=True)
        fraction=float(np.mean(valid[mask]>0)) if mask.any() else None
        assert fraction is not None,'Reviewable cell has no source samples'
        write_tif(directory/(sid+'-rgbi.tif'),rgb,transform)
        Image.fromarray(valid).save(directory/(sid+'-valid.png'))
        with rasterio.open(directory/(sid+'-rgbi.tif')) as src:actual=list(src.bounds)
        old=season.crop(((w-sw)/step,(sn-n)/step,(e-sw)/step,(sn-s)/step));heights=chm_window(bounds,.25)
        bands=[('rgb',Image.fromarray(np.moveaxis(rgb[:3],0,-1))),('cir',Image.fromarray(np.moveaxis(rgb[[3,0,1]],0,-1))),('chm',Image.fromarray(canopy_rgb(heights))),('2022',old)]
        canvas=Image.new('RGB',(1600,445),'#13221b');label=ImageDraw.Draw(canvas)
        for col,(name,im) in enumerate(bands):
            im.save(directory/(sid+'-'+name+'.png'));im=im.resize((400,400));d=ImageDraw.Draw(im)
            extent=actual if name in ['rgb','cir'] else bounds
            def xy(x,y):return ((x-extent[0])/(extent[2]-extent[0])*400,(extent[3]-y)/(extent[3]-extent[1])*400)
            a,b,c,f=scene['ownedBounds'];d.rectangle((*xy(a,f),*xy(c,b)),outline='white',width=1)
            for r in records:
                if owns(bounds,r['easting'],r['northing']):
                    x,y=xy(r['easting'],r['northing']);d.rectangle((x-2,y-2,x+2,y+2),outline='#58dfff')
            canvas.paste(im,(400*col,25));label.text((400*col+5,6),sid+' '+name,fill='white')
        label.text((5,428),'White: owned cell. Cyan: prior individuals. Image 2026-04-10 / LiDAR 2024 / seasonal RGB 2022 exact date unknown.',fill='white')
        canvas.save(directory/(sid+'-source.png'))
        save(directory/(sid+'.json'),dict(**scene,bounds=bounds,layerBounds={k:actual for k in ['rgb','cir']},sources=provenance,
            validOwnedImageFraction=fraction,validPanelImageFraction=float(np.mean(valid>0)),seasonalSourceSha256=seasonal['image']['sha256'],
            rasterSha256=digest(directory/(sid+'-rgbi.tif'))))
        print('Sources',sid,'valid',fraction,flush=True)
    check_lock()

def candidates():
    check_lock();core.OUT=WORK;lock=read(DETECTOR_DOC/'detector-lock.json');records=read(PREVIOUS/'pilot-records.json');tree=cKDTree([[r['easting'],r['northing']] for r in records])
    old_issues=read(PRIOR_DOC/'issue-index.json')['cases'];issue_geometry=[(i['id'],shape(i['geometry'])) for i in old_issues]
    area=corridor();holdout=protected();features=[];summary=[]
    for scene in read(WORK/'review-scenes.json'):
        sid=scene['id'];meta=read(WORK/'review'/(sid+'.json'));preds=detector.recover(core.geometry_candidates(scene,lock['method']),detector.components(scene,lock['maximumIslandAreaMetres2']))
        preds=[p for p in preds if owns(scene['ownedBounds'],p['point'].x,p['point'].y) and area.covers(p['point'])];preds.sort(key=lambda p:(-p['point'].y,p['point'].x))
        for i,p in enumerate(preds):
            distance,index=tree.query([p['point'].x,p['point'].y]);radius=np.sqrt(p['geometry'].area/np.pi)
            p.update(scene=sid,reviewNumber=i+1,hole=scene['hole'],nearestExistingId=records[index]['id'],nearestExistingMetres=float(distance),
                protectedEvaluation=bool(p['geometry'].buffer(2).intersects(holdout) or p['point'].buffer(radius+2).intersects(holdout)),
                priorIssueIds=[id for id,g in issue_geometry if p['geometry'].intersects(g)])
        features+=detector.export(preds)
        canvas=Image.new('RGB',(1950,710),'#13221b');label=ImageDraw.Draw(canvas)
        for col,layer in enumerate(['rgb','cir','chm']):
            im=Image.open(WORK/'review'/(sid+'-'+layer+'.png')).resize((650,650));d=ImageDraw.Draw(im);w,s,e,n=meta['layerBounds'].get(layer,meta['bounds'])
            def xy(x,y):return ((x-w)/(e-w)*650,(n-y)/(n-s)*650)
            a,b,c,f=scene['ownedBounds'];d.rectangle((*xy(a,f),*xy(c,b)),outline='white',width=1)
            for p in preds:
                focus=p['nearestExistingMetres']>6 and not p['protectedEvaluation'];colour='#ffc65c' if focus else '#b39bdd' if p['protectedEvaluation'] else '#69b7c6'
                g=p['geometry']
                for poly in [g] if g.geom_type=='Polygon' else g.geoms:d.line([xy(x,y) for x,y in poly.exterior.coords],fill=colour,width=1)
                x,y=xy(p['point'].x,p['point'].y)
                if focus:d.text((x+3,y-10),str(p['reviewNumber']),fill='white',stroke_width=1,stroke_fill='black');d.ellipse((x-2,y-2,x+2,y+2),fill='white')
            for r in records:
                if owns(meta['bounds'],r['easting'],r['northing']):
                    x,y=xy(r['easting'],r['northing']);d.rectangle((x-2,y-2,x+2,y+2),outline='#52eafa')
            canvas.paste(im,(col*650,30));label.text((col*650+5,8),sid+' '+layer,fill='white')
        label.text((5,688),'Numbered orange: >6m from prior individuals. Cyan: nearer existing representation. Purple: protected. These are candidates, not accepted trees.',fill='white');canvas.save(WORK/'review'/(sid+'-candidates.png'))
        focus=[p for p in preds if p['nearestExistingMetres']>6 and not p['protectedEvaluation']]
        summary.append(dict(scene=sid,candidates=len(preds),focus=[dict(number=p['reviewNumber'],height=round(p['height'],1),area=round(p['geometry'].area,1),nearest=round(p['nearestExistingMetres'],1),priorIssues=p['priorIssueIds']) for p in focus]))
    save(WORK/'placement-candidates.geojson',collection(features));save(WORK/'candidate-summary.json',summary)
    print('Candidates',len(features),'focus',sum(len(s['focus']) for s in summary),flush=True);check_lock()

if __name__=='__main__':
    if '--plan' in sys.argv:plan()
    elif '--candidates' in sys.argv:candidates()
    else:sources()
