"""End-to-end invariants and source-conformance measurements on actual outputs."""
from prepare import *
from shapely.geometry import shape,Point,Polygon,LineString,mapping,box
from shapely.ops import unary_union
from shapely import STRtree,points
from scipy.spatial import cKDTree
from rasterio.features import shapes,geometry_mask
from rasterio.transform import Affine

DOC=ROOT/'geo_data/course-v2/visby/vegetation/pilot'

def drawn(mode,scenario='webgpu-high'):
    export=read(OUT/'captures'/mode/(scenario+'-instances.json'))
    origin=read(OUT/'baseline.json')['ground']['frame']['origin']
    return export,np.array([[origin['easting']+a[0],origin['northing']-a[2],a[6]] for a in export['instances']])

def hits(coords,geometries):
    if not len(coords) or not geometries:return 0
    # Coordinates are rounded to 1 cm by the browser diagnostic. Shrink that
    # tolerance before testing, rather than misclassifying a boundary point.
    found=STRtree([g.buffer(-.015) for g in geometries]).query(points(coords[:,:2]),predicate='within')
    return len(set(found[0].tolist()))

def canopy_geometry(mode,scene,records,footprints):
    meta=read(OUT/'review'/(scene+'.json'));region=box(*meta['bounds']).buffer(10);parts=[]
    jobs={j['tileId']:j for j in read(OUT/'stand-output/index.json')}
    for item in read(OUT/'stand-inputs/index.json'):
        b=item['tile']['bounds'];tilebox=box(b['minEasting'],b['minNorthing'],b['maxEasting'],b['maxNorthing'])
        if not region.intersects(tilebox):continue
        job=jobs[item['tile']['id']];cell=4 if mode=='before' else job['cellMetres'];size=round(256/cell)
        file=OUT/'stand-inputs'/item['file'] if mode=='before' else OUT/job['file']
        a=np.fromfile(file,dtype=np.uint8).reshape(size,size,4)
        x0=max(0,int((region.bounds[0]-b['minEasting'])//cell));x1=min(size,int(np.ceil((region.bounds[2]-b['minEasting'])/cell)))
        y0=max(0,int((b['maxNorthing']-region.bounds[3])//cell));y1=min(size,int(np.ceil((b['maxNorthing']-region.bounds[1])/cell)))
        a=a[y0:y1,x0:x1];valid=((a[:,:,3]&1)>0)&((a[:,:,3]&4)==0)&(a[:,:,0]>=39)&(a[:,:,1]>=10)
        transform=from_origin(b['minEasting']+x0*cell,b['maxNorthing']-y0*cell,cell,cell)
        parts.extend(shape(g) for g,v in shapes(valid.astype(np.uint8),mask=valid,transform=transform))
    for r in records:
        g=footprints.get(r['id'],Point(r['easting'],r['northing']).buffer(r['radiusMetres']))
        if g.intersects(region):parts.append(g)
    return unary_union(parts).intersection(region)

def main():
    baseline=read(OUT/'baseline.json');before=read(OUT/'baseline-records.json');after=read(OUT/'pilot-records.json');cat=read(DOC/'corrections.json')
    accepted=[e for e in cat['edits'] if e['decision']=='accepted-source-relative-preview'];holds=[e for e in cat['edits'] if e['action']=='hold-base']
    new={r['id']:r for r in after};old={r['id']:r for r in before};edited={e['id'] for e in accepted}
    assert len(new)==len(after) and old.keys()<=new.keys()
    assert all(new[k]==v for k,v in old.items() if k not in edited)
    assert not any(e['id'] in new for e in holds),'Unresolved base was published'
    for f in baseline['identities']:assert digest(OUT/'before'/f['url'])==f['sha256'],'Frozen baseline changed'
    assert digest(ROOT/'apps/golf/public/courses/v2-index.json')==next(f['sha256'] for f in baseline['identities'] if f['url']=='courses/v2-index.json')
    geometries={f['properties']['id']:shape(f['geometry']) for f in read(OUT/'pilot-footprints.geojson')['features'] if f['properties']['role']=='individual-crown'}
    after_footprints=[geometries.get(r['id'],Point(r['easting'],r['northing']).buffer(r['radiusMetres'])) for r in after]
    before_footprints=[Point(r['easting'],r['northing']).buffer(r['radiusMetres']) for r in before]
    clearings=[shape(f['geometry']) for f in read(DOC/'reference.geojson')['features'] if f['properties']['role']=='clearing']
    results={}
    for mode,footprints in [('before',before_footprints),('after',after_footprints)]:
      results[mode]={}
      for scenario in ['webgpu-high','webgl-high','webgl-low']:
        export,coords=drawn(mode,scenario);individuals=coords[coords[:,2]==5];stands=coords[coords[:,2]==6]
        duplicates=hits(stands,footprints);gaps=hits(coords,clearings)
        missing=[]
        if mode=='after':
            tree=cKDTree(individuals[:,:2])
            missing=[e['id'] for e in accepted if tree.query([e['after']['easting'],e['after']['northing']])[0]>.02]
            assert not missing,'Accepted crowns missing from rendered individuals'
            assert duplicates==0,'A stand base intersects an individual footprint'
            assert gaps==0,'A rendered base intrudes into a reviewed clearing'
        assert export['legacyInsideCoverage']==0
        results[mode][scenario]=dict(drawn=export['total'],individuals=len(individuals),standRepresentatives=len(stands),
            standBasesInsideIndividualFootprints=duplicates,basesInReviewedClearings=gaps,missingAccepted=missing)
    # Date-qualified local edge segments, independent of detector selection.
    edges=read(ROOT/'tools/visby-tree-pilot/edge-annotations.json');edge_features=[];edge_results=[]
    for scene,vertices in edges['lines'].items():
        meta=read(OUT/'review'/(scene+'.json'));w,s,e,n=meta['bounds'];line=LineString([(w+x/4,n-y/4) for x,y in vertices])
        edge_features.append(dict(type='Feature',geometry=mapping(line),properties=dict(scene=scene,role='interpreted-canopy-edge',uncertaintyMetres=edges['uncertaintyMetres'])))
        row=dict(scene=scene,lengthMetres=line.length)
        for mode,recs,fp in [('before',before,{}),('after',after,geometries)]:
            boundary=canopy_geometry(mode,scene,recs,fp).boundary
            distances=[line.interpolate(d).distance(boundary) for d in np.arange(0,line.length,1)]
            row[mode]=dict(meanMetres=float(np.mean(distances)),p95Metres=float(np.quantile(distances,.95)),samples=len(distances))
        edge_results.append(row)
    save(DOC/'edge-reference.geojson',dict(type='FeatureCollection',crs=dict(type='name',properties=dict(name='EPSG:3006')),method=edges['method'],features=edge_features))
    # Local first-return density, excluding the acquisition's large empty sea area.
    exclusions=read(OUT/'exclusions.json');surfaces=[Polygon(a['ring']).buffer(0) for a in exclusions['reviewedPlayingAreas']]
    surfaces += [Polygon(r).buffer(0) for f in exclusions['features'] if f['kind'] in ['green','tee','fairway','bunker','practice'] for r in f.get('rings',[])]
    region=unary_union(surfaces).buffer(30)
    with rasterio.open(OUT/'first-returns.tif') as src:
        window=from_bounds(*region.bounds,transform=src.transform).round_offsets().round_lengths();a=src.read(1,window=window);transform=src.window_transform(window)
        mask=geometry_mask([mapping(region)],out_shape=a.shape,transform=transform,invert=True)
        density=dict(region='Playing surfaces and 30 m surroundings',areaMetres2=int(mask.sum()),firstReturns=int(np.nansum(a[mask])),
            firstReturnsPerSquareMetre=float(np.nansum(a[mask])/mask.sum()),cellsWithFirstReturnFraction=float(np.mean(a[mask]>0)))
    b=read(OUT/'captures/before/report.json');a=read(OUT/'captures/after/report.json')
    assert len(b['runs'])==len(a['runs'])==3
    views=0
    for br,ar in zip(b['runs'],a['runs']):
        assert br['state']['stats']['backend']==ar['state']['stats']['backend']
        assert br['state']['catalogue']==ar['state']['catalogue'],'Tree assets changed'
        assert not ar['errors'] and ar['state']['audit']['ok']
        assert len(br['views'])==len(ar['views'])
        for bv,av in zip(br['views'],ar['views']):
            assert bv['hole']==av['hole'] and bv['cam']==av['cam'] and bv['camera']==av['camera'],'Unmatched cameras'
            assert digest(OUT/'captures/before'/bv['file'])==bv['sha256']
            assert digest(OUT/'captures/after'/av['file'])==av['sha256'];views+=1
    report=dict(status='passed-source-conformance-checks',productionRootUnchanged=True,baselineFilesVerified=len(baseline['identities']),
        baselineRecords=len(before),pilotRecords=len(after),retainedBaselineIds=len(old),unchangedBaselineRecords=len(old)-len(edited&old.keys()),
        acceptedEdits=len(accepted),heldBases=len(holds),unresolvedCases=len(cat['unresolved']),matchedScreenshotPairs=views,
        rendered=results,density=density,edgeDisagreement=edge_results,
        edgeMetric='One-way distance from 1 m samples along two manually interpreted canopy-edge segments to occupancy boundaries (stand eligibility plus individual footprints). This is local source conformance, not held-out forest-edge accuracy.',
        tests=dict(python=10,node=35),detectorTargetsMet=read(DOC/'benchmark.json')['passed'],default='baseline')
    save(DOC/'validation.json',report);print(json.dumps(report,indent=2))

if __name__=='__main__':main()
