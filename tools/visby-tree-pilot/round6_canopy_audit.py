"""Find height-supported facility pixels outside crowns and measured stands.

This is a representation gap audit, not a tree count or independent accuracy
score. Building returns and crown overhang can appear among the gaps. Unknown
height pixels remain explicit and are never interpreted as confirmed open ground.
"""
from round6 import *
from rasterio.features import rasterize, shapes
from scipy import ndimage


def main():
    check_lock();baseline='--baseline' in sys.argv;directory=PREVIOUS if baseline else WORK
    scope=facility();w,s,e,n=scope.bounds
    with rasterio.open(OUT/'chm.tif') as src:
        raw=from_bounds(w,s,e,n,transform=src.transform)
        col=int(np.floor(raw.col_off));row=int(np.floor(raw.row_off))
        window=rasterio.windows.Window(col,row,int(np.ceil(raw.col_off+raw.width))-col,int(np.ceil(raw.row_off+raw.height))-row)
        height=src.read(1,window=window);transform=src.window_transform(window)
    def mask(geometries):
        geometries=[g for g in geometries if not g.is_empty]
        return rasterize([(mapping(g),1) for g in geometries],out_shape=height.shape,transform=transform,dtype='uint8',all_touched=False).astype(bool) if geometries else np.zeros(height.shape,bool)
    inside=mask([scope]);reserved=mask([protected()]);supported=inside&np.isfinite(height)&(height>=3)
    suppressed={c['recordId'] for c in read(PRIOR_DOC/'suppression-review.json')['cases']}
    footprints={f['properties']['id']:shape(f['geometry']) for f in read(directory/'pilot-footprints.geojson')['features']}
    records=[r for r in read(directory/'pilot-records.json') if r['id'] not in suppressed]
    individuals=mask([footprints.get(r['id'],Point(r['easting'],r['northing']).buffer(r['radiusMetres'])) for r in records])
    inputs={i['tile']['id']:i['tile']['bounds'] for i in read(OUT/'stand-inputs/index.json')};stands=np.zeros(height.shape,dtype='uint8');woodland=[]
    for job in read(directory/'stand-output/index.json'):
        b=inputs[job['tileId']];region=box(b['minEasting'],b['minNorthing'],b['maxEasting'],b['maxNorthing'])
        if not region.intersects(scope):continue
        data=np.fromfile(directory/job['file'],dtype=np.uint8).reshape(job['height'],job['width'],4)
        eligible=((data[:,:,0]>0)&((data[:,:,3]&1)>0)&((data[:,:,3]&4)==0)).astype('uint8')
        source_transform=from_origin(b['minEasting'],b['maxNorthing'],job['cellMetres'],job['cellMetres']);local=np.zeros_like(stands)
        reproject(eligible,local,src_transform=source_transform,src_crs='EPSG:3006',dst_transform=transform,dst_crs='EPSG:3006',resampling=Resampling.nearest)
        stands=np.maximum(stands,local)
        if not baseline:
            for geometry,value in shapes(eligible,mask=eligible>0,transform=source_transform):
                g=shape(geometry).intersection(scope)
                if not g.is_empty:woodland.append(dict(type='Feature',geometry=mapping(g),properties=dict(id=f"stand-{job['tileId']}-{len(woodland)+1}",role='measured-stand-coverage',cellMetres=job['cellMetres'],tileId=job['tileId'],meaning='Eligible canopy cells, not surveyed stems or a polygon to scatter uniformly.')))
    unresolved=[]
    issues_path=DOC/'issue-index.json'
    if not baseline and issues_path.exists():unresolved=[shape(c['geometry']) for c in read(issues_path)['cases'] if c['group']!='round5-unrepresented-height']
    else:unresolved=[shape(c['geometry']) for c in read(PRIOR_DOC/'issue-index.json')['cases'] if c['group']!='round5-unrepresented-height']
    issue_mask=mask(unresolved)
    represented=individuals|(stands>0);gaps=supported&~represented
    components,count=ndimage.label(gaps,structure=np.ones((3,3)));sizes=np.bincount(components.ravel());features=[]
    slices=ndimage.find_objects(components)
    for geometry,value in shapes(components.astype('int32'),mask=gaps,transform=transform,connectivity=8):
        value=int(value);g=shape(geometry).buffer(0);sl=slices[value-1];local=components[sl]==value
        features.append(dict(type='Feature',geometry=mapping(g),properties=dict(id=f'height-gap-{value:05}',areaMetres2=int(sizes[value]),maximumHeightMetres=float(np.nanmax(height[sl][local])),
            protectedPixels=int(np.sum(local&reserved[sl])),priorIssuePixels=int(np.sum(local&issue_mask[sl])),role='unrepresented-height-support',status='needs-triage',
            meaning='Height support outside published individual footprints and eligible stand cells; may include structures, overhang or unresolved vegetation. Not a confirmed missing tree.')))
    prefix='baseline-' if baseline else ''
    summary=dict(mode='round5' if baseline else 'round6',scopeAreaMetres2=scope.area,sourcePixelMetres=1,scopePixelCount=int(inside.sum()),finiteHeightPixelCount=int(np.sum(inside&np.isfinite(height))),
        unknownHeightPixelCount=int(np.sum(inside&~np.isfinite(height))),heightSupportedPixels=int(supported.sum()),representedHeightPixels=int(np.sum(supported&represented)),
        individualSupportedPixels=int(np.sum(supported&individuals)),standSupportedPixels=int(np.sum(supported&(stands>0))),unrepresentedHeightPixels=int(gaps.sum()),
        protectedGapPixels=int(np.sum(gaps&reserved)),unresolvedCaseGapPixels=int(np.sum(gaps&issue_mask)),components=count,componentsAtLeast25Metres2=int(np.sum(sizes[1:]>=25)),
        limitations='Not a stem census or measured accuracy. Includes all height returns, including possible structures and crown overhang. Raster-centre accounting uses the native 1 m grid. Unknown height is not absence. Coarse stand cells indicate retained density treatment, not precise stem positions.')
    save(DOC/(prefix+'canopy-audit.json'),summary);save(DOC/(prefix+'canopy-gaps.geojson'),collection(features))
    if not baseline:
        save(DOC/'woodland-coverage.geojson',collection(woodland))
        save(DOC/'individual-coverage.geojson',collection([dict(type='Feature',geometry=mapping(footprints.get(r['id'],Point(r['easting'],r['northing']).buffer(r['radiusMetres'])).intersection(scope)),properties=dict(id=r['id'],role='published-individual',positionKind='LiDAR-derived crown centre; not surveyed stem')) for r in records if scope.intersects(footprints.get(r['id'],Point(r['easting'],r['northing']).buffer(r['radiusMetres'])))]))
    print(json.dumps(summary,indent=2));check_lock()

if __name__=='__main__':main()
