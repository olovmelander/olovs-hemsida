"""Source-area representation accounting. Neither tree count nor surveyed accuracy."""
from prepare import *
from rasterio.features import shapes
from shapely.strtree import STRtree
from scipy.spatial import cKDTree

def main():
 check_lock();scope=shape(read(DOC/'facility-scope.geojson')['features'][0]['geometry']);hold=shape(read(DOC/'protected-evaluation.geojson')['features'][0]['geometry'])
 with rasterio.open(OUT/'chm.tif') as src:h=src.read(1);t=src.transform
 owned=rasterize([(mapping(scope),1)],out_shape=h.shape,transform=t).astype(bool);canopy=owned&(h>=3)
 baselines=read(OUT/'stand-inputs/index.json');jobs={j['tileId']:j for j in read(OUT/'stand-output/index.json')};summary={};renders={}
 for mode,recordFile in [('before','baseline-records.json'),('after','pilot-records.json')]:
  records=read(OUT/recordFile);individuals=[(r,Point(r['easting'],r['northing']).buffer(r['radiusMetres'])) for r in records if scope.buffer(20).covers(Point(r['easting'],r['northing']))]
  indiv=rasterize([(mapping(g),1) for r,g in individuals],out_shape=h.shape,transform=t).astype(bool)
  stands=np.zeros(h.shape,dtype='uint8');standPolys=[]
  for item in baselines:
   tile=item['tile'];b=tile['bounds'];region=box(b['minEasting'],b['minNorthing'],b['maxEasting'],b['maxNorthing'])
   if not scope.intersects(region):continue
   if mode=='before':file=OUT/'stand-inputs'/item['file'];cell=4;size=64
   else:j=jobs[tile['id']];file=OUT/j['file'];cell=j['cellMetres'];size=j['width']
   values=np.fromfile(file,dtype='uint8').reshape(size,size,4);eligible=((values[:,:,3]&1)>0)&((values[:,:,3]&4)==0)&(values[:,:,0]>=39)&(values[:,:,1]>=10)
   tf=from_origin(b['minEasting'],b['maxNorthing'],cell,cell);raster=np.zeros(h.shape,dtype='uint8')
   reproject(eligible.astype('uint8'),raster,src_transform=tf,src_crs='EPSG:3006',dst_transform=t,dst_crs='EPSG:3006',resampling=Resampling.nearest)
   stands|=raster
   for geom,val in shapes(eligible.astype('uint8'),mask=eligible,transform=tf):
    g=shape(geom).intersection(scope)
    if not g.is_empty:standPolys.append(feature(g,tile=tile['id'],cellMetres=cell,role='eligible-measured-woodland',mode=mode))
  represented=(indiv|(stands>0))&owned;miss=canopy&~represented
  summary[mode]=dict(individualCentresInFacility=sum(scope.covers(Point(r['easting'],r['northing'])) for r,g in individuals),
   heightArea3m=int(canopy.sum()),representedHeightAreaMetres2=int(np.sum(canopy&represented)),unrepresentedHeightAreaMetres2=int(miss.sum()),
   representedFraction=float(np.sum(canopy&represented)/canopy.sum()),extraRepresentationBelow3mMetres2=int(np.sum(represented&np.isfinite(h)&(h<3))))
  renders[mode]=represented
  save(DOC/(mode+'-individual-coverage.geojson'),collection([feature(g.intersection(scope),id=r['id'],easting=r['easting'],northing=r['northing'],radiusMetres=r['radiusMetres'],heightMetres=r['objectHeightMetres'],mode=mode) for r,g in individuals if g.intersects(scope)]))
  save(DOC/(mode+'-woodland-coverage.geojson'),collection(standPolys))
  gaps=[feature(shape(g),role='unresolved-height-representation',mode=mode,areaMetres2=shape(g).area) for g,v in shapes(miss.astype('uint8'),mask=miss,transform=t)]
  save(DOC/(mode+'-canopy-gaps.geojson'),collection(gaps))
  # Transparent review map rasters, native 1 m source grid.
  rgba=np.zeros((*h.shape,4),dtype='uint8');rgba[stands.astype(bool)&owned]=[32,150,90,125];rgba[indiv&owned]=[50,180,250,190];rgba[miss]=[245,110,40,180]
  Image.fromarray(rgba).save(OUT/f'review/{mode}-representation.png')
  for name,selected,color in [('woodland',(stands>0)&owned,[32,150,90,150]),('gaps',miss,[245,110,40,180])]:
   layer=np.zeros_like(rgba);layer[selected]=color;Image.fromarray(layer).save(OUT/f'review/{mode}-{name}.png')
 cells=read(DOC/'coverage-inspection.geojson')
 for f in cells['features']:
  cm=rasterize([(f['geometry'],1)],out_shape=h.shape,transform=t).astype(bool)
  f['properties']['representation']={mode:dict(canopyAreaMetres2=int(np.sum(canopy&cm)),representedHeightAreaMetres2=int(np.sum(canopy&cm&r)),unresolvedHeightAreaMetres2=int(np.sum(canopy&cm&~r))) for mode,r in renders.items()}
 save(DOC/'coverage-accounting.geojson',cells)
 save(DOC/'coverage-summary.json',dict(cells=len(cells['features']),sourceInspected=sum(f['properties']['inspected'] for f in cells['features']),areaMetres2=scope.area,extraBeltMetres=30,
  counts=summary,physicalHeightAreaGainMetres2=summary['after']['representedHeightAreaMetres2']-summary['before']['representedHeightAreaMetres2'],
  definition='Native 1 m height>=3 m pixels inside facility intersect published circular individual footprints or runtime-eligible measured stand fields (fraction>=0.15, mean height>=2.5 m). Stand occupancy does not prove a drawn crown at each pixel.',
  limits=['Includes elevated non-vegetation such as roofs and utility wires; gaps remain explicit, not automatically planted.',
   'Full cell inspection is not exhaustive individual-crown verification.','Source area coverage is separate from detection precision/recall and surveyed accuracy.']))
 print(read(DOC/'coverage-summary.json'))

if __name__=='__main__':main()
