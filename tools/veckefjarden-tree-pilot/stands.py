"""Same stand payload contract, 1 m near play; protect held-out runtime tiles."""
from prepare import *
from shapely.strtree import STRtree

def mask(geoms,t,size,touched=False):
 return rasterize([(mapping(g),1) for g in geoms if not g.is_empty],out_shape=(size,size),transform=t,all_touched=touched,dtype='uint8').astype(bool) if any(not g.is_empty for g in geoms) else np.zeros((size,size),bool)

def refine(chm,old):
 measured=np.isfinite(chm)&((old[:,:,3]&1)>0);excluded=(old[:,:,3]&4)>0
 eligible=measured&~excluded&(old[:,:,0]>0)&(chm>=2)
 values=np.zeros_like(old);values[:,:,0]=eligible*255
 heights=np.clip(np.floor(np.nan_to_num(chm,nan=0)*4+.5),0,255).astype('uint8')
 values[:,:,1]=np.where(eligible,heights,0);values[:,:,2]=values[:,:,1]
 values[:,:,3]=measured.astype('uint8')|(old[:,:,3]&2)|(excluded.astype('uint8')*4)
 return values

def main():
 check_lock();scope=shape(read(DOC/'facility-scope.geojson')['features'][0]['geometry'])
 corridor=shape(read(DOC/'playing-corridor.geojson')['features'][0]['geometry'])
 hold=shape(read(DOC/'protected-evaluation.geojson')['features'][0]['geometry'])
 records=read(OUT/'pilot-record-drafts.json')
 individuals=[Point(r['easting'],r['northing']).buffer(r['radiusMetres']) for r in records if scope.buffer(20).covers(Point(r['easting'],r['northing']))]
 tree=STRtree(individuals);jobs=[];directory=OUT/'stand-output';directory.mkdir(exist_ok=True)
 with rasterio.open(OUT/'chm.tif') as src:
  for item in read(OUT/'stand-inputs/index.json'):
   tile=item['tile'];b=tile['bounds'];bounds=[b['minEasting'],b['minNorthing'],b['maxEasting'],b['maxNorthing']];region=box(*bounds)
   base=np.fromfile(OUT/'stand-inputs'/item['file'],dtype=np.uint8).reshape(64,64,4)
   protected=hold.intersects(region);fine=corridor.intersects(region) and not protected
   cell=1 if fine else 4;size=256 if fine else 64;t=from_origin(bounds[0],bounds[3],cell,cell)
   old=np.repeat(np.repeat(base,4,0),4,1) if fine else base.copy()
   owned=mask([scope],t,size);holdmask=mask([hold],t,size,True)
   values=old.copy()
   if fine:
    win=from_bounds(*bounds,transform=src.transform)
    assert np.allclose([win.col_off,win.row_off,win.width,win.height],np.round([win.col_off,win.row_off,win.width,win.height]),rtol=0,atol=1e-7)
    h=src.read(1,window=win);assert h.shape==(256,256)
    refined=refine(h,old);values[owned]=refined[owned]
   local=[individuals[int(i)] for i in tree.query(region)]
   blocked=mask(local,t,size,True)&owned&~holdmask
   values[blocked,:3]=0;values[blocked,3]|=4
   assert np.array_equal(values[~owned|holdmask],old[~owned|holdmask]),'Outside scope/evaluation changed'
   changed=fine or not np.array_equal(values,base)
   file=directory/item['file'];values.tofile(file)
   eligible=lambda a:(a[:,:,0]>0)&((a[:,:,3]&1)>0)&((a[:,:,3]&4)==0)
   jobs.append(dict(tileId=tile['id'],file=file.relative_to(OUT).as_posix(),cellMetres=cell,width=size,height=size,changed=changed,protectedTile=protected,
    sha256=digest(file),bytes=file.stat().st_size,canopyAreaMetres2=float(np.sum(values[:,:,0]/255*eligible(values))*cell*cell),
    baselineCanopyAreaMetres2=float(np.sum(base[:,:,0]/255*eligible(base))*16),blockedCells=int(blocked.sum())))
 save(directory/'index.json',jobs)
 save(DOC/'stand-summary.json',dict(fineTiles=sum(j['cellMetres']==1 for j in jobs),changedTiles=sum(j['changed'] for j in jobs),
  protectedCoarseTiles=sum(j['protectedTile'] for j in jobs),coarseTiles=sum(j['cellMetres']==4 for j in jobs),
  baselineEligibleCanopyAreaMetres2=sum(j['baselineCanopyAreaMetres2'] for j in jobs),afterEligibleCanopyAreaMetres2=sum(j['canopyAreaMetres2'] for j in jobs),
  individualFootprints=len(individuals),
  method='Native 1 m height cells within reviewed facility on near-play tiles. Preserve baseline exclusions, individual footprint exclusions and unknown pixels; 4 m elsewhere.',
  evaluation='Tiles intersecting evaluation stay 4 m; held-out cells unchanged. A protected tile can have corrections in its non-evaluation portion.',
  outsideScope='Source values unchanged (4x repeated in fine tiles). Representative procedural positions can change with cell size at the processing tile fringe; individual records remain stable.',
  limitations=['Baseline eligibility is conservative and is not expanded automatically.','Fine-grid definition improves source sampling but is not surveyed trunk accuracy.']))
 print(read(DOC/'stand-summary.json'))

if __name__=='__main__':main()
