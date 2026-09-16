"""Read-only audit of recorded review extent and matched-subset detector metrics.

Writes new audit artifacts only. Never changes frozen references, decisions,
detector settings, image caches or runtime generations. Review-window presence
is an upper bound on detailed review opportunity, not proof of completeness.
"""
from round2 import *
from shapely.geometry import LineString
from scipy.spatial import cKDTree

AUDIT=DOC.parent/'coverage-audit'

def wilson(success,total,z=1.959963984540054):
    if not total:return None
    p=success/total;denominator=1+z*z/total
    centre=(p+z*z/(2*total))/denominator
    half=z*np.sqrt(p*(1-p)/total+z*z/(4*total*total))/denominator
    return [float(centre-half),float(centre+half)]

def main():
    lock=read(DOC/'detector-lock.json')
    assert digest(DOC/'reference.geojson')==lock['freshReferenceSha256']
    assert digest(ROOT/'tools/visby-tree-pilot/round2_benchmark.py')==lock['detectorCodeSha256']
    assert digest(ROOT/'tools/visby-tree-pilot/round2-detect.R')==lock['rCodeSha256']
    paths=[OUT/'scenes.json',WORK/'scenes.json',WORK/'review-scenes.json',OUT/'exclusions.json',
        DOC.parent/'reference.geojson',DOC/'reference.geojson',DOC.parent/'corrections.json',DOC/'corrections.json',
        WORK/'evaluation-details.json',DOC/'evaluation.json',WORK/'pilot-records.json',WORK/'captures/webgpu-high-instances.json',
        OUT/'first-returns.tif',OUT/'chm.tif',CACHE/'acquisition.json',OUT/'baseline.json',Path(__file__),
        ROOT/'apps/golf/public/courses/v2-index.json',OUT/'after/courses/v2-index.json',WORK/'after/courses/v2-index.json']
    for directory,file in [(OUT,'scenes.json'),(WORK,'scenes.json'),(WORK,'review-scenes.json')]:
        paths += [directory/'review'/(s['id']+'.json') for s in read(directory/file)]
    source_hashes={str(p.relative_to(ROOT)).replace('\\','/'):digest(p) for p in paths}
    scenes=[];features=[]
    for directory,file in [(OUT,'scenes.json'),(WORK,'scenes.json'),(WORK,'review-scenes.json')]:
        for s in read(directory/file):
            meta=read(directory/'review'/(s['id']+'.json'));s=dict(s,bounds=meta['bounds']);scenes.append(s)
            features.append(dict(type='Feature',geometry=mapping(box(*s['bounds'])),properties=dict(**s,role='review-window-not-completeness')))
    windows=unary_union([box(*s['bounds']) for s in scenes])
    placement=unary_union([box(*s['bounds']) for s in scenes if s['split']!='fresh-evaluation'])
    exclusion=read(OUT/'exclusions.json')
    surfaces=[Polygon(a['ring']).buffer(0) for a in exclusion['reviewedPlayingAreas']]
    surfaces += [Polygon(r).buffer(0) for f in exclusion['features'] if f['kind'] in ['green','tee','fairway','bunker','practice'] for r in f.get('rings',[])]
    corridor=unary_union(surfaces).buffer(30)
    features.append(dict(type='Feature',geometry=mapping(corridor),properties=dict(role='playing-and-practice-surfaces-plus-30m')))
    acquisition=read(CACHE/'acquisition.json')
    fully_valid=[w for w in acquisition['windows'] if w['validFraction']==1]
    image_coverage=unary_union([box(*w['boundsEpsg3006']) for w in fully_valid])
    references=read(DOC.parent/'reference.geojson')['features']+read(DOC/'reference.geojson')['features']
    crowns=[f for f in references if f['properties']['role']=='crown']
    oldcat=read(DOC.parent/'corrections.json');newcat=read(DOC/'corrections.json')
    lines={h['n']:LineString(h['line']) for h in exclusion['geometry']['holes']}
    scene_holes={s['id']:s['hole'] for s in scenes}
    edits=[dict(hole=scene_holes[e['scene']],round=1,action=e['action']) for e in oldcat['edits'] if e.get('decision')=='accepted-source-relative-preview']
    edits += [dict(hole=scene_holes[e['scene']],round=2,action=e['action']) for e in newcat['edits'] if e['action']=='accept']
    holds=[dict(hole=p['hole'],id=p['id'],reason=p.get('reason',p['status']),round=1) for p in oldcat['unresolved']]
    holds += [dict(hole=scene_holes[e['scene']],id=e['candidateId'],reason=e['reason'],round=2) for e in newcat['edits'] if e['action'].startswith('hold')]
    origin=read(OUT/'baseline.json')['ground']['frame']['origin']
    actual=read(WORK/'captures/webgpu-high-instances.json')
    individual=cKDTree([[origin['easting']+a[0],origin['northing']-a[2]] for a in actual['instances'] if a[6]==5])
    suppressed=[]
    for r in read(WORK/'pilot-records.json'):
        if individual.query([r['easting'],r['northing']])[0]>.02:
            p=Point(r['easting'],r['northing']);hole=min(lines,key=lambda h:lines[h].distance(p))
            suppressed.append(dict(id=r['id'],easting=r['easting'],northing=r['northing'],nearestHole=hole,
                distanceToHoleLineMetres=lines[hole].distance(p),reason='Retained registry record absent from exported individual instances; inspect runtime exclusion before inferring missing real tree.'))
    rows=[]
    with rasterio.open(OUT/'first-returns.tif') as returns,rasterio.open(OUT/'chm.tif') as heights:
      for hole,line in sorted(lines.items()):
        region=line.buffer(90).intersection(corridor)
        if region.is_empty:continue
        win=from_bounds(*region.bounds,transform=returns.transform).round_offsets().round_lengths()
        a=returns.read(1,window=win);chm=heights.read(1,window=win)
        mask=geometry_mask([mapping(region)],out_shape=a.shape,transform=returns.window_transform(win),invert=True)
        n=int(mask.sum());assert n>0
        row=dict(hole=hole,diagnosticAreaMetres2=region.area,reviewWindowIntersectionMetres2=windows.intersection(region).area,
            reviewWindowIntersectionFraction=windows.intersection(region).area/region.area,
            placementReviewWindowIntersectionFraction=placement.intersection(region).area/region.area,
            recordedValidImageCoverageFraction=min(1.0,image_coverage.intersection(region).area/region.area),
            firstReturnsPerSquareMetre=float(np.nansum(a[mask])/n),cellsWithFirstReturnFraction=float(np.mean(a[mask]>0)),
            finiteCanopyHeightCellsFraction=float(np.mean(np.isfinite(chm[mask]))),
            dedicatedScenes=[s['id'] for s in scenes if s['hole']==hole],
            annotatedCrowns=sum(f['properties']['hole']==hole for f in crowns),
            scorableCrowns=sum(f['properties']['hole']==hole and f['properties'].get('scorable',False) for f in crowns),
            acceptedEditsByRound={str(k):sum(e['hole']==hole and e['round']==k for e in edits) for k in [1,2]},
            unresolvedCatalogueCases=sum(p['hole']==hole for p in holds),suppressedRegistryRecordsNearestHole=sum(r['nearestHole']==hole for r in suppressed),
            comprehensiveReviewStatus='not-established')
        rows.append(row)
    summary=dict(groundId='visby',scope='Existing two local pilots; no new placement decisions',
        metricsDefinition='Review-window area is an upper bound on potential detailed review, not a reviewed percentage. Source annotation covers selected crowns. Acquisition, sampling, visual screenshots and comprehensive audit are different kinds of coverage.',
        perHoleAreaDefinition='Each hole line buffered 90 m, intersected with the union of playing/practice surfaces plus 30 m. Rows can overlap; do not sum them. This is a reproducible diagnostic scope, not approved hole ownership or a survey boundary.',
        corridorAreaMetres2=corridor.area,allReviewWindowIntersectionFraction=windows.intersection(corridor).area/corridor.area,
        placementWindowIntersectionFraction=placement.intersection(corridor).area/corridor.area,
        recordedValidImageCoverageFraction=min(1.0,image_coverage.intersection(corridor).area/corridor.area),
        acquisitionWindows=len(acquisition['windows']),fullyValidAcquisitionWindows=len(fully_valid),
        imageCoverageMethod='Union of acquisition footprints recorded as 100% valid; source hashes are retained in the acquisition report. This audit hashes the report and does not redownload or reverify every image byte.',
        dedicatedSampleHoles=sorted(set(s['hole'] for s in scenes)),holesWithoutDedicatedSample=[h for h in lines if not any(s['hole']==h for s in scenes)],
        referenceCrowns=len(crowns),scorableReferenceCrowns=sum(f['properties'].get('scorable',False) for f in crowns),
        unresolvedCatalogueCases=len(holds),unresolvedFreshReferenceCrowns=sum(f['properties']['split']=='fresh-evaluation' and not f['properties'].get('scorable',False) for f in crowns),
        unresolvedCases=holds,suppressedRegistryRecords=suppressed,rows=rows,sourceHashes=source_hashes,
        frozenFreshEvaluationRemainsUntouched=True,productionAndPilotGraphsChanged=False)
    save(AUDIT/'coverage.json',summary)
    save(AUDIT/'coverage.geojson',dict(type='FeatureCollection',crs=dict(type='name',properties=dict(name='EPSG:3006')),features=features))
    # The prior headline compared different sets of successfully matched trees.
    # Describe both detectors on the same reference IDs without selecting settings.
    details=read(WORK/'evaluation-details.json');evaluation=read(DOC/'evaluation.json')
    methods=['node-current+islands0',evaluation['selected']];paired={m:[] for m in methods};matched=[];counts=[]
    for s in read(WORK/'scenes.json'):
        scene_refs=[f for f in references if f['properties']['scene']==s['id'] and f['properties'].get('scorable')]
        lookup={}
        for m in methods:
            row=next(r for r in details[m] if r['scene']==s['id'])
            assert len(row['pairs'])==len(row['ious'])==len(row['distances'])==row['tp']
            assert row['tp']+row['fn']==len(scene_refs)
            lookup[m]={pair[0]:dict(centreMetres=distance,crownIoU=iou) for pair,distance,iou in zip(row['pairs'],row['distances'],row['ious'])}
        common=lookup[methods[0]].keys()&lookup[methods[1]].keys()
        for index in sorted(common):
            matched.append(scene_refs[index]['properties']['id'])
            for m in methods:paired[m].append(lookup[m][index])
        counts.append(dict(scene=s['id'],common=len(common),nodeOnly=len(lookup[methods[0]].keys()-common),candidateOnly=len(lookup[methods[1]].keys()-common)))
    stats={m:dict(n=len(v),crownIoU=float(np.mean([x['crownIoU'] for x in v])),centreMedianMetres=float(np.median([x['centreMetres'] for x in v])),
        centreP95Metres=float(np.quantile([x['centreMetres'] for x in v],.95))) for m,v in paired.items()}
    paired_rows=[dict(referenceId=rid,node=paired[methods[0]][i],candidate=paired[methods[1]][i]) for i,rid in enumerate(matched)]
    intervals={m:dict(precision95=wilson(v['tp'],v['tp']+v['fp']),recall95=wilson(v['tp'],v['tp']+v['fn'])) for m,v in evaluation['metrics'].items()}
    save(AUDIT/'paired-evaluation.json',dict(methods=methods,commonMatchedReferences=matched,counts=counts,pairedMetrics=stats,pairedRows=paired_rows,wilsonIntervals=intervals,
        limits=['Post-evaluation diagnostic only; no detector selection, retuning or reference edits.',
        'Paired geometry metrics omit misses; read together with full precision/recall and method-specific misses.',
        'Wilson intervals assume independent binomial observations. Crowns are spatially clustered and purposively sampled, so these are descriptive and not course-wide confidence bounds.'],
        referenceSha256=lock['freshReferenceSha256'],evaluationSha256=digest(DOC/'evaluation.json'),detailsSha256=digest(WORK/'evaluation-details.json')))
    assert len(rows)==len(lines) and len(matched)==len(set(matched))
    assert all(0<=r[k]<=1 for r in rows for k in ['reviewWindowIntersectionFraction','placementReviewWindowIntersectionFraction','recordedValidImageCoverageFraction','cellsWithFirstReturnFraction','finiteCanopyHeightCellsFraction'])
    assert sum(c['common']+c['nodeOnly'] for c in counts)==evaluation['metrics'][methods[0]]['tp']
    assert sum(c['common']+c['candidateOnly'] for c in counts)==evaluation['metrics'][methods[1]]['tp']
    assert all(digest(ROOT/p)==value for p,value in source_hashes.items()),'Audit altered its input evidence'
    draw_map(corridor,lines,scenes,summary)
    print(json.dumps(dict(corridorWindowFraction=summary['allReviewWindowIntersectionFraction'],placementWindowFraction=summary['placementWindowIntersectionFraction'],
        sourceImageCoverage=summary['recordedValidImageCoverageFraction'],withoutSample=summary['holesWithoutDedicatedSample'],unresolved=len(holds),
        suppressed=suppressed,paired=stats,lowestWindowCoverage=[(r['hole'],round(r['reviewWindowIntersectionFraction'],3)) for r in sorted(rows,key=lambda r:r['reviewWindowIntersectionFraction'])[:8]]),indent=2))

