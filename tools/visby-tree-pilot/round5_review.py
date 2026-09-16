"""Package facility-wide coverage, treatment, source evidence and matched views."""
from round5 import *


def main():
    check_lock()
    previous=read_json_script(PREVIOUS/'review-data.js')
    scenes=[dict(read(WORK/'review'/(s['id']+'.json')),sourcePrefix='review/') for s in read(WORK/'review-scenes.json')]
    for s in previous['scenes']:
        s['sourcePrefix']='../round4/'+s.get('sourcePrefix','review/')
        scenes.append(s)
    grids=[]
    for s in scenes:
        file=WORK/s['sourcePrefix']/(s['id']+'-rgbi.tif')
        with rasterio.open(file) as src:
            assert src.crs.to_epsg()==3006 and src.count==4 and abs(src.transform.a-.16)<1e-10 and abs(src.transform.e+.16)<1e-10
            actual=list(src.bounds);delta=max(abs(a-b) for a,b in zip(actual,s['bounds']));assert delta<=.080001
            s['layerBounds'].update(rgb=actual,cir=actual)
            grids.append(dict(scene=s['id'],actualRasterBounds=actual,requestedBounds=s['bounds'],maximumPanelEdgeDisagreementMetres=delta,sha256=digest(file)))
    save(DOC/'source-grid-checks.json',dict(scenes=grids,policy='Use actual 16 cm pixel-edge extents for RGB/CIR; nominal native LiDAR panel for height and seasonal layers.'))
    coverage=read(DOC/'coverage.geojson');old={f['properties']['id']:f for f in read(PRIOR_DOC/'coverage.geojson')['features']}
    for f in coverage['features']:
        p=f['properties'];p['reviewScene']=p.get('scene') or old.get(p['id'],{}).get('properties',{}).get('scene')
    data=dict(scenes=scenes,coverage=coverage,summary=read(DOC/'coverage.json'),facility=read(DOC/'facility-scope.geojson'),
        extension=collection([dict(type='Feature',geometry=mapping(extension().difference(protected())),properties=dict(id='new-review-area',meaning='Review history only; individuals may be placed anywhere in the facility where evidence supports them.'))]),
        reserved=collection([dict(type='Feature',geometry=mapping(protected()),properties=dict(id='protected-evaluation'))]),
        corrections=collection(read(DOC/'corrections.geojson')['features']+previous['corrections']['features']),
        clearings=collection(read(DOC/'clearings.geojson')['features']+previous['clearings']['features']),
        woodland=read(DOC/'woodland-coverage.geojson'),individuals=read(DOC/'individual-coverage.geojson'),
        gaps=read(DOC/'canopy-gap-accounting.geojson'),issues=read(DOC/'issue-index.geojson'),issueSummary=read(DOC/'issue-index.json'),
        validation=read(DOC/'validation.json'),canopy=read(DOC/'canopy-audit.json'),baselineCanopy=read(DOC/'baseline-canopy-audit.json'))
    data['holeLines']=[dict(hole=h['n'],coordinates=h['line']) for h in read(OUT/'exclusions.json')['geometry']['holes']]
    data['facilityLandmarks']=[dict(label=f.get('label',f['id']),coordinates=f['centerEpsg3006']) for f in read(ROOT/'visbybuild/facilities/facility-inventory.json')['facilities'] if f.get('scope')=='club-facilities' and f.get('centerEpsg3006')]
    for key in ['coverage','facility','extension','reserved','corrections','clearings','woodland','individuals','gaps','issues']:
        for f in data[key]['features']:f['bbox']=list(shape(f['geometry']).bounds)
    origin=read(OUT/'baseline.json')['ground']['frame']['origin']
    for key,directory in [('before',PREVIOUS/'captures'),('after',WORK/'captures')]:
        data[key+'Bases']=[[round(origin['easting']+a[0],2),round(origin['northing']-a[2],2),a[6]] for a in read(directory/'webgpu-high-instances.json')['instances']]
    (WORK/'review-data.js').write_text('window.PILOT5='+json.dumps(data,separators=(',',':'))+';\n',encoding='utf-8')
    shutil.copyfile(ROOT/'tools/visby-tree-pilot/round5-review.html',WORK/'review.html');(WORK/'exports').mkdir(exist_ok=True)
    for f in DOC.iterdir():
        if f.is_file():shutil.copyfile(f,WORK/'exports'/f.name)
    print('Packaged',len(scenes),'scenes: http://127.0.0.1:8649/pilot-review/round5/review.html')


def read_json_script(path):
    return json.loads(path.read_text(encoding='utf-8').split('=',1)[1].strip().rstrip(';'))


if __name__=='__main__':main()
