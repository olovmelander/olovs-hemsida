"""Every owned cell has RGB, infrared and LiDAR review, including the extra belt."""
from prepare import *

def main():
 check_lock();cells=read(DOC/'coverage-plan.geojson');directory=OUT/'review/cells';directory.mkdir(parents=True,exist_ok=True)
 scope=shape(read(DOC/'facility-scope.geojson')['features'][0]['geometry'])
 protected=shape(read(DOC/'protected-evaluation.geojson')['features'][0]['geometry'])
 records=read(OUT/'baseline-records.json');rows=[]
 sheet=None
 with rasterio.open(OUT/'chm.tif') as src:
  for i,f in enumerate(cells['features']):
   p=f['properties'];b=p['bounds'];owned=shape(f['geometry']);id=p['id'];a,t,sources=rgbi_window(b,.16)
   h=np.full((100,100),np.nan,dtype=np.float32);ht=from_origin(b[0],b[3],1,1)
   reproject(rasterio.band(src,1),h,src_transform=src.transform,src_crs=src.crs,dst_transform=ht,dst_crs=src.crs,resampling=Resampling.nearest)
   mask=rasterize([(mapping(owned),1)],out_shape=h.shape,transform=ht).astype(bool)
   ownRecords=[r for r in records if b[0]<=r['easting']<b[2] and b[1]<=r['northing']<b[3] and owned.covers(Point(r['easting'],r['northing']))]
   p.update(sourceRgbIComplete=True,canopyArea3mMetres2=int(np.sum(mask&(h>=3))),unknownHeightMetres2=int(np.sum(mask&~np.isfinite(h))),baselineIndividualCentres=len(ownRecords),protectedEvaluation=protected.intersects(owned),sources=sources)
   rows.append(p)
   rgb=np.moveaxis(a[:3],0,-1);cir=np.moveaxis(a[[3,0,1]],0,-1)
   red=a[0].astype(float);nir=a[3].astype(float);ndvi=np.divide(nir-red,nir+red,out=np.zeros_like(red),where=nir+red>0)
   # Display contrast only: never used as a presence/deletion threshold.
   ndviPixels=(colormaps['RdYlGn']((ndvi+1)/2)[:,:,:3]*255).astype(np.uint8)
   pictures=[]
   for name,pixels in [('rgb',rgb),('cir',cir),('chm',canopy_rgb(h)),('vegetation',ndviPixels)]:
    im=Image.fromarray(pixels).resize((625,625),Image.Resampling.NEAREST if name=='chm' else Image.Resampling.BILINEAR)
    im.save(directory/(id+'-'+name+'.png'))
    if name=='vegetation':continue
    im=im.resize((400,400));draw=ImageDraw.Draw(im)
    shapes=owned.geoms if owned.geom_type=='MultiPolygon' else [owned]
    for poly in shapes:draw.line([((x-b[0])*4,(b[3]-y)*4) for x,y in poly.exterior.coords],fill='white',width=2)
    if name=='chm':
     for r in ownRecords:
      x=(r['easting']-b[0])*4;y=(b[3]-r['northing'])*4;draw.ellipse((x-2,y-2,x+2,y+2),outline='#ffcc33')
    pictures.append(im)
   if i%4==0:sheet=Image.new('RGB',(1220,1700),'#15201c')
   dr=ImageDraw.Draw(sheet);top=(i%4)*425
   dr.text((5,top+3),f'{i+1:03} {id} | RGB / infrared / height + baseline centres | canopy {p["canopyArea3mMetres2"]} m2 | unknown {p["unknownHeightMetres2"]} m2',fill='white')
   for k,im in enumerate(pictures):sheet.paste(im,(k*405+5,top+22))
   if i%4==3 or i==len(cells['features'])-1:sheet.save(OUT/f'review/contact-{i//4+1:02}.png')
   if i%20==0:print(i+1,'/',len(cells['features']),flush=True)
 save(DOC/'coverage-source-inventory.geojson',cells)
 save(OUT/'review/cells.json',rows)
 print('All',len(rows),'cell panels ready; inspection statuses remain unreviewed until visually inspected')

if __name__=='__main__':main()
