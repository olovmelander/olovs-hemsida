"""Package focused review and the retained full-facility source map."""
from round6 import *


def main():
    check_lock();data=json.loads((PREVIOUS/'review-data.js').read_text(encoding='utf-8').split('=',1)[1].strip().rstrip(';'))
    for s in data['scenes']:s['sourcePrefix']='../round5/'+s.get('sourcePrefix','review/')
    probes={p['id']:p for p in read(WORK/'runtime-probes.json')['probes']};grid=[]
    for m in read(WORK/'review-scenes.json'):
        bounds=m['bounds'];count=round(m['size']/.16);hashes={}
        for name in ['rgb','cir','2022','chm']:
            file=WORK/'review'/(m['id']+'-'+name+'.png');im=Image.open(file)
            if name in ['rgb','cir']:assert im.size==(count,count) and abs(count*.16-m['size'])<1e-8
            if name=='chm':assert im.size==(m['size'],m['size'])
            hashes[name]=digest(file)
        for source in m['sources']:assert digest(ROOT/source['path'])==source['rasterSha256']
        data['scenes'].append(dict(m,sourcePrefix='review/',hole=probes[m['id']]['atlas']['hole'],layerBounds={k:bounds for k in ['rgb','cir','2022','chm']}))
        grid.append(dict(scene=m['id'],bounds=bounds,rgbPixels=count,rgbPixelMetres=.16,heightPixelMetres=1,maximumPanelEdgeDisagreementMetres=0,panelHashes=hashes))
    save(DOC/'source-grid-checks.json',dict(scenes=grid,previousChecks='../round5/source-grid-checks.json',
        meaning='New mosaics use exactly divisible square extents and the native height pixel-edge lattice. All RGBI pixels had valid cached coverage. Seasonal pixels retain the older source sampling.'))
    for key,file in [('coverage','coverage.geojson'),('corrections','corrections.geojson'),('woodland','woodland-coverage.geojson'),('individuals','individual-coverage.geojson'),('gaps','canopy-gap-accounting.geojson'),('issues','issue-index.geojson')]:
        newer=read(DOC/file)
        if key=='corrections':newer['features']+=data[key]['features']
        data[key]=newer
    data.update(validation=read(DOC/'validation.json'),canopy=read(DOC/'canopy-audit.json'),baselineCanopy=read(DOC/'baseline-canopy-audit.json'),
        issueSummary=read(DOC/'issue-index.json'),findings=read(DOC/'findings.json'),gapReviews=read(DOC/'review-journal.json')['cases'],
        resizeEdits=read(DOC/'corrections.json')['edits'],closeups=read(WORK/'closeups.json'))
    data['extension']=collection([dict(type='Feature',geometry=j['geometry'],properties=dict(id=j['id'],meaning='Inspected height gap; not a planting boundary.')) for j in data['gapReviews']])
    for key in ['coverage','facility','extension','reserved','corrections','clearings','woodland','individuals','gaps','issues']:
        for f in data[key]['features']:f['bbox']=list(shape(f['geometry']).bounds)
    origin=read(OUT/'baseline.json')['ground']['frame']['origin']
    for key,directory in [('before',PREVIOUS/'captures'),('after',WORK/'captures')]:
        data[key+'Bases']=[[round(origin['easting']+a[0],2),round(origin['northing']-a[2],2),a[6]] for a in read(directory/'webgpu-high-instances.json')['instances']]
    (WORK/'review-data.js').write_text('window.PILOT6='+json.dumps(data,separators=(',',':'))+';\n',encoding='utf-8')
    for name in ['facility-scope.geojson','suppression-review.json']:shutil.copyfile(PRIOR_DOC/name,DOC/name)
    shutil.copyfile(ROOT/'tools/visby-tree-pilot/round6-review.html',WORK/'review.html');(WORK/'exports').mkdir(exist_ok=True)
    for f in DOC.iterdir():
        if f.is_file():shutil.copyfile(f,WORK/'exports'/f.name)
    check_lock();print('Packaged',len(data['scenes']),'source scenes with 79 focused reviews.')


if __name__=='__main__':main()
