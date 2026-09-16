"""Coverage accounting, unresolved-case reconciliation and source/render overlays."""
from round3 import *
from collections import Counter
from scipy.spatial import cKDTree
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as PlotPolygon, Patch


def summarize_coverage(features):
    area=corridor();reserve=protected()
    inspected=unary_union([shape(f['geometry']).difference(reserve) for f in features if f['properties'].get('inspected')])
    status_areas={status:unary_union([shape(f['geometry']).difference(reserve) for f in features if f['properties']['status']==status]).area
        for status in ['reviewed','ambiguous','unreviewed']}
    status_areas['protected-evaluation']=area.intersection(reserve).area
    assert abs(sum(status_areas.values())-area.area)<.001
    lines={h['n']:LineString(h['line']) for h in read(OUT/'exclusions.json')['geometry']['holes']}
    rows=[]
    for hole,line in lines.items():
        scope=line.buffer(90).intersection(area)
        rows.append(dict(hole=hole,diagnosticAreaMetres2=scope.area,inspectedAreaMetres2=scope.intersection(inspected).area,
            inspectedFraction=scope.intersection(inspected).area/scope.area,
            cellIds=[f['properties']['id'] for f in features if shape(f['geometry']).intersection(scope).area>0],
            statusAreasMetres2={s:unary_union([shape(f['geometry']).difference(reserve).intersection(scope) for f in features if f['properties']['status']==s]).area for s in ['reviewed','ambiguous','unreviewed']}))
        rows[-1]['statusAreasMetres2']['protected-evaluation']=scope.intersection(reserve).area
        assert abs(sum(rows[-1]['statusAreasMetres2'].values())-scope.area)<.001
        rows[-1].update(sourceDates=dict(lidar=['2024-02-03','2024-04-28'],rgbi='2026-04-10',seasonal='2022; exact date unknown'),
            renderedViews='Matched WebGPU tee and overhead captured; WebGL/high and low tee also captured for holes 9 and 16.',
            treatment='Retain measured woodland; accepted individuals only in linked inspected cells. No whole-hole stem census.',
            unresolvedIssueIds=sorted({i for f in features if shape(f['geometry']).intersects(scope) for i in f['properties'].get('crossPassIssueIds',[])}))
    summary=dict(groundId='visby',review='round3',scopeAreaMetres2=area.area,gridCells=len(features),inspectedCells=sum(bool(f['properties'].get('inspected')) for f in features),
        cellStatusCounts=dict(Counter(f['properties']['status'] for f in features)),inspectedAreaMetres2=inspected.area,inspectedFraction=inspected.area/area.area,
        areaByStatusMetres2=status_areas,rows=rows,sourceCoverageFraction=read(AUDIT/'coverage.json')['recordedValidImageCoverageFraction'],
        definition='New systematic source/candidate and rendered-base review, clipped to the frozen corridor and excluding six protected evaluation windows. Ambiguous cells were inspected but did not pass. Woodland interiors remain density-based, not a stem census.',
        limitations='Older sample-window coverage is a different measure and is not added to inspected area. Per-hole 90 m line buffers overlap and must not be summed. No independent new accuracy or boundary measurement.')
    save(DOC/'coverage.json',summary)
    return summary


