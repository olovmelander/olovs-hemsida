"""Focused review of unresolved full-facility height gaps; immutable round five."""
from round5 import *
import round5 as prior
from rasterio.features import rasterize, shapes
from scipy import ndimage

PREVIOUS=OUT/'round5'
PRIOR_DOC=ROOT/'geo_data/course-v2/visby/vegetation/pilot/round5'
WORK=OUT/'round6'
DOC=PRIOR_DOC.parent/'round6'

def facility():return shape(read(PRIOR_DOC/'facility-scope.geojson')['features'][0]['geometry'])

def check_lock():
    for name,value in read(DOC/'input-lock.json')['sha256'].items():assert digest(ROOT/name)==value,name

def polygons(g):
    if g.is_empty:return []
    if g.geom_type=='Polygon':return [g]
    return [p for part in g.geoms for p in polygons(part)] if hasattr(g,'geoms') else []

def exclusion_geometries():
    x=read(OUT/'exclusions.json');result=[];buffers={r['kind']:r['bufferMetres'] for r in x['reasons']}
    for f in x['features']:
        gs=[Polygon(r).buffer(0) for r in f.get('rings',[])]+[LineString(r) for r in f.get('lines',[])]
        for g in gs:result.append((f['kind'],g.buffer(buffers.get(f['kind'],0))))
    result += [('reviewed-playing',Polygon(r['ring']).buffer(.5)) for r in x['reviewedPlayingAreas']]
    return result

def plan():
    WORK.mkdir(exist_ok=True);DOC.mkdir(exist_ok=True);(WORK/'review').mkdir(exist_ok=True)
    prior.check_lock()
    for k,v in read(PRIOR_DOC/'reproduction-lock.json')['sha256'].items():assert digest(ROOT/k)==v,k
    paths=[p for p in PRIOR_DOC.iterdir() if p.is_file()]+[PREVIOUS/p for p in ['pilot-records.json','pilot-footprints.geojson','publication.json','stand-output/index.json','review-data.js']]
    paths += [PREVIOUS/j['file'] for j in read(PREVIOUS/'stand-output/index.json')]
    frozen={**read(PRIOR_DOC/'input-lock.json')['sha256'],**read(PRIOR_DOC/'reproduction-lock.json')['sha256']}
    frozen.update({str(p.relative_to(ROOT)).replace('\\','/'):digest(p) for p in paths})
    lock=dict(previous='round5',sha256=frozen)
    if (DOC/'input-lock.json').exists():assert read(DOC/'input-lock.json')==lock
    else:save(DOC/'input-lock.json',lock)
    unresolved=unary_union([shape(f['geometry']) for f in read(PRIOR_DOC/'canopy-gap-accounting.geojson')['features'] if f['properties']['status']=='unresolved-representation'])
    rows=[]
    for f in read(PRIOR_DOC/'canopy-gaps.geojson')['features']:
        g=shape(f['geometry']).intersection(unresolved)
        if g.area>0:rows.append(dict(type='Feature',geometry=mapping(g),properties={**f['properties'],'unresolvedAreaMetres2':g.area}))
    rows.sort(key=lambda f:-f['properties']['unresolvedAreaMetres2'])
    for i,f in enumerate(rows):f['properties'].update(priority=i+1,selected=f['properties']['unresolvedAreaMetres2']>=25)
    save(DOC/'gap-plan.geojson',collection(rows))
    save(DOC/'protocol.json',dict(scope='All 79 residual components at least 25 m²; smaller components remain explicit in the facility ledger.',selectedAreaMetres2=sum(f['properties']['unresolvedAreaMetres2'] for f in rows if f['properties']['selected']),
        protected='Frozen evaluation unchanged; no source tuning or new accuracy claim.',corrections='Explicit reviewed polygons only, with unchanged runtime exclusions and stable retained IDs. No automatic filling of residual height.'))
    check_lock();print('Selected',sum(f['properties']['selected'] for f in rows))

