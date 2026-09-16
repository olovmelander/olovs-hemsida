"""Turn visual annotations into a dated, reviewable source-relative reference set."""
from prepare import *
from shapely.geometry import Point, Polygon, box, mapping
from shapely.affinity import scale
from shapely.ops import unary_union
from rasterio.features import geometry_mask

DOC=ROOT/'geo_data/course-v2/visby/vegetation/pilot'

def build():
    annotations=read(ROOT/'tools/visby-tree-pilot/annotations.json');scenes=read(OUT/'scenes.json')
    features=[];summaries=[];clearing_features=[]
    with rasterio.open(OUT/'chm.tif') as src:
      for scene in scenes:
        meta=read(OUT/'review'/(scene['id']+'.json'));w,s,e,n=meta['bounds']
        uncertain=[box(w+x0,n-y1,w+x1,n-y0) for x0,y0,x1,y1 in annotations['uncertainRectanglesMetres'].get(scene['id'],[])]
        score=box(w+5,s+5,e-5,n-5).difference(unary_union(uncertain))
        features.append(dict(type='Feature',properties=dict(role='scoring-area',scene=scene['id'],split=scene['split'],hole=scene['hole']),geometry=mapping(score)))
        count=0;scorable=0
        im=Image.open(OUT/'review'/(scene['id']+'-chm.png')).convert('RGB').resize((800,800),Image.Resampling.NEAREST)
        draw=ImageDraw.Draw(im)
        for k,(px,py,rx,ry) in enumerate(annotations['crowns'].get(scene['id'],[])):
            x,y=w+px/4,n-py/4;poly=scale(Point(x,y).buffer(1,quad_segs=16),rx/4,ry/4)
            window=from_bounds(*poly.bounds,transform=src.transform).round_offsets().round_lengths()
            a=src.read(1,window=window);transform=src.window_transform(window)
            mask=geometry_mask([mapping(poly)],out_shape=a.shape,transform=transform,invert=True)
            sampled=a[mask&np.isfinite(a)];h=float(np.max(sampled)) if len(sampled) else None
            valid=bool(h is not None and h>=3)
            include=bool(valid and score.covers(Point(x,y)))
            props=dict(id=f"ref-{scene['id']}-{k+1:03}",role='crown',scene=scene['id'],hole=scene['hole'],split=scene['split'],
                easting=x,northing=y,radiusMetres=float(np.sqrt(poly.area/np.pi)),heightMetres=h,scorable=include,
                status='interpreted' if valid else 'unresolved-low-height',positionKind='interpreted-crown-centre',
                uncertaintyMetres=annotations['uncertaintyMetres'],method='agent-visual-ellipse',sourceRelative=True,
                imageCapture='2026-04-10',lidarCaptureRange=['2024-02-03','2024-04-28'],sourceWindows=[a['id'] for a in meta['sources']])
            features.append(dict(type='Feature',properties=props,geometry=mapping(poly)))
            count+=valid;scorable+=include
            factor=800/(scene['size']*4)
            colour=(255,255,255) if include else (255,140,50)
            draw.ellipse(((px-rx)*factor,(py-ry)*factor,(px+rx)*factor,(py+ry)*factor),outline=colour,width=2)
            draw.text((px*factor,py*factor),str(k+1),fill=colour)
        im.save(OUT/'review'/(scene['id']+'-reference.png'))
        for k,ring in enumerate(annotations['clearingsMetres'].get(scene['id'],[])):
            poly=Polygon([(w+x,n-y) for x,y in ring])
            feature=dict(type='Feature',properties=dict(id=f"gap-{scene['id']}-{k+1}",role='clearing',scene=scene['id'],split=scene['split'],hole=scene['hole'],review='RGB/CIR and LiDAR visibly open; includes water where noted by imagery'),geometry=mapping(poly))
            features.append(feature);clearing_features.append(feature)
        summaries.append(dict(scene=scene['id'],interpreted=count,scorable=scorable))
    collection=dict(type='FeatureCollection',crs=dict(type='name',properties=dict(name='EPSG:3006')),method=annotations['method'],annotationSha256=digest(ROOT/'tools/visby-tree-pilot/annotations.json'),limits=annotations['limits'],features=features)
    save(DOC/'reference.geojson',collection)
    save(DOC/'reference-summary.json',dict(scenes=summaries,interpreted=sum(a['interpreted'] for a in summaries),scorable=sum(a['scorable'] for a in summaries),evaluationScorable=sum(a['scorable'] for a in summaries if a['scene'].startswith('hold')),clearingCount=len(clearing_features),limits=annotations['limits']))
    print(json.dumps(read(DOC/'reference-summary.json'),indent=2))

if __name__=='__main__':build()
