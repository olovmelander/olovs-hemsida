"""Refine measured stands inside the play corridor; retain the baseline elsewhere.

The existing semantic exclusion/eligibility mask remains a conservative gate.
All cells touched by an individual crown or reviewed clearing are unplantable,
including across tile boundaries. No imagery threshold changes tree presence.
"""
from prepare import *
from shapely.geometry import shape, Point, Polygon, box, mapping
from shapely.ops import unary_union
from rasterio.features import rasterize

DOC=ROOT/'geo_data/course-v2/visby/vegetation/pilot'


def mask_geometries(geometries, transform, size, all_touched=True):
    if not geometries:return np.zeros((size,size),dtype=bool)
    return rasterize([(mapping(g),1) for g in geometries],out_shape=(size,size),transform=transform,all_touched=all_touched,dtype='uint8').astype(bool)


def refine(chm, baseline, blocked):
    """A source pixel is a 1 m cell, never an interpolated tree height."""
    old=np.repeat(np.repeat(baseline,4,axis=0),4,axis=1)
    if chm.shape!=old.shape[:2] or blocked.shape!=chm.shape:raise ValueError('unaligned field inputs')
    measured=np.isfinite(chm)&((old[:,:,3]&1)>0)
    excluded=((old[:,:,3]&4)>0)|blocked
    eligible=measured&~excluded&(old[:,:,0]>0)&(chm>=2)
    out=np.zeros((*chm.shape,4),dtype=np.uint8)
    out[:,:,0]=eligible.astype(np.uint8)*255
    height=np.clip(np.floor(np.nan_to_num(chm,nan=0)*4+.5),0,255).astype(np.uint8)
    out[:,:,1]=np.where(eligible,height,0);out[:,:,2]=out[:,:,1]
    out[:,:,3]=measured.astype(np.uint8)|(old[:,:,3]&2)|(excluded.astype(np.uint8)*4)
    return out


def main():
    inputs=read(OUT/'stand-inputs/index.json');exclusions=read(OUT/'exclusions.json')
    records=read(OUT/'pilot-record-drafts.json')
    edited={f['properties']['id']:shape(f['geometry']) for f in read(OUT/'pilot-footprints.geojson')['features']}
    individuals=[edited.get(r['id'],Point(r['easting'],r['northing']).buffer(r['radiusMetres'])) for r in records]
    held=[shape(f['geometry']) for f in read(OUT/'pilot-footprints.geojson')['features'] if f['properties']['role']=='unresolved-crown-overhang']
    clearings=[shape(f['geometry']) for f in read(DOC/'reference.geojson')['features'] if f['properties']['role']=='clearing']
    surfaces=[Polygon(a['ring']).buffer(0) for a in exclusions['reviewedPlayingAreas']]
    surfaces += [Polygon(r).buffer(0) for f in exclusions['features'] if f['kind'] in ['green','tee','fairway','bunker','practice'] for r in f.get('rings',[])]
    corridor=unary_union(surfaces).buffer(30)
    # Exact recent playing surfaces supplement the older conservative baseline mask.
    turf=[Polygon(a['ring']).buffer(.5) for a in exclusions['reviewedPlayingAreas']]
    blockers=individuals+held+clearings+turf
    directory=OUT/'stand-output';directory.mkdir(exist_ok=True);jobs=[]
    with rasterio.open(OUT/'chm.tif') as src:
        for item in inputs:
            tile=item['tile'];b=tile['bounds'];bounds=(b['minEasting'],b['minNorthing'],b['maxEasting'],b['maxNorthing']);region=box(*bounds)
            fine=corridor.intersects(region)
            cell=1 if fine else 4;size=round((bounds[2]-bounds[0])/cell);transform=from_origin(bounds[0],bounds[3],cell,cell)
            baseline=np.fromfile(OUT/'stand-inputs'/item['file'],dtype=np.uint8).reshape(64,64,4)
            local=[g for g in blockers if g.intersects(region)]
            blocked=mask_geometries(local,transform,size)
            if fine:
                window=from_bounds(*bounds,transform=src.transform)
                if not np.allclose([window.col_off,window.row_off,window.width,window.height],np.round([window.col_off,window.row_off,window.width,window.height]),rtol=0,atol=1e-6):raise ValueError('CHM and tile edges do not align')
                chm=src.read(1,window=window)
                values=refine(chm,baseline,blocked)
            else:
                values=baseline.copy();values[blocked,0:3]=0;values[blocked,3]|=4
            changed=fine or not np.array_equal(values,baseline)
            file=directory/item['file'];values.tofile(file)
            jobs.append(dict(tileId=tile['id'],file=str(file.relative_to(OUT)).replace('\\','/'),cellMetres=cell,width=size,height=size,
                changed=changed,sha256=digest(file),canopyAreaMetres2=float(np.sum(values[:,:,0]/255)*cell*cell),
                baselineCanopyAreaMetres2=float(np.sum(baseline[:,:,0]/255)*16),blockedCells=int(np.sum(blocked)),bytes=file.stat().st_size))
    save(directory/'index.json',jobs)
    save(DOC/'stand-summary.json',dict(fineTiles=sum(j['cellMetres']==1 for j in jobs),coarseTiles=sum(j['cellMetres']==4 for j in jobs),
        changedTiles=sum(j['changed'] for j in jobs),playingBufferMetres=30,baselineCanopyAreaMetres2=sum(j['baselineCanopyAreaMetres2'] for j in jobs),
        remainingStandCanopyAreaMetres2=sum(j['canopyAreaMetres2'] for j in jobs),individualFootprints=len(individuals),heldOverhangFootprints=len(held),reviewedClearings=len(clearings),
        masks='Conservative baseline eligibility + all-touched individual crown footprints + source-reviewed clearings + 2026 playing surfaces (0.5 m buffer).',
        limitation='Crown occupancy, not surveyed stem locations. Baseline 4 m eligibility remains conservative; finer cells do not recover canopy it previously omitted.'))
    print(json.dumps(read(DOC/'stand-summary.json'),indent=2))


if __name__=='__main__':main()
