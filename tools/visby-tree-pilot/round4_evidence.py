"""Coverage accounting, unresolved-case reconciliation and source/render overlays."""
from round4 import *
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
    assert all(f['properties'].get('inspected') or shape(f['geometry']).difference(reserve).area<.001 for f in features),'Editable review area left uninspected'
    summary=dict(groundId='visby',review='round4',scopeAreaMetres2=area.area,gridCells=len(features),inspectedCells=sum(bool(f['properties'].get('inspected')) for f in features),
        cellStatusCounts=dict(Counter(f['properties']['status'] for f in features)),inspectedAreaMetres2=inspected.area,inspectedFraction=inspected.area/area.area,
        areaByStatusMetres2=status_areas,rows=rows,sourceCoverageFraction=read(AUDIT/'coverage.json')['recordedValidImageCoverageFraction'],
        editableAreaMetres2=area.difference(reserve).area,editableInspectionFraction=inspected.area/area.difference(reserve).area,
        definition='Cumulative systematic source/candidate and rendered-base review, clipped to the frozen corridor and excluding six protected evaluation windows. Ambiguous cells were inspected but did not pass. Woodland interiors remain density-based, not a stem census.',
        limitations='Older sample-window coverage is a different measure and is not added to inspected area. Per-hole 90 m line buffers overlap and must not be summed. No independent new accuracy or boundary measurement.')
    save(DOC/'coverage.json',summary)
    return summary


def main():
    check_lock();features=read(DOC/'coverage.geojson')['features'];area=corridor();reserve=protected()
    lines={h['n']:LineString(h['line']) for h in read(OUT/'exclusions.json')['geometry']['holes']}
    cats=read(DOC/'corrections.json')['edits'];origin=read(OUT/'baseline.json')['ground']['frame']['origin']
    issues=read(PRIOR_DOC/'issue-index.json')['cases']
    for c in cats:
        if c['action'].startswith('hold'):
            issues.append(dict(id='r4-'+c['candidateId'],group='round4-'+c['action'],status='unresolved',geometry=c['geometry'],reason=c['reason'],relatedRecordId=c.get('id'),scene=c['scene'],hole=c['hole'],relatedIssueIds=[]))
    for c in read(ROOT/'tools/visby-tree-pilot/round4-decisions.json')['additionalObservations']:
        meta=read(WORK/'review'/(c['scene']+'.json'));w,s,e,n=meta['bounds'];px,py,r=c['pixels']
        owned=next(shape(f['geometry']) for f in features if f['properties'].get('scene')==c['scene']).difference(reserve)
        g=Point(w+px/650*(e-w),n-py/650*(n-s)).buffer(r/650*(e-w)).intersection(owned)
        assert not g.is_empty and g.area>0,c['id']
        issues.append(dict(id=c['id'],group='round4-low-vegetation',status='unresolved',geometry=mapping(g),reason=c['reason'],relatedRecordId=None,scene=c['scene'],hole=meta['hole'],relatedIssueIds=[]))
    assert len({c['id'] for c in issues})==len(issues)
    geometry=[shape(c['geometry']) for c in issues]
    for c in issues:c['relatedIssueIds']=[]
    for i,a in enumerate(issues):
        for j in range(i+1,len(issues)):
            if geometry[i].intersects(geometry[j]):a['relatedIssueIds'].append(issues[j]['id']);issues[j]['relatedIssueIds'].append(a['id'])
    save(DOC/'issue-index.json',dict(caseCount=len(issues),groupCounts=dict(Counter(c['group'] for c in issues)),cases=issues,
        definition='Unresolved review cases, not unique trees. Prior 96 cases retained; new source/base holds and low-vegetation observations added. Spatial overlap is a possible relationship, not proof of identical stems.',
        resolution='No prior unresolved case is silently resolved. Frozen evaluation ambiguity is retained separately in the round-two reference.'))
    save(DOC/'issue-index.geojson',collection([dict(type='Feature',geometry=c['geometry'],properties={k:v for k,v in c.items() if k!='geometry'}) for c in issues]))
    for f in features:
        p=f['properties'];owned=shape(f['geometry']).difference(reserve)
        related=[c['id'] for c,g in zip(issues,geometry) if owned.intersects(g)];p['crossPassIssueIds']=related
        if p.get('inspected'):p['status']='ambiguous' if related or p.get('issueIds') else 'reviewed'
    save(DOC/'coverage.geojson',collection(features));summary=summarize_coverage(features)
    shutil.copyfile(PRIOR_DOC/'suppression-review.json',DOC/'suppression-review.json')
    colours=dict(reviewed='#4baf84',ambiguous='#dba84b',unreviewed='#bfc8c2',**{'protected-evaluation':'#a999c7'})
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
    accepted=[c for c in cats if c['action']=='accept'];ax.scatter([c['easting'] for c in accepted],[c['northing'] for c in accepted],s=9,c='#123d2d',label=f'{len(accepted)} accepted individual crowns')
    ax.legend(handles=[Patch(color=v,label=k.capitalize()) for k,v in colours.items()]+[Patch(color='#a999c7',label='Protected evaluation')],loc='upper left',fontsize=8)
    ax.autoscale();ax.set_aspect('equal');ax.ticklabel_format(useOffset=False,style='plain');ax.set_xlabel('Easting · SWEREF 99 TM (m)');ax.set_ylabel('Northing (m)')
    ax.set_title(f"Visby · fourth local review\n{summary['inspectedCells']} cells inspected · {summary['inspectedFraction']:.1%} of corridor area\nAmber areas retain unresolved cases; this is not a tree census",fontsize=12)
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
        sid=scene['id'];w,s,e,n=read(WORK/'review'/(sid+'.json'))['layerBounds']['rgb'];canvas=Image.new('RGB',(1300,690),'#15201c');label=ImageDraw.Draw(canvas)
        for col,key in enumerate(['before','after']):
            im=Image.open(WORK/'review'/(sid+'-rgb.png')).resize((650,650));d=ImageDraw.Draw(im)
            def xy(x,y):return ((x-w)/(e-w)*650,(n-y)/(n-s)*650)
            for c in cats:
                if c['scene']!=sid:continue
                g=shape(c['geometry']);colour='#67ffd0' if c['action']=='accept' else '#ffa957' if c['action'].startswith('hold') else '#6aace0'
                for p in [g] if g.geom_type=='Polygon' else g.geoms:d.line([xy(x,y) for x,y in p.exterior.coords],fill=colour,width=1)
            for x,y,t in coords[key][(coords[key][:,0]>=w)&(coords[key][:,0]<=e)&(coords[key][:,1]>=s)&(coords[key][:,1]<=n)]:
                if owns([w,s,e,n],x,y):
                    px,py=xy(x,y);r=2 if t==5 else 1;d.ellipse((px-r,py-r,px+r,py+r),fill='#ffff66' if t==5 else '#76cd89')
            canvas.paste(im,(col*650,25));label.text((col*650+5,6),sid+' '+key+' · yellow individual / small green stand base',fill='white')
        canvas.save(WORK/'review'/(sid+'-bases.png'))
    check_lock();print(json.dumps({k:summary[k] for k in ['inspectedCells','inspectedFraction','cellStatusCounts','areaByStatusMetres2']},indent=2));print('Issue cases',len(issues),'new crowns with no prior stand base',sum(c['standBasesInCrownBefore']==0 for c in presence))

if __name__=='__main__':main()
