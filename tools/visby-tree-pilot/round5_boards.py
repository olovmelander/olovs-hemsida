"""Four-source boards with separate facility, cell and new-review boundaries."""
from round5 import *


def main():
    check_lock();candidates=read(WORK/'placement-candidates.geojson')['features'];records=read(PREVIOUS/'pilot-records.json')
    scope=facility();extra=extension();reserve=protected()
    def polygons(g):
        if g.is_empty:return []
        if g.geom_type=='Polygon':return [g]
        return [p for part in g.geoms for p in polygons(part)] if hasattr(g,'geoms') else []
    for scene in read(WORK/'review-scenes.json'):
        sid=scene['id'];meta=read(WORK/'review'/(sid+'.json'));local=[f for f in candidates if f['properties']['scene']==sid]
        canvas=Image.new('RGB',(1040,1100),'#13221b');label=ImageDraw.Draw(canvas)
        for index,layer in enumerate(['rgb','cir','chm','2022']):
            im=Image.open(WORK/'review'/(sid+'-'+layer+'.png')).resize((520,520));d=ImageDraw.Draw(im)
            w,s,e,n=meta['layerBounds'].get(layer,meta['bounds'])
            def xy(x,y):return ((x-w)/(e-w)*520,(n-y)/(n-s)*520)
            def boundary(g,colour,width=1):
                for p in polygons(g):
                    for ring in [p.exterior,*p.interiors]:d.line([xy(x,y) for x,y in ring.coords],fill=colour,width=width)
            cell=box(*scene['ownedBounds']);boundary(cell,'#bcbcbc');boundary(scope.intersection(cell),'#ffffff',2)
            boundary(extra.intersection(cell).difference(reserve),'#ff73e5',2)
            boundary(reserve.intersection(cell),'#b995ff',2)
            for f in local:
                p=f['properties'];focus=p['nearestExistingMetres']>6 and not p['protectedEvaluation'];colour='#ffc65c' if focus else '#b39bdd' if p['protectedEvaluation'] else '#69b7c6'
                boundary(shape(f['geometry']),colour)
                if focus:
                    x,y=xy(p['easting'],p['northing']);d.text((x+3,y-9),str(p['reviewNumber']),fill='white',stroke_width=1,stroke_fill='black');d.ellipse((x-2,y-2,x+2,y+2),fill='white')
            for r in records:
                if owns(meta['bounds'],r['easting'],r['northing']):
                    x,y=xy(r['easting'],r['northing']);d.rectangle((x-2,y-2,x+2,y+2),outline='#52eafa')
            col=index%2;row=index//2;canvas.paste(im,(col*520,30+row*540));label.text((col*520+5,10+row*540),sid+' '+layer+' | new facility area: magenta',fill='white')
        label.text((5,1090),'Orange numbered: new candidates. Cyan squares: retained individuals. Full facility: white. Cell: grey. Protected: purple.',fill='white')
        canvas.save(WORK/'review'/(sid+'-board.png'))
    print('Boards',len(read(WORK/'review-scenes.json')))

if __name__=='__main__':main()
