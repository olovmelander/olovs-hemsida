"""Package the third local review with source dates, issues and matched views."""
from round4 import *

def main():
    check_lock()
    scenes=[read(WORK/'review'/(s['id']+'.json')) for s in read(WORK/'review-scenes.json')]
    for scene in scenes:scene['sourcePrefix']='review/'
    for scene in [read(PREVIOUS/'review'/(s['id']+'.json')) for s in read(PREVIOUS/'review-scenes.json')]+[c['sourceMetadata'] for c in read(DOC/'suppression-review.json')['cases']]:
        scene['sourcePrefix']='../round3/review/';scenes.append(scene)
    grids=[]
    for scene in scenes:
        directory=WORK/'review' if scene['sourcePrefix']=='review/' else PREVIOUS/'review'
        with rasterio.open(directory/(scene['id']+'-rgbi.tif')) as src:
            assert src.crs.to_epsg()==3006 and src.count==4 and abs(src.transform.a-.16)<1e-10 and abs(src.transform.e+.16)<1e-10
            actual=list(src.bounds);delta=max(abs(a-b) for a,b in zip(actual,scene['bounds']))
            assert delta<=.080001,'Unexpected source raster extent'
            scene['layerBounds']={k:actual for k in ['rgb','cir']}
            grids.append(dict(scene=scene['id'],requestedBounds=scene['bounds'],actualRasterBounds=actual,width=src.width,height=src.height,
                pixelSpacingMetres=.16,maximumPanelEdgeDisagreementMetres=delta,sha256=digest(directory/(scene['id']+'-rgbi.tif'))))
    save(DOC/'source-grid-checks.json',dict(scenes=grids,policy='Display RGB/CIR at the actual GeoTIFF edge bounds. Historical candidate/contact panels fitted the nominal square and can differ by at most 0.08 m at its edge. LiDAR-derived positions are unaffected.'))
    data=dict(scenes=scenes,corrections=collection(read(DOC/'corrections.geojson')['features']+read(PRIOR_DOC/'corrections.geojson')['features']),clearings=collection(read(DOC/'clearings.geojson')['features']+read(PRIOR_DOC/'clearings.geojson')['features']),
        coverage=read(DOC/'coverage.geojson'),reserved=dict(type='Feature',geometry=mapping(protected()),properties=dict(id='protected-evaluation',meaning='Frozen evaluation windows; no edits')),
        summary=read(DOC/'coverage.json'),issueSummary=read(DOC/'issue-index.json'),issues=read(DOC/'issue-index.geojson'),
        validation=read(DOC/'validation.json'),evaluation=read(DETECTOR_DOC/'evaluation.json'))
    origin=read(OUT/'baseline.json')['ground']['frame']['origin']
    for key,directory in [('before',PREVIOUS/'captures'),('after',WORK/'captures')]:
        raw=read(directory/'webgpu-high-instances.json')
        data[key+'Bases']=[[round(origin['easting']+a[0],2),round(origin['northing']-a[2],2),a[6]] for a in raw['instances']
            if any(owns(s['bounds'],origin['easting']+a[0],origin['northing']-a[2]) for s in scenes)]
    (WORK/'review-data.js').write_text('window.PILOT4='+json.dumps(data,separators=(',',':'))+';\n',encoding='utf-8')
    shutil.copyfile(ROOT/'tools/visby-tree-pilot/round4-review.html',WORK/'review.html');(WORK/'exports').mkdir(exist_ok=True)
    for file in DOC.glob('*'):
        if file.is_file():shutil.copyfile(file,WORK/'exports'/file.name)
    print('http://127.0.0.1:8648/pilot-review/round4/review.html')

if __name__=='__main__':main()
