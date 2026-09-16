"""Number frozen-method candidates for a separate source review, before editing."""
from round2_benchmark import *

def main():
    core.OUT=WORK;lock=read(DOC/'detector-lock.json');features=[]
    assert digest(ROOT/'tools/visby-tree-pilot/round2_benchmark.py')==lock['detectorCodeSha256']
    assert digest(ROOT/'tools/visby-tree-pilot/round2-detect.R')==lock['rCodeSha256']
    records=read(OUT/'pilot-records.json')
    for scene in read(WORK/'review-scenes.json'):
        meta=read(WORK/'review'/(scene['id']+'.json'));w,s,e,n=meta['bounds'];region=box(w+3,s+3,e-3,n-3)
        preds=[p for p in recover(core.geometry_candidates(scene,lock['method']),components(scene,lock['maximumIslandAreaMetres2'])) if region.covers(p['point'])]
        preds.sort(key=lambda p:(-p['point'].y,p['point'].x))
        canvas=Image.new('RGB',(1800,630),'#15201c');draw=ImageDraw.Draw(canvas)
        for i,p in enumerate(preds):
            p.update(scene=scene['id'],reviewNumber=i+1,hole=scene['hole'])
            nearest=min(records,key=lambda r:p['point'].distance(Point(r['easting'],r['northing'])))
            p['nearestExistingId']=nearest['id'];p['nearestExistingMetres']=p['point'].distance(Point(nearest['easting'],nearest['northing']))
        features+=export(preds)
        for col,name in enumerate(['rgb','cir','chm']):
            im=Image.open(WORK/'review'/(scene['id']+'-'+name+'.png')).resize((600,600));d=ImageDraw.Draw(im)
            def xy(x,y):return ((x-w)/(e-w)*600,(n-y)/(n-s)*600)
            for p in preds:
                geoms=[p['geometry']] if p['geometry'].geom_type=='Polygon' else list(p['geometry'].geoms)
                for g in geoms:d.line([xy(x,y) for x,y in g.exterior.coords],fill='#ffc65c',width=1)
                x,y=xy(p['point'].x,p['point'].y);d.ellipse((x-2,y-2,x+2,y+2),fill='white');d.text((x+4,y-8),str(p['reviewNumber']),fill='white',stroke_width=1,stroke_fill='black')
            for r in records:
                if region.covers(Point(r['easting'],r['northing'])):
                    x,y=xy(r['easting'],r['northing']);d.rectangle((x-3,y-3,x+3,y+3),outline='#52eafa',width=2)
            canvas.paste(im,(col*600,30));draw.text((col*600,8),scene['id']+' '+name+' / orange candidates, cyan existing',fill='white')
        canvas.save(WORK/'review'/(scene['id']+'-candidates.png'))
        print(scene['id'],[(p['reviewNumber'],round(p['height'],1),round(p['nearestExistingMetres'],1)) for p in preds])
    save(WORK/'placement-candidates.geojson',dict(type='FeatureCollection',crs=dict(type='name',properties=dict(name='EPSG:3006')),features=features))

if __name__=='__main__':main()
