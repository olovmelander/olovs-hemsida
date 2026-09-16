"""Compare real lidR/Node outputs against frozen visual references, in metres."""
from prepare import *
from shapely.geometry import shape, Point, mapping
from shapely.ops import unary_union
from rasterio.features import shapes
from scipy.optimize import linear_sum_assignment

DOC=ROOT/'geo_data/course-v2/visby/vegetation/pilot'
MATCH_METRES=4.0

def geometry_candidates(scene,method):
    directory=OUT/'detections'
    if method=='published':
        return [dict(id=r['id'],point=Point(r['easting'],r['northing']),geometry=Point(r['easting'],r['northing']).buffer(r['radiusMetres']),height=r['objectHeightMetres']) for r in read(OUT/'baseline-records.json')]
    if method=='node-current':
        meta=read(directory/(scene['id']+'-node-current.json'))
        labels=np.fromfile(directory/(scene['id']+'-node-current.i32'),dtype='<i4').reshape(meta['height'],meta['width'])
        transform=from_origin(meta['originEasting'],meta['originNorthing'],1,1)
    else:
        with rasterio.open(directory/(scene['id']+'-'+method+'.tif')) as src:
            a=src.read(1,masked=True);labels=a.filled(-1).astype(np.int32);transform=src.transform
    parts={}
    for geom,label in shapes(labels,mask=labels>=0,transform=transform):parts.setdefault(int(label),[]).append(shape(geom))
    heights=np.full(labels.shape,np.nan,dtype=np.float32)
    with rasterio.open(OUT/'chm.tif') as src:reproject(rasterio.band(src,1),heights,src_transform=src.transform,src_crs=src.crs,dst_transform=transform,dst_crs=src.crs,resampling=Resampling.nearest)
    results=[]
    for label,geometries in parts.items():
        rr,cc=np.where((labels==label)&np.isfinite(heights));h=heights[rr,cc]
        if not len(h) or np.max(h)<3:continue
        x=transform.c+(cc+.5)*transform.a;y=transform.f+(rr+.5)*transform.e
        point=Point(float(np.average(x,weights=np.maximum(h,1))),float(np.average(y,weights=np.maximum(h,1))))
        results.append(dict(id=f'{scene["id"]}/{method}/{label}',point=point,geometry=unary_union(geometries),height=float(np.max(h))))
    return results

def match(refs,preds):
    if not refs or not preds:return []
    distances=np.array([[r['point'].distance(p['point']) for p in preds] for r in refs])
    # Penalize invalid pairs heavily so matching maximizes valid correspondences first.
    cost=np.where(distances<=MATCH_METRES,distances,1e6)
    a,b=linear_sum_assignment(cost)
    return [(int(i),int(j),float(distances[i,j])) for i,j in zip(a,b) if distances[i,j]<=MATCH_METRES]

def score(refs,preds):
    pairs=match(refs,preds);ious=[];distances=[]
    for i,j,d in pairs:
        r,p=refs[i]['geometry'],preds[j]['geometry'];union=r.union(p).area
        ious.append(r.intersection(p).area/union if union else 0);distances.append(d)
    return dict(tp=len(pairs),fp=len(preds)-len(pairs),fn=len(refs)-len(pairs),ious=ious,distances=distances,pairs=pairs)

def summarize(rows):
    tp=sum(r['tp'] for r in rows);fp=sum(r['fp'] for r in rows);fn=sum(r['fn'] for r in rows)
    distances=[d for r in rows for d in r['distances']];ious=[v for r in rows for v in r['ious']]
    precision=tp/(tp+fp) if tp+fp else 0;recall=tp/(tp+fn) if tp+fn else 0
    return dict(tp=tp,fp=fp,fn=fn,precision=precision,recall=recall,f1=2*precision*recall/(precision+recall) if precision+recall else 0,
                crownIoU=float(np.mean(ious)) if ious else 0,centreMedianMetres=float(np.median(distances)) if distances else None,
                centreP95Metres=float(np.quantile(distances,.95)) if distances else None)

def select_method(metrics,candidates):
    return sorted(candidates,key=lambda m:(-metrics[m]['calibration']['f1'],-metrics[m]['calibration']['crownIoU'],metrics[m]['calibration']['centreMedianMetres'] if metrics[m]['calibration']['centreMedianMetres'] is not None else 999,m))[0]

def main():
    reference=read(DOC/'reference.geojson');scenes=read(OUT/'scenes.json')
    methods=['published','node-current']+[f'{m}-d{d}-s{s}' for m in ['dalponte','silva'] for d in [3,4,5] for s in [0,1]]
    rows={m:[] for m in methods};exports={m:[] for m in methods}
    for scene in scenes:
        fs=[f for f in reference['features'] if f['properties']['scene']==scene['id']]
        area=shape(next(f for f in fs if f['properties']['role']=='scoring-area')['geometry'])
        refs=[dict(id=f['properties']['id'],point=Point(f['properties']['easting'],f['properties']['northing']),geometry=shape(f['geometry'])) for f in fs if f['properties']['role']=='crown' and f['properties']['scorable']]
        for method in methods:
            predictions=[p for p in geometry_candidates(scene,method) if area.covers(p['point'])]
            result=score(refs,predictions);result.update(scene=scene['id'],split=scene['split']);rows[method].append(result)
            exports[method].extend(dict(type='Feature',geometry=mapping(p['geometry']),properties=dict(id=p['id'],scene=scene['id'],height=p['height'],easting=p['point'].x,northing=p['point'].y)) for p in predictions)
    metrics={m:{split:summarize([r for r in rows[m] if r['split']==split]) for split in ['calibration','evaluation']} for m in methods}
    candidates=[m for m in methods if m!='published']
    selected=select_method(metrics,candidates)
    lock=dict(selected=selected,selectionUses='calibration scenes only; holes 9 and 16 never select settings',referenceSha256=digest(DOC/'reference.geojson'),matchingToleranceMetres=MATCH_METRES,methods=methods)
    save(DOC/'detector-selection.json',lock)
    result=dict(version=1,selection=lock,metrics=metrics,target=dict(precision=.9,recall=.9),
        passed=metrics[selected]['evaluation']['precision']>=.9 and metrics[selected]['evaluation']['recall']>=.9,
        limitations=reference['limits']+['Reported centre differences are against interpreted crown centres, not measured trunk error.','Crown IoU uses approximate visual ellipses and raster labels; baseline published geometry uses its rendered circular radius.'])
    save(DOC/'benchmark.json',result);save(OUT/'benchmark-details.json',rows)
    for method in methods:save(OUT/'detections'/(method+'.geojson'),dict(type='FeatureCollection',crs=dict(type='name',properties=dict(name='EPSG:3006')),features=exports[method]))
    print(json.dumps(dict(selected=selected,passed=result['passed'],comparison={m:metrics[m] for m in ['published','node-current',selected]}),indent=2))

if __name__=='__main__':main()