def main():
    check_lock();features=read(DOC/'coverage.geojson')['features'];area=corridor();reserve=protected()
    lines={h['n']:LineString(h['line']) for h in read(OUT/'exclusions.json')['geometry']['holes']}
    cats=read(DOC/'corrections.json')['edits'];records={r['id']:r for r in read(PREVIOUS/'pilot-records.json')}
    probes={p['id']:p for p in read(WORK/'runtime-probes.json')['probes']}
    source_facility=ROOT/'apps/golf/public/models/visby/facilities-v1.json'
    frozen_facility=WORK/'facility-evidence.json'
    if not frozen_facility.exists():shutil.copyfile(source_facility,frozen_facility)
    assert digest(source_facility)==digest(frozen_facility),'Facility evidence changed during review'
    notes={
        '000067':'Connected crown evidence. Analytic fairway value is below the exclusion cutoff, but the sampled SEMI atlas cell makes the runtime playing exclusion apply.',
        '000038':'Woodland-edge crown. Analytic fairway value is below the cutoff; the sampled SEMI atlas cell explains exclusion.',
        '000042':'Crown beside water and woodland. Both analytic fairway and SEMI atlas conflict with the inferred base.',
        '000051':'Woodland-edge crown. Both analytic fairway and SEMI atlas conflict with the inferred base.',
        '000296':'Joined woodland crown. Fairway evidence and SEMI atlas explain the ground exclusion; individual stem identity is uncertain.',
        '000009':'Distinct isolated crown near green/bunkers. Runtime green/tee apron treatment can restore the playing exclusion after the ROUGH atlas sample.',
        '000258':'Visible crown over a bunker. Analytic playing/apron evidence conflicts with the inferred crown-centre base despite a ROUGH atlas sample.',
        '000284':'Crown overlaps the service-building roof. Inferred centre lies inside service-west-south-2026; the post-planning facility filter explains the remaining missing instance.'}
    suppression=[]
    for r in read(AUDIT/'coverage.json')['suppressedRegistryRecords']:
        suffix=r['id'].split('-')[-1];record=records[r['id']];scene='suppressed-'+suffix
        suppression.append(dict(id='runtime-'+r['id'],recordId=r['id'],scene=scene,hole=r['nearestHole'],geometry=mapping(Point(r['easting'],r['northing']).buffer(record['radiusMetres'])),
            status='unresolved',stage='post-plan-facility' if suffix=='000284' else 'ground-exclusion',reason=notes[suffix],probe=probes[r['id']],
            sourceMetadata=read(WORK/'review'/(scene+'.json')),decision='Keep the existing record unchanged; no inferred stem relocation or global exclusion override.',
            evidenceKind='Agent visual crown review; filter attribution inferred from runtime probes, population counts and filter geometry. No instrumented per-instance rejection trace.'))
    assert len(suppression)==8
    facility=read(frozen_facility);origin=read(OUT/'baseline.json')['ground']['frame']['origin']
    assert facility['coordinateFrame']['originEpsg3006']=={k:origin[k] for k in ['easting','northing']}
    polygon=next(f['footprintLocal'] for f in facility['facilities'] if f['id']=='service-west-south-2026')
    r=records['tree-visby-000284'];assert Polygon(polygon).covers(Point(r['easting']-origin['easting'],origin['northing']-r['northing']))
    save(DOC/'suppression-review.json',dict(cases=suppression,runtimeProbesSha256=digest(WORK/'runtime-probes.json'),facilityEvidenceSha256=digest(frozen_facility),
        explanation='3169 records -> 3162 planned individuals -> 3161 drawn in round two. Seven inferred ground exclusions and one facility conflict remain held; all eight retain visible crown evidence.'))
    save(DOC/'suppression-review.geojson',collection([dict(type='Feature',geometry=c['geometry'],properties={k:v for k,v in c.items() if k!='geometry'}) for c in suppression]))
    refs={f['properties']['id']:f for f in read(PRIOR_DOC.parent/'reference.geojson')['features'] if 'id' in f['properties']}
    issues=[]
    def add(id,group,geometry,reason,related=None,scene=None,hole=None):
        issues.append(dict(id=id,group=group,status='unresolved',geometry=geometry,reason=reason,relatedRecordId=related,scene=scene,hole=hole,
            playImpact='Ground/base exclusion or uncertain crown identity near reviewed playing areas; inspect the linked geometry before prioritizing.',
            requiredEvidence='Resolve crown identity and height, or ground/base versus canopy overhang, with defensible source evidence; preserve the current generation until then.',
            relatedIssueIds=[]))
    for c in read(PRIOR_DOC.parent/'corrections.json')['unresolved']:
        reason=c.get('reason') or ('Insufficient height support; retained as an unresolved source observation.' if c['status']=='unresolved-low-height' else 'Ambiguous crown identity in the original reference; not scorable and no individual correction accepted.')
        add('r1-'+c['id'],'round1-catalogue',refs[c['id']]['geometry'],reason,c.get('reservedId'),c['scene'],c.get('hole'))
    for c in read(PRIOR_DOC/'corrections.json')['edits']:
        if c['action'].startswith('hold'):add('r2-'+c['candidateId'],'round2-catalogue',c['geometry'],c['reason'],c.get('id'),c['scene'])
    for c in cats:
        if c['action'].startswith('hold'):add('r3-'+c['candidateId'],'round3-'+c['action'],c['geometry'],c['reason'],c.get('id'),c['scene'],c['hole'])
    for c in read(ROOT/'tools/visby-tree-pilot/round3-decisions.json')['additionalObservations']:
        meta=read(WORK/'review'/(c['scene']+'.json'));w,s,e,n=meta['bounds'];px,py,r=c['pixels'];g=Point(w+px/650*(e-w),n-py/650*(n-s)).buffer(r/650*(e-w))
        add(c['id'],'round3-low-vegetation',mapping(g),c['reason'],scene=c['scene'],hole=meta['hole'])
    for c in suppression:add(c['id'],'retained-runtime-suppression',c['geometry'],c['reason'],c['recordId'],c['scene'],c['hole'])
    # Spatial relationships are possible shared cases, not proof of the same stem.
    for i,a in enumerate(issues):
        for b in issues[i+1:]:
            if shape(a['geometry']).intersects(shape(b['geometry'])):
                a['relatedIssueIds'].append(b['id']);b['relatedIssueIds'].append(a['id'])
    assert len(issues)==96 and len({c['id'] for c in issues})==96
    save(DOC/'issue-index.json',dict(caseCount=len(issues),groupCounts=dict(Counter(c['group'] for c in issues)),cases=issues,
        definition='Unresolved review cases, not unique trees. Original 34 catalogue cases, 51 new candidate holds, three low-vegetation observations and eight retained runtime cases. Spatial overlaps are linked, not silently merged. The frozen fresh-reference ambiguity is retained separately in the round-two reference.',
        resolution='No prior catalogue case is claimed resolved by this pass. See the related geometries before treating observations from different windows as different plants.'))
    save(DOC/'issue-index.geojson',collection([dict(type='Feature',geometry=c['geometry'],properties={k:v for k,v in c.items() if k!='geometry'}) for c in issues]))
    # An unresolved crown can extend into a neighbouring owned cell, or come
    # from an older pass. Resolve area status against the complete issue index.
    for f in features:
        p=f['properties'];owned=shape(f['geometry']).difference(reserve)
        related=[c['id'] for c in issues if owned.intersects(shape(c['geometry']))]
        p['crossPassIssueIds']=related
        if p.get('inspected'):p['status']='ambiguous' if related or p['issueIds'] else 'reviewed'
    save(DOC/'coverage.geojson',collection(features));summary=summarize_coverage(features)
    colours=dict(reviewed='#4baf84',ambiguous='#dba84b',unreviewed='#bfc8c2')
    fig,ax=plt.subplots(figsize=(9,12))
    def draw(g,colour,alpha=1):
        if g.is_empty:return
        if g.geom_type=='Polygon':ax.add_patch(PlotPolygon(np.asarray(g.exterior.coords),facecolor=colour,edgecolor='white',linewidth=.4,alpha=alpha))
        else:
            for p in g.geoms:draw(p,colour,alpha)
    for f in features:draw(shape(f['geometry']).difference(reserve),colours[f['properties']['status']])
    draw(area.intersection(reserve),'#a999c7')
    for h,line in lines.items():
        xx,yy=line.xy;ax.plot(xx,yy,color='#526457',linewidth=.5);p=line.interpolate(.45,normalized=True);ax.text(p.x,p.y,str(h),fontsize=8)
    accepted=[c for c in cats if c['action']=='accept'];ax.scatter([c['easting'] for c in accepted],[c['northing'] for c in accepted],s=9,c='#123d2d',label='61 accepted individual crowns')
    ax.legend(handles=[Patch(color=v,label=k.capitalize()) for k,v in colours.items()]+[Patch(color='#a999c7',label='Protected evaluation')],loc='upper left',fontsize=8)
    ax.autoscale();ax.set_aspect('equal');ax.ticklabel_format(useOffset=False,style='plain');ax.set_xlabel('Easting · SWEREF 99 TM (m)');ax.set_ylabel('Northing (m)')
    ax.set_title(f"Visby · third local review\n{summary['inspectedCells']} cells inspected · {summary['inspectedFraction']:.1%} of corridor area\nAmber areas retain unresolved cases; this is not a tree census",fontsize=12)
    fig.tight_layout();fig.savefig(DOC/'coverage.svg');plt.close(fig)
    before=read(PREVIOUS/'captures/webgpu-high-instances.json')['instances'];after=read(WORK/'captures/webgpu-high-instances.json')['instances']
    coords={k:np.array([[origin['easting']+r[0],origin['northing']-r[2],r[6]] for r in rows]) for k,rows in [('before',before),('after',after)]}
    presence=[]
    for c in accepted:
        g=shape(c['geometry']);w,s,e,n=g.bounds
        counts={k:sum(g.covers(Point(x,y)) for x,y,t in a[(a[:,2]==6)&(a[:,0]>=w)&(a[:,0]<=e)&(a[:,1]>=s)&(a[:,1]<=n)]) for k,a in coords.items()}
        presence.append(dict(id=c['id'],scene=c['scene'],standBasesInCrownBefore=counts['before'],standBasesInCrownAfter=counts['after']))
    save(DOC/'representation.json',dict(crowns=presence,previouslyWithoutStandBase=sum(c['standBasesInCrownBefore']==0 for c in presence),
        definition='Actual exported stand-base centres inside accepted crown geometry, not proof of complete absence of visual canopy or true stems. New individual centres were more than 6 m from prior records.'))
    # Local source overlays make individual and procedural placement differences inspectable.
    for scene in read(WORK/'review-scenes.json'):
        sid=scene['id'];w,s,e,n=read(WORK/'review'/(sid+'.json'))['bounds'];canvas=Image.new('RGB',(1300,690),'#15201c');label=ImageDraw.Draw(canvas)
        for col,key in enumerate(['before','after']):
            im=Image.open(WORK/'review'/(sid+'-rgb.png')).resize((650,650));d=ImageDraw.Draw(im)
            def xy(x,y):return ((x-w)/(e-w)*650,(n-y)/(n-s)*650)
            for c in cats:
                if c['scene']!=sid:continue
                g=shape(c['geometry']);colour='#67ffd0' if c['action']=='accept' else '#ffa957' if c['action'].startswith('hold') else '#6aace0'
                for p in [g] if g.geom_type=='Polygon' else g.geoms:d.line([xy(x,y) for x,y in p.exterior.coords],fill=colour,width=1)
            for x,y,t in coords[key]:
                if owns([w,s,e,n],x,y):
                    px,py=xy(x,y);r=2 if t==5 else 1;d.ellipse((px-r,py-r,px+r,py+r),fill='#ffff66' if t==5 else '#76cd89')
            canvas.paste(im,(col*650,25));label.text((col*650+5,6),sid+' '+key+' · yellow individual / small green stand base',fill='white')
        canvas.save(WORK/'review'/(sid+'-bases.png'))
    check_lock();print(json.dumps({k:summary[k] for k in ['inspectedCells','inspectedFraction','cellStatusCounts','areaByStatusMetres2']},indent=2));print('Issue cases',len(issues),'new crowns with no prior stand base',sum(c['standBasesInCrownBefore']==0 for c in presence))

if __name__=='__main__':main()
