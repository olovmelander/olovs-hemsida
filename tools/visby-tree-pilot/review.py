"""Build a self-contained local source review and matched screenshot comparison."""
from prepare import *
import shutil

def main():
    doc=ROOT/'geo_data/course-v2/visby/vegetation/pilot'
    baseline=read(OUT/'baseline-records.json');after=read(OUT/'pilot-records.json');catalogue=read(doc/'corrections.json')
    ids={e['id'] for e in catalogue['edits'] if e['decision']=='accepted-source-relative-preview'}
    scenes=[read(OUT/'review'/(s['id']+'.json')) for s in read(OUT/'scenes.json')]
    selection=read(doc/'detector-selection.json')['selected']
    data=dict(scenes=scenes,reference=read(doc/'reference.geojson'),footprints=read(OUT/'pilot-footprints.geojson'),
        baseline=baseline,after=after,acceptedIds=sorted(ids),node=read(OUT/'detections/node-current.geojson'),
        lidr=read(OUT/'detections'/(selection+'.geojson')),selection=selection,metrics=read(doc/'benchmark.json')['metrics'],
        overview=dict(bounds=[687050,6370470,688400,6372030]),stands=read(doc/'stand-summary.json'),
        catalogue=catalogue)
    # Actual drawn bases, not a second implementation of the procedural placement.
    for name in ['before','after']:
        file=OUT/'captures'/name/'webgpu-high-instances.json'
        if file.exists():
            raw=read(file);origin=read(OUT/'baseline.json')['ground']['frame']['origin']
            data[name+'Bases']=[[round(origin['easting']+a[0],2),round(origin['northing']-a[2],2),a[6]] for a in raw['instances']
                if any(s['bounds'][0]<=origin['easting']+a[0]<=s['bounds'][2] and s['bounds'][1]<=origin['northing']-a[2]<=s['bounds'][3] for s in scenes)]
    (OUT/'review-data.js').write_text('window.PILOT='+json.dumps(data,separators=(',',':'))+';\n',encoding='utf-8')
    shutil.copyfile(ROOT/'tools/visby-tree-pilot/review.html',OUT/'review.html')
    (OUT/'exports').mkdir(exist_ok=True)
    for file in doc.glob('*'):
        if file.is_file():shutil.copyfile(file,OUT/'exports'/file.name)
    print('Review map: /pilot-review/review.html')

if __name__=='__main__':main()
