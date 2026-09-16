"""Package the third local review with source dates, issues and matched views."""
from round3 import *

def main():
    check_lock()
    scenes=[read(WORK/'review'/(s['id']+'.json')) for s in read(WORK/'review-scenes.json')]
    scenes += [c['sourceMetadata'] for c in read(DOC/'suppression-review.json')['cases']]
    grids=[]
    for scene in scenes:
        with rasterio.open(WORK/'review'/(scene['id']+'-rgbi.tif')) as src:
            assert src.crs.to_epsg()==3006 and src.count==4 and abs(src.transform.a-.16)<1e-10 and abs(src.transform.e+.16)<1e-10
            actual=list(src.bounds);delta=max(abs(a-b) for a,b in zip(actual,scene['bounds']))
            assert delta<=.080001,'Unexpected source raster extent'
            scene['layerBounds']={k:actual for k in ['rgb','cir']}
            grids.append(dict(scene=scene['id'],requestedBounds=scene['bounds'],actualRasterBounds=actual,width=src.width,height=src.height,
                pixelSpacingMetres=.16,maximumPanelEdgeDisagreementMetres=delta,sha256=digest(WORK/'review'/(scene['id']+'-rgbi.tif'))))
    save(DOC/'source-grid-checks.json',dict(scenes=grids,policy='Display RGB/CIR at the actual GeoTIFF edge bounds. Historical candidate/contact panels fitted the nominal square and can differ by at most 0.08 m at its edge. LiDAR-derived positions are unaffected.'))
    data=dict(scenes=scenes,corrections=read(DOC/'corrections.geojson'),clearings=read(DOC/'clearings.geojson'),
        coverage=read(DOC/'coverage.geojson'),reserved=dict(type='Feature',geometry=mapping(protected()),properties=dict(id='protected-evaluation',meaning='Frozen evaluation windows; no edits')),
        summary=read(DOC/'coverage.json'),issues=read(DOC/'issue-index.geojson'),
        validation=read(DOC/'validation.json'),evaluation=read(PRIOR_DOC/'evaluation.json'))
    origin=read(OUT/'baseline.json')['ground']['frame']['origin']
    for key,directory in [('before',PREVIOUS/'captures'),('after',WORK/'captures')]:
        raw=read(directory/'webgpu-high-instances.json')
        data[key+'Bases']=[[round(origin['easting']+a[0],2),round(origin['northing']-a[2],2),a[6]] for a in raw['instances']
            if any(owns(s['bounds'],origin['easting']+a[0],origin['northing']-a[2]) for s in scenes)]
    (WORK/'review-data.js').write_text('window.PILOT3='+json.dumps(data,separators=(',',':'))+';\n',encoding='utf-8')
    shutil.copyfile(ROOT/'tools/visby-tree-pilot/round3-review.html',WORK/'review.html');(WORK/'exports').mkdir(exist_ok=True)
    for file in DOC.glob('*'):
        if file.is_file():shutil.copyfile(file,WORK/'exports'/file.name)
    print('http://127.0.0.1:8647/pilot-review/round3/review.html')

if __name__=='__main__':main()