def boards():
    check_lock();old=json.loads((PREVIOUS/'review-data.js').read_text(encoding='utf-8').split('=',1)[1].strip().rstrip(';'))
    scenes=old['scenes'];records=read(PREVIOUS/'pilot-records.json');exclusions=exclusion_geometries()
    crowns=[(f['properties']['id'],shape(f['geometry'])) for f in read(PRIOR_DOC/'individual-coverage.geojson')['features']]
    stands=[shape(f['geometry']) for f in read(PRIOR_DOC/'woodland-coverage.geojson')['features']]
    seasonal=read(ROOT/'geo_data/course-v2/visby/reference/gotland-ortho-2022.json');assert digest(ROOT/seasonal['image']['path'])==seasonal['image']['sha256']
    summer=Image.open(ROOT/seasonal['image']['path']).convert('RGB');sw,ss,se,sn=seasonal['bboxEpsg3006'];step=seasonal['outputSampleSpacingMetres']
    selected=[f for f in read(DOC/'gap-plan.geojson')['features'] if f['properties']['selected']];metas=[]
    for f in selected:
        p=f['properties'];g=shape(f['geometry']);w,s,e,n=g.bounds;size=max(40,int(np.ceil((max(e-w,n-s)+24)/4))*4);cx=(w+e)/2;cy=(s+n)/2
        w=np.floor(cx-size/2)+.5;n=np.ceil(cy+size/2)+.5;e=w+size;s=n-size;b=[w,s,e,n];region=box(*b)
        count=round(size/.16);t=from_origin(w,n,.16,.16);rgbi=np.zeros((4,count,count),dtype=np.uint8);valid=np.zeros((count,count),dtype=np.uint8);sources=[]
        for scene in scenes:
            if not box(*scene['bounds']).intersects(region):continue
            file=(PREVIOUS/scene['sourcePrefix']/(scene['id']+'-rgbi.tif')).resolve()
            with rasterio.open(file) as src:
                temp=np.zeros_like(rgbi);mask=np.zeros_like(valid)
                reproject(rasterio.band(src,[1,2,3,4]),temp,src_transform=src.transform,src_crs=src.crs,dst_transform=t,dst_crs=src.crs,resampling=Resampling.bilinear)
                reproject(src.dataset_mask(),mask,src_transform=src.transform,src_crs=src.crs,dst_transform=t,dst_crs=src.crs,resampling=Resampling.nearest)
                rgbi[:,mask>0]=temp[:,mask>0];valid[mask>0]=255
            sources.append(dict(scene=scene['id'],rasterSha256=digest(file),path=str(file.relative_to(ROOT)).replace('\\','/'),acquisition=scene['sources']))
        assert np.all(valid),'Incomplete RGBI panel'
        with rasterio.open(OUT/'chm.tif') as src:
            win=from_bounds(*b,transform=src.transform);assert np.allclose([win.col_off,win.row_off],[round(win.col_off),round(win.row_off)])
            h=src.read(1,window=win)
        sid='gap-'+str(p['priority']).zfill(3);directory=WORK/'review'
        oldim=summer.crop(((w-sw)/step,(sn-n)/step,(e-sw)/step,(sn-s)/step))
        layers=[('rgb',Image.fromarray(np.moveaxis(rgbi[:3],0,-1))),('cir',Image.fromarray(np.moveaxis(rgbi[[3,0,1]],0,-1))),('2022',oldim),('chm',Image.fromarray(canopy_rgb(h))),('representation',Image.new('RGB',(400,400),'#122019')),('exclusions',Image.fromarray(np.moveaxis(rgbi[:3],0,-1)))]
        canvas=Image.new('RGB',(1200,880),'#13221b');label=ImageDraw.Draw(canvas)
        near_exclusions=[(k,x.intersection(region)) for k,x in exclusions if x.intersects(region)];near_crowns=[(id,x) for id,x in crowns if x.intersects(region)];near_stands=[x for x in stands if x.intersects(region)]
        for idx,(name,im) in enumerate(layers):
            im.save(directory/(sid+'-'+name+'.png'));im=im.resize((400,400),Image.Resampling.NEAREST if name=='chm' else Image.Resampling.BILINEAR);d=ImageDraw.Draw(im)
            def xy(x,y):return ((x-w)/size*400,(n-y)/size*400)
            def boundary(x,col,width=1,fill=None):
                for poly in polygons(x):
                    if fill:d.polygon([xy(*a) for a in poly.exterior.coords],fill=fill)
                    for ring in [poly.exterior,*poly.interiors]:d.line([xy(*a) for a in ring.coords],fill=col,width=width)
            if name=='representation':
                for x in near_stands:boundary(x,'#3e8154',fill='#28593b')
            if name=='exclusions':
                for k,x in near_exclusions:boundary(x,'#ff6655')
            for id,x in near_crowns:boundary(x,'#5bc7db')
            for r in records:
                if owns(b,r['easting'],r['northing']):
                    x,y=xy(r['easting'],r['northing']);d.ellipse((x-2,y-2,x+2,y+2),fill='#ffff66')
            boundary(g,'#ff73e5',2);boundary(protected().intersection(region),'#b99cff',2)
            canvas.paste(im,((idx%3)*400,30+(idx//3)*425));label.text(((idx%3)*400+5,8+(idx//3)*425),sid+' '+name,fill='white')
        kinds={k:round(g.intersection(x).area,1) for k in set(k for k,x in near_exclusions) for x in [unary_union([z for kk,z in near_exclusions if kk==k])] if g.intersection(x).area>0}
        label.text((5,858),f"{p['id']} {g.area:.1f} m2 | pink gap; cyan existing crowns; yellow bases; red exclusion | {kinds}",fill='white')
        canvas.save(directory/(sid+'-board.png'))
        meta=dict(id=sid,gapId=p['id'],priority=p['priority'],bounds=b,size=size,geometry=f['geometry'],areaMetres2=g.area,exclusionOverlapMetres2=kinds,sources=sources,dates=dict(rgbi='2026-04-10',lidar=['2024-02-03','2024-04-28'],seasonal='2022; exact date unknown'))
        save(directory/(sid+'.json'),meta);metas.append(meta)
    save(WORK/'review-scenes.json',metas);check_lock();print('Boards',len(metas))

def probe_points():
    """Diagnostic centres only; a mixed residual component is not a tree."""
    check_lock();rows=[]
    with rasterio.open(OUT/'chm.tif') as src:
        for m in read(WORK/'review-scenes.json'):
            w,s,e,n=m['bounds'];t=from_origin(w,n,1,1);h=src.read(1,window=from_bounds(w,s,e,n,src.transform))
            mask=rasterize([(m['geometry'],1)],out_shape=h.shape,transform=t).astype(bool)
            rr,cc=np.where(mask & np.isfinite(h) & (h>=3));weights=h[rr,cc]
            rows.append(dict(id=m['id'],easting=float(np.average(w+cc+.5,weights=weights)),northing=float(np.average(n-rr-.5,weights=weights)),height=float(np.max(weights))))
    save(WORK/'gap-probe-points.json',rows);check_lock();print('Diagnostic gap centres',len(rows))


if __name__=='__main__':
    if '--plan' in sys.argv:plan()
    elif '--probes' in sys.argv:probe_points()
    else:boards()
