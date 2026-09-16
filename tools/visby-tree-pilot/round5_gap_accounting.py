"""Account for every uncovered height pixel without certifying unreviewed gaps.

Only explicit source-reviewed non-tree segments can explain structure overlap.
All other editable gaps remain unresolved, grouped by stable owner cell. This
is deliberately separate from inspected-cell completion and detector accuracy.
"""
from round5 import *
from collections import Counter


def main():
    check_lock();reserve=protected();coverage=read(DOC/'coverage.geojson')['features']
    raw=read(DOC/'canopy-gaps.geojson')['features']
    # Pixel-centre selection can leave a fraction of an edge pixel outside the
    # exact polygon. Keep native pixel counts in the audit, clip GIS accounting.
    gaps=unary_union([shape(f['geometry']).buffer(0) for f in raw]).intersection(facility())
    structures=unary_union([shape(e['geometry']) for e in read(DOC/'corrections.json')['edits'] if e['action']=='reject-not-tree'])
    protected_gaps=gaps.intersection(reserve)
    structure_gaps=gaps.difference(reserve).intersection(structures)
    unresolved=gaps.difference(reserve).difference(structures)
    rows=[];cases=[]
    for f in coverage:
        p=f['properties'];owned=shape(f['geometry']);g=unresolved.intersection(owned)
        if g.area>.000001:
            c=dict(id='r5-canopy-'+p['id'],group='round5-unrepresented-height',status='unresolved',geometry=mapping(g),scene=p.get('scene'),hole=None,relatedRecordId=None,relatedIssueIds=[],
                reason='Height support outside individual crown footprints and eligible woodland cells. Cell sources were inspected, but these residual pixels are not certified as missing trees: they can include crown overhang, coarse-mask omissions, structures or uncertain vegetation. Needs targeted review before claiming complete representation.',
                areaMetres2=g.area,source='canopy-audit.json',sourceDates=dict(lidar=['2024-02-03','2024-04-28'],rgbi='2026-04-10'))
            cases.append(c)
        for status,geometry in [('protected-evaluation',protected_gaps),('reviewed-non-tree-overlap',structure_gaps),('unresolved-representation',unresolved)]:
            local=geometry.intersection(owned)
            if local.area>.000001:rows.append(dict(type='Feature',geometry=mapping(local),properties=dict(id=p['id']+'-'+status,cellId=p['id'],scene=p.get('scene'),status=status,areaMetres2=local.area)))
    accounted=sum(shape(f['geometry']).area for f in rows)
    assert abs(accounted-gaps.area)<.001,(accounted,gaps.area)
    summary=read(DOC/'canopy-audit.json')
    summary['gapAccounting']=dict(areaMetres2=gaps.area,protectedMetres2=protected_gaps.area,reviewedNonTreeOverlapMetres2=structure_gaps.area,unresolvedMetres2=unresolved.area,unresolvedCellCases=len(cases),allGapAreaAccountedFor=True,completeTreeRepresentation=False,
        meaning='Spatial accounting, not resolved coverage. Every remaining editable gap is an explicit unresolved case. Small gaps are retained, not silently filtered by a size threshold.')
    save(DOC/'canopy-audit.json',summary);save(DOC/'canopy-gap-accounting.geojson',collection(rows));save(DOC/'canopy-gap-issues.json',dict(cases=cases))
    print(json.dumps(summary['gapAccounting'],indent=2));check_lock()


if __name__=='__main__':main()
