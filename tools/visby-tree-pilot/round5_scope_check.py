"""Validate facility coverage, ownership and honest gap accounting."""
from round5 import *


def main():
    check_lock();scope=facility();reserve=protected();extra=extension();features=read(DOC/'coverage.geojson')['features']
    owned=[shape(f['geometry']) for f in features];union=unary_union(owned)
    assert union.symmetric_difference(scope).area<.001,'Facility area missing from ledger'
    assert abs(sum(g.area for g in owned)-union.area)<.001,'Overlapping owner cells'
    assert all(g.is_valid for g in owned)
    for f,g in zip(features,owned):
        p=f['properties'];assert box(*p['bounds']).covers(g)
        assert g.difference(reserve).area<.001 or p['inspected'] is True
    scenes={s['id']:s for s in read(WORK/'review-scenes.json')}
    for f in read(WORK/'placement-candidates.geojson')['features']:
        p=f['properties'];s=scenes[p['scene']];assert owns(s['ownedBounds'],p['easting'],p['northing'])
        assert extra.covers(Point(p['easting'],p['northing']))
    facilities=[f for f in read(ROOT/'visbybuild/facilities/facility-inventory.json')['facilities'] if f.get('scope')=='club-facilities']
    buildings=[f for f in facilities if f.get('footprintEpsg3006')]
    centres=[f for f in facilities if not f.get('footprintEpsg3006')]
    assert len(facilities)==13 and len(buildings)==12
    assert all(scope.covers(Polygon(b['footprintEpsg3006'])) for b in buildings)
    assert all(scope.covers(Point(f['centerEpsg3006'])) for f in centres)
    audit=read(DOC/'canopy-audit.json');groups=read(DOC/'canopy-gap-accounting.geojson')['features']
    raw=unary_union([shape(f['geometry']).buffer(0) for f in read(DOC/'canopy-gaps.geojson')['features']]).intersection(scope)
    accounted=unary_union([shape(f['geometry']) for f in groups])
    assert raw.symmetric_difference(accounted).area<.001
    assert abs(sum(shape(f['geometry']).area for f in groups)-raw.area)<.001
    assert audit['gapAccounting']['completeTreeRepresentation'] is False
    issues=read(DOC/'issue-index.json')['cases'];by_id={c['id']:c for c in issues}
    for c in read(PRIOR_DOC/'issue-index.json')['cases']:
        assert c['id'] in by_id
        assert shape(c['geometry']).equals(shape(by_id[c['id']]['geometry'])),'Prior unresolved geometry changed'
    counts=read(DOC/'coverage.json')
    assert abs(counts['inspectedAreaMetres2']-scope.difference(reserve).area)<.001
    assert counts['areaByStatusMetres2']['unreviewed']==0
    save(DOC/'scope-check.json',dict(status='passed',facilityCells=len(features),newReviewScenes=len(scenes),clubFacilityFootprints=len(buildings),clubFacilityCentreOnly=len(centres),
        ownerUnionEqualsFacility=True,ownerOverlapMetres2=0,everyEditableCellInspected=True,allHeightGapsExplicit=True,priorIssuesRetained=True,
        limitation='Coverage checks verify the review ledger, not every real stem or positional accuracy. Protected evaluation is excluded from inspected area.'))
    print('Facility scope, ownership and gap checks passed');check_lock()


if __name__=='__main__':main()
