"""Separate added representation, non-tree explanations and unresolved canopy."""
from round6 import *
from collections import Counter


def main():
    check_lock();journal=read(DOC/'review-journal.json')['cases'];reserve=protected()
    old_accounting=read(PRIOR_DOC/'canopy-gap-accounting.geojson')['features']
    old_unresolved=unary_union([shape(f['geometry']) for f in old_accounting if f['properties']['status']=='unresolved-representation'])
    prior_structures=unary_union([shape(f['geometry']) for f in old_accounting if f['properties']['status']=='reviewed-non-tree-overlap'])
    new_structures=unary_union([shape(j['geometry']) for j in journal if j['classification']=='structure'])
    gaps=unary_union([shape(f['geometry']) for f in read(DOC/'canopy-gaps.geojson')['features']]).intersection(facility())
    protected_gaps=gaps.intersection(reserve);non_tree=gaps.difference(reserve).intersection(prior_structures.union(new_structures))
    unresolved=gaps.difference(reserve).difference(non_tree);features=[];gap_cases=[]
    coverage=read(PRIOR_DOC/'coverage.geojson')
    for f in coverage['features']:
        p=f['properties'];owned=shape(f['geometry']);local=unresolved.intersection(owned)
        for status,geometry in [('protected-evaluation',protected_gaps),('reviewed-non-tree-overlap',non_tree),('unresolved-representation',unresolved)]:
            geo=geometry.intersection(owned)
            if geo.area>1e-6:features.append(dict(type='Feature',geometry=mapping(geo),properties=dict(id=p['id']+'-'+status,cellId=p['id'],status=status,areaMetres2=geo.area)))
        if local.area>1e-6:gap_cases.append(dict(id='r5-canopy-'+p['id'],geometry=mapping(local),areaMetres2=local.area))
    assert abs(sum(shape(f['geometry']).area for f in features)-gaps.area)<.001
    before=read(PRIOR_DOC/'canopy-audit.json');after=read(DOC/'canopy-audit.json')
    gains=old_unresolved.difference(gaps);explained=old_unresolved.intersection(new_structures)
    assert gains.intersection(explained).area<1e-6
    assert abs(old_unresolved.area-gains.area-explained.area-unresolved.area)<.001
    after['gapAccounting']=dict(areaMetres2=gaps.area,protectedMetres2=protected_gaps.area,reviewedNonTreeOverlapMetres2=non_tree.area,unresolvedMetres2=unresolved.area,
        allGapAreaAccountedFor=True,completeTreeRepresentation=False,unresolvedCellCases=len(gap_cases))
    after['comparison']=dict(previous='round5',previousUnresolvedMetres2=old_unresolved.area,newlyRepresentedHeightPixels=after['representedHeightPixels']-before['representedHeightPixels'],
        newlyRepresentedGapMetres2=gains.area,newlyExplainedStructureMetres2=explained.area,
        meaning='Geometric crown representation increased; roof classification is an accounting correction. Neither is a new tree count or independent accuracy score.')
    save(DOC/'canopy-audit.json',after);save(DOC/'baseline-canopy-audit.json',before);save(DOC/'canopy-gap-accounting.geojson',collection(features))
    # Preserve original issue identities and evidence; resolve only the exact
    # gap subgeometry that this pass accounted for. Other issue types stay open.
    prior_index=read(PRIOR_DOC/'issue-index.json');current={c['id']:c for c in gap_cases};cases=[];history=[]
    for original in prior_index['cases']:
        c=dict(original);old_geo=shape(c['geometry']);reviews=[j['id'] for j in journal if j['id'] and old_geo.intersection(shape(j['geometry'])).area>0]
        if reviews:c['round6ReviewIds']=reviews
        if c['group']=='round5-unrepresented-height':
            new_geo=shape(current[c['id']]['geometry']) if c['id'] in current else Polygon()
            if old_geo.difference(new_geo).area>1e-6:
                history.append(dict(id=c['id'],previousGeometry=c['geometry'],remainingGeometry=mapping(new_geo),accountedSubgeometry=mapping(old_geo.difference(new_geo)),
                    newlyRepresentedMetres2=old_geo.intersection(gains).area,newlyExplainedStructureMetres2=old_geo.intersection(explained).area,reviewIds=reviews))
            c.update(geometry=mapping(new_geo),areaMetres2=new_geo.area,status='unresolved' if new_geo.area>1e-6 else 'accounted')
        cases.append(c)
    assert set(current)<=set(c['id'] for c in cases),'New owner gap requires a new explicit case'
    save(DOC/'issue-index.json',dict(cases=cases,previous='round5/issue-index.json',previousSha256=digest(PRIOR_DOC/'issue-index.json'),
        counts=dict(totalCases=len(cases),unresolvedCases=sum(c['status']=='unresolved' for c in cases)),
        meaning='Cases, not unique trees. Prior source/base cases retain their status; only explicitly accounted gap subgeometry changes.'))
    save(DOC/'issue-index.geojson',collection([dict(type='Feature',geometry=c['geometry'],properties={k:v for k,v in c.items() if k!='geometry'}) for c in cases if not shape(c['geometry']).is_empty]))
    save(DOC/'resolution-history.json',dict(cases=history));save(DOC/'coverage.geojson',coverage)
    counts=Counter(j['classification'] for j in journal)
    summary=dict(selectedComponents=len(journal),inspectedComponents=len(journal),selectedAreaMetres2=sum(j['areaMetres2'] for j in journal),classificationCounts=dict(counts),
        resizedTrees=6,addedTrees=0,removedTrees=0,treeBasePositionsChanged=0,structureComponents=counts['structure'],
        smallerUnreviewedComponents=sum(not f['properties']['selected'] for f in read(DOC/'gap-plan.geojson')['features']),
        smallerComponentAreaMetres2=sum(f['properties']['unresolvedAreaMetres2'] for f in read(DOC/'gap-plan.geojson')['features'] if not f['properties']['selected']),
        accounting=after['gapAccounting'],comparison=after['comparison'],
        recommendation='Review exact fairway/practice boundaries at distinct-base-conflict cases against source evidence before any further planting; preserve hard surfaces, frozen evaluation and uncertainty.')
    save(DOC/'findings.json',summary);check_lock();print(json.dumps(summary,indent=2))


if __name__=='__main__':main()
