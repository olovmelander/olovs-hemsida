"""Freeze independent source windows before any crown-candidate output."""
from prepare import *
SCENES=[
 ('cal12',683525.5,7023700.5,12,'calibration'),
 ('cal11',683675.5,7023615.5,11,'calibration'),
 ('cal07',683615.5,7023365.5,7,'calibration'),
 ('cal17',683880.5,7023230.5,17,'calibration'),
 ('cal18',684015.5,7023230.5,18,'calibration'),
 ('cal05',683885.5,7022645.5,5,'calibration'),
 ('calshort',684075.5,7022785.5,7,'calibration'),
 ('calcampus',684395.5,7022930.5,18,'calibration'),
 ('cal04',683990.5,7022520.5,4,'calibration'),
 ('cal14',683535.5,7023250.5,14,'calibration'),
 ('cal10',684085.5,7023430.5,10,'calibration'),
 ('eval09',684225.5,7023105.5,9,'evaluation'),
 ('eval16',684020.5,7023000.5,16,'evaluation'),
 ('eval02',684235.5,7022455.5,2,'evaluation'),
 ('evalrange',684415.5,7022675.5,1,'evaluation'),
]
def main():
 check_lock();scenes=[];protected=[];directory=OUT/'reference-panels';directory.mkdir(exist_ok=True)
 prior=DOC/'reference-window-lock.json'
 if prior.exists() and not (DOC/'reference-window-initial.json').exists():
  save(DOC/'reference-window-initial.json',dict(**read(prior),revisionReason='Source-only reconnaissance found a useful treeless pond control and several ambiguous dense groups. Add three windows before any reference freeze or detector output to meet sample sizes without inventing interpretable crowns.'))
 for id,x,y,h,split in SCENES:
  b=[x-50,y-50,x+50,y+50];scene=dict(id=id,easting=x,northing=y,size=100,bounds=b,hole=h,split=split)
  scenes.append(scene)
  if split=='evaluation':protected.append(box(*b).buffer(20))
  a,t,sources=rgbi_window(b);height=chm_window(b)
  layers=[('rgb',np.moveaxis(a[:3],0,-1)),('chm',canopy_rgb(height)),('cir',np.moveaxis(a[[3,0,1]],0,-1))]
  canvas=Image.new('RGB',(1640,840),'#16231d');d=ImageDraw.Draw(canvas)
  for i,(name,pixels) in enumerate(layers):
   im=Image.fromarray(pixels).resize((800,800),Image.Resampling.NEAREST if name=='chm' else Image.Resampling.BILINEAR)
   im.save(directory/(id+'-'+name+'.png'))
   if i>1:continue
   draw=ImageDraw.Draw(im)
   for k in range(0,801,80):draw.line((k,0,k,799),fill='#939999',width=1);draw.line((0,k,799,k),fill='#939999',width=1);draw.text((k+2,2),str(k//8),fill='white');draw.text((2,k+2),str(k//8),fill='white')
   canvas.paste(im,(i*820+10,30));d.text((i*820+10,8),id+' | '+name+' | grid metres, coordinates from top-left',fill='white')
  canvas.save(directory/(id+'-board.png'));save(directory/(id+'.json'),dict(**scene,sources=sources))
 save(OUT/'scenes.json',scenes)
 hold=unary_union(protected);assert not any(hold.intersects(box(*s['bounds'])) for s in scenes if s['split']=='calibration')
 save(DOC/'protected-evaluation.geojson',collection([feature(hold,role='evaluation-source-windows-plus-20m')]))
 save(DOC/'reference-window-lock.json',dict(scenesSha256=digest(OUT/'scenes.json'),protectedSha256=digest(DOC/'protected-evaluation.geojson'),
  phase='Source windows frozen before reference annotations or detector output',sourcePanels={s['id']:digest(directory/(s['id']+'-board.png')) for s in scenes}))
 print('Frozen',len(scenes),'source windows; evaluation area',hold.area)
if __name__=='__main__':main()
