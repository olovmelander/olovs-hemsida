"""Local source map with independently evaluated candidates and reviewed edits."""
from round2 import *
import shutil

def main():
    catalogue=read(DOC/'corrections.json');evaluation=read(DOC/'evaluation.json')
    corrections=dict(type='FeatureCollection',crs=dict(type='name',properties=dict(name='EPSG:3006')),
        features=[dict(type='Feature',geometry=e['geometry'],properties={k:v for k,v in e.items() if k!='geometry'}) for e in catalogue['edits']])
    save(DOC/'corrections.geojson',corrections)
    scenes=[read(WORK/'review'/(s['id']+'.json')) for s in read(WORK/'review-scenes.json')+read(WORK/'scenes.json')]
    data=dict(scenes=scenes,corrections=corrections,reference=read(DOC/'reference.geojson'),evaluation=evaluation,validation=read(DOC/'validation.json'),
        node=read(WORK/'detections/fresh-node-current+islands0.geojson'))
    candidate=read(WORK/'detections'/('fresh-'+evaluation['selected']+'.geojson'))
    candidate['features']+=read(WORK/'placement-candidates.geojson')['features'];data['candidate']=candidate
    origin=read(OUT/'baseline.json')['ground']['frame']['origin']
    for name,directory in [('before',OUT/'captures/after'),('after',WORK/'captures')]:
        raw=read(directory/'webgpu-high-instances.json')
        data[name+'Bases']=[[round(origin['easting']+a[0],2),round(origin['northing']-a[2],2),a[6]] for a in raw['instances']
            if any(s['bounds'][0]<=origin['easting']+a[0]<=s['bounds'][2] and s['bounds'][1]<=origin['northing']-a[2]<=s['bounds'][3] for s in scenes)]
    (WORK/'review-data.js').write_text('window.PILOT2='+json.dumps(data,separators=(',',':'))+';\n',encoding='utf-8')
    shutil.copyfile(ROOT/'tools/visby-tree-pilot/round2-review.html',WORK/'review.html');(WORK/'exports').mkdir(exist_ok=True)
    for file in DOC.glob('*'):
        if file.is_file():shutil.copyfile(file,WORK/'exports'/file.name)
    print('http://127.0.0.1:8646/pilot-review/round2/review.html')

if __name__=='__main__':main()