def draw_map(corridor,lines,scenes,summary):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.patches import Polygon as Patch,Patch as Legend
    fig,ax=plt.subplots(figsize=(8,9))
    parts=list(corridor.geoms) if corridor.geom_type=='MultiPolygon' else [corridor]
    for polygon in parts:
        ax.add_patch(Patch(np.asarray(polygon.exterior.coords)/1000,facecolor='#e5e9e5',edgecolor='#83938a',linewidth=.5))
        for ring in polygon.interiors:ax.add_patch(Patch(np.asarray(ring.coords)/1000,facecolor='white',edgecolor='#83938a',linewidth=.5))
    colours={'calibration':'#2566a7','evaluation':'#2566a7','fresh-evaluation':'#9b59b6','placement-review':'#d7831d'}
    for s in scenes:
        b=box(*s['bounds']);ax.add_patch(Patch(np.asarray(b.exterior.coords)/1000,facecolor=colours[s['split']],edgecolor=colours[s['split']],alpha=.25,linewidth=1))
    for hole,line in lines.items():
        a=np.asarray(line.coords)/1000;ax.plot(a[:,0],a[:,1],color='#53685d',linewidth=.7)
        p=line.interpolate(.5,normalized=True);ax.text(p.x/1000,p.y/1000,str(hole),ha='center',va='center',fontsize=9,weight='bold',bbox=dict(facecolor='white',edgecolor='none',alpha=.85,pad=1.5))
    ax.autoscale();ax.set_aspect('equal');ax.set_xlabel('Easting (km, SWEREF 99 TM)');ax.set_ylabel('Northing (km, SWEREF 99 TM)');ax.ticklabel_format(useOffset=False,style='plain')
    ax.set_title('Visby: where detailed tree-review windows exist\nWindow overlap is not a completeness audit',fontsize=13)
    ax.legend(handles=[Legend(facecolor='#e5e9e5',edgecolor='#83938a',label='Playing / practice surfaces + 30 m'),
        Legend(facecolor='#2566a7',alpha=.4,label='First-pilot reference windows'),Legend(facecolor='#9b59b6',alpha=.4,label='Fresh evaluation (no placement edits)'),Legend(facecolor='#d7831d',alpha=.4,label='Second-pass placement windows')],loc='upper right',fontsize=8)
    fig.text(.5,.018,f"Recorded RGBI coverage: {summary['recordedValidImageCoverageFraction']:.0%} of corridor. Review-window overlap: {summary['allReviewWindowIntersectionFraction']:.1%}.\nSelected crowns were annotated; these two pilots do not establish a complete tree inventory.",ha='center',fontsize=9)
    fig.tight_layout(rect=[0,.055,1,1]);fig.savefig(AUDIT/'coverage.svg');plt.close(fig)

if __name__=='__main__':main()
