"""Calibrate a sparse-crown recovery pass; then evaluate a frozen fresh sample.

The recovery pass operates on measured LiDAR canopy islands, not RGB/NIR
thresholds. It consolidates detections inside small islands and recovers islands
whose low/sparse peaks vanish under median smoothing. Forests keep segmentation.
"""
from round2 import *
import benchmark as core
from scipy.ndimage import binary_closing,label
from rasterio.features import shapes

METHODS=['node-current']+[f'{method}-d{base}-m{median}' for method in ['dalponte','silva'] for base in [5,7,9] for median in [3,5]]
MAX_AREAS=[0,80,140,220]

def components(scene,maximum_area):
    if not maximum_area:return []
    with rasterio.open(OUT/'chm.tif') as src:
        half=scene['size']/2+20
        window=from_bounds(scene['easting']-half,scene['northing']-half,scene['easting']+half,scene['northing']+half,transform=src.transform)
        c0=int(np.floor(window.col_off));r0=int(np.floor(window.row_off));c1=int(np.ceil(window.col_off+window.width));r1=int(np.ceil(window.row_off+window.height))
        window=rasterio.windows.Window(c0,r0,c1-c0,r1-r0);raw=src.read(1,window=window);transform=src.window_transform(window)
    measured=np.isfinite(raw);canopy=measured&(raw>=2)
    # Closing is only for connectivity. Height and supported area use actual returns.
    closed=binary_closing(canopy,structure=np.ones((3,3),dtype=bool))
    labels,count=label(closed,structure=np.ones((3,3)));candidates=[]
    for number in range(1,count+1):
        footprint=labels==number;rr,cc=np.where(footprint);area=len(rr)
        if not 6<=area<=maximum_area:continue
        if rr.min()==0 or cc.min()==0 or rr.max()==raw.shape[0]-1 or cc.max()==raw.shape[1]-1:continue
        if max(rr.max()-rr.min()+1,cc.max()-cc.min()+1)>24:continue
        supported=footprint&canopy;rows,cols=np.where(supported);heights=raw[supported]
        if len(heights)<6 or np.max(heights)<3 or len(heights)/area<.4:continue
        geoms=[shape(g) for g,v in shapes(footprint.astype(np.uint8),mask=footprint,transform=transform)]
        geometry=unary_union(geoms)
        x=transform.c+(cols+.5)*transform.a;y=transform.f+(rows+.5)*transform.e
        centre=Point(float(np.average(x,weights=heights)),float(np.average(y,weights=heights)))
        candidates.append(dict(id=f'{scene["id"]}/island/{number}',point=centre,geometry=geometry,height=float(np.max(heights)),
            method='measured-canopy-island',supportedCells=len(heights),supportFraction=len(heights)/area))
    return candidates

def recover(predictions,islands):
    # Remove only candidates whose source-relative centres belong to a recovered
    # island. Neighbouring crowns are not merged by an arbitrary distance alone.
    rest=[p for p in predictions if not any(c['geometry'].covers(p['point']) for c in islands)]
    return rest+islands

def refs_and_area(collection,scene):
    fs=[f for f in collection['features'] if f['properties']['scene']==scene['id']]
    area=shape(next(f for f in fs if f['properties']['role']=='scoring-area')['geometry'])
    refs=[dict(id=f['properties']['id'],point=Point(f['properties']['easting'],f['properties']['northing']),geometry=shape(f['geometry'])) for f in fs if f['properties'].get('scorable')]
    return refs,area

def export(predictions):
    return [dict(type='Feature',geometry=mapping(p['geometry']),properties={**{k:v for k,v in p.items() if k not in ['point','geometry']},'easting':p['point'].x,'northing':p['point'].y}) for p in predictions]

def main():
    fresh='--fresh' in sys.argv;core.OUT=WORK
    if fresh:
        lock=read(DOC/'detector-lock.json');assert digest(DOC/'reference.geojson')==lock['freshReferenceSha256']
        scenes=read(WORK/'scenes.json');reference=read(DOC/'reference.geojson')
        variants=[('node-current',0),('silva-d5-m3',0),(lock['method'],lock['maximumIslandAreaMetres2'])]
        variants=list(dict.fromkeys(variants))
    else:
        scenes=[s for s in read(OUT/'scenes.json') if s['split']=='calibration'];reference=read(DOC.parent/'reference.geojson')
        variants=[(method,area) for method in METHODS for area in MAX_AREAS]
    scores={f'{m}+islands{a}':[] for m,a in variants};features={key:[] for key in scores}
    for scene in scenes:
        refs,area=refs_and_area(reference,scene)
        islands={limit:components(scene,limit) for limit in set(a for m,a in variants)}
        raw={method:core.geometry_candidates(scene,method) for method in set(m for m,a in variants)}
        for method,limit in variants:
            key=f'{method}+islands{limit}';preds=[p for p in recover(raw[method],islands[limit]) if area.covers(p['point'])]
            row=core.score(refs,preds);row.update(scene=scene['id']);scores[key].append(row)
            for f in export(preds):f['properties']['scene']=scene['id'];features[key].append(f)
    metrics={key:core.summarize(rows) for key,rows in scores.items()}
    if not fresh:
        selected=core.select_method({key:dict(calibration=m) for key,m in metrics.items()},list(metrics))
        method,area=selected.split('+islands');lock=dict(selected=selected,method=method,maximumIslandAreaMetres2=int(area),
            selection='Calibration F1, crown IoU, centre disagreement; no old or fresh evaluation scores used',
            freshReferenceSha256=digest(DOC/'reference.geojson'),calibrationReferenceSha256=digest(DOC.parent/'reference.geojson'),
            detectorCodeSha256=digest(Path(__file__)),rCodeSha256=digest(ROOT/'tools/visby-tree-pilot/round2-detect.R'),
            selectedAt=datetime.now(timezone.utc).isoformat(),candidateConfigurations=len(variants))
        if (DOC/'detector-lock.json').exists():
            previous=read(DOC/'detector-lock.json');assert all(previous[k]==v for k,v in lock.items() if k!='selectedAt'),'Frozen detector differs'
        else:save(DOC/'detector-lock.json',lock)
        save(DOC/'calibration.json',dict(metrics=metrics,selected=selected))
    else:
        selected=lock['selected'];save(DOC/'evaluation.json',dict(selected=selected,referenceSha256=digest(DOC/'reference.geojson'),metrics=metrics,
            target=dict(precision=.9,recall=.9),passed=metrics[selected]['precision']>=.9 and metrics[selected]['recall']>=.9,
            limits=reference['limits']+['A fresh source-interpretation test, not an independent ground survey. No edits to these samples preceded evaluation.']))
    save(WORK/('evaluation-details.json' if fresh else 'calibration-details.json'),scores)
    for key,fs in features.items():save(WORK/'detections'/((('fresh-' if fresh else 'cal-')+key)+'.geojson'),dict(type='FeatureCollection',crs=dict(type='name',properties=dict(name='EPSG:3006')),features=fs))
    print(json.dumps(dict(stage='fresh-evaluation' if fresh else 'calibration',selected=selected,metrics={key:metrics[key] for key in ['node-current+islands0','silva-d5-m3+islands0',selected]}),indent=2))

if __name__=='__main__':main()
