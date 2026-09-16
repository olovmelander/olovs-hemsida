"""Close the bounded local pilot; audit ground conflicts without changing trees.

Uses frozen source geometry and retained runtime probes. A gap probe is not a
proposed stem, and a nearest routing is an orientation aid, not ownership.
"""
import argparse
import csv
import json
import shutil
from collections import Counter
from pathlib import Path

from round6 import ROOT, OUT, read, save, digest, protected
from shapely.geometry import shape, mapping, Polygon, Point, LineString
from shapely.ops import unary_union

PREVIOUS = OUT / 'round6'
EVIDENCE = ROOT / 'geo_data/course-v2/visby/vegetation/pilot/round6'
DOC = EVIDENCE.parent / 'closeout'
WORK = OUT / 'closeout'
TOOLS = ROOT / 'tools/visby-tree-pilot'
VISUAL = {
    'gap-009': 'Southern crown and height lobe are visible beside the retained group. The diagnostic point is outside the frozen fairway ring, while the runtime reports a semi-rough/mown margin. Ground geometry and exclusion policy need to be reconciled; moving the crown centre to pass a filter is unsupported.',
    'gap-017': 'Isolated crown, separate height island and cast shadow agree across dates. Grass continues around the tree; the image does not justify cutting a crown-shaped hole in the fairway polygon or locating a surveyed stem.',
    'gap-018': 'Distinct crown, LiDAR island and shadow occur in open grass in both image years. The mapped fairway contains the diagnostic point. Tree presence does not by itself prove that the grass surface classification is wrong.',
    'gap-022': 'Separate crown and LiDAR island cross a narrow mapped fairway strip. Mown grass and shadow are visible, but the ground immediately beneath the crown is obscured. Hold the ground/base conflict.',
    'gap-050': 'Small isolated crown and matching shadow persist across dates, with height support. The broad fairway mask includes the crown. Retain the tree-presence evidence without inventing a grass boundary under it.',
    'gap-064': 'Small isolated tree beside practice-area furniture has seasonal, CIR and height support. The broad range polygon includes it. A tree within grass is possible; vegetation presence alone does not justify changing the range surface.',
}


def rel(p):
    return p.relative_to(ROOT).as_posix()


def verify_hashes(hashes):
    for name, expected in hashes.items():
        assert digest(ROOT / name) == expected, 'Frozen input changed: ' + name


def validate_retained_evidence():
    for pair in read(EVIDENCE / 'screenshots.json')['pairs']:
        for side in ['before', 'after']:
            assert digest(OUT / pair[side + 'File']) == pair[side + 'Sha256']
        assert pair['cameraIdentical']
    for pair in read(EVIDENCE / 'closeups.json')['pairs']:
        for side in ['before', 'after']:
            assert digest(PREVIOUS / 'closeups' / pair[side]) == pair[side + 'Sha256']
    for case in read(EVIDENCE / 'review-journal.json')['cases']:
        if case['classification'] == 'distinct-base-conflict':
            assert digest(PREVIOUS / 'review' / (case['id'] + '-board.png')) == case['boardSha256']
    for job in read(PREVIOUS / 'stand-output/index.json'):
        assert digest(PREVIOUS / job['file']) == job['sha256']


def lock_inputs():
    DOC.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    validate_retained_evidence()
    target = DOC / 'input-lock.json'
    if target.exists():
        verify_hashes(read(target)['sha256'])
        return
    hashes = {}
    for name in ['input-lock.json', 'reproduction-lock.json']:
        retained = read(EVIDENCE / name)['sha256']
        verify_hashes(retained)
        for k, v in retained.items():
            assert k not in hashes or hashes[k] == v, k
            hashes[k] = v
    files = [p for p in EVIDENCE.iterdir() if p.is_file()]
    files += [p for folder in [PREVIOUS / 'after', OUT / 'build'] for p in folder.rglob('*') if p.is_file()]
    files += [PREVIOUS / name for name in ['pilot-records.json', 'pilot-footprints.geojson', 'publication.json', 'stand-output/index.json']]
    files += [PREVIOUS / j['file'] for j in read(PREVIOUS / 'stand-output/index.json')]
    files += [OUT / 'exclusions.json', EVIDENCE.parent / 'round5/coverage.json', EVIDENCE.parent / 'round2/evaluation.json']
    for case in read(EVIDENCE / 'review-journal.json')['cases']:
        if case['classification'] != 'distinct-base-conflict':
            continue
        files += [PREVIOUS / 'review' / (case['id'] + suffix) for suffix in ['.json', '-board.png']]
        for source in read(PREVIOUS / 'review' / (case['id'] + '.json'))['sources']:
            assert digest(ROOT / source['path']) == source['rasterSha256']
            files.append(ROOT / source['path'])
    hashes.update({rel(p): digest(p) for p in files})
    save(target, dict(checkpoint='round6', sha256=hashes))
    save(DOC / 'protocol.json', dict(
        scope='Final ground-conflict audit of the 27 already reviewed distinct-crown patches; detailed source reinspection of six isolated/distinct examples.',
        detailedReinspection=list(VISUAL),
        stop='One audit and closure package. No automatic next review pass. Remaining exceptions keep their unresolved status and geometry.',
        mutationPolicy='Read-only vegetation, ground, frozen build, production and evaluation. No new detector, source acquisition or trunk-position claim.',
        exit='Final local delivery can close with declared exceptions. Detector, full-representation and release gates remain separate.'))


def ground_features(geometry, exclusions):
    features = []
    for h in geometry['holes']:
        for i, ring in enumerate(h['fairway']['rings']):
            features.append(dict(id=f'holes/{h["n"]}/fairway/rings/{i}', kind='fairway', hole=h['n'],
                geometry=Polygon(ring).buffer(0), sourceIds=h.get('sourceIds', []), confidence=h.get('confidence'),
                bufferMetres=0, geometryMeaning='mapped-mown-surface'))
    for key in ['fairways', 'range', 'greens', 'tees', 'grass']:
        for i, ring in enumerate(geometry['scenery'][key]):
            features.append(dict(id=f'scenery/{key}/{i}', kind=key, hole=None,
                geometry=Polygon(ring).buffer(0), sourceIds=[], confidence='Frozen source-derived scenery geometry; per-ring survey provenance absent.',
                bufferMetres=0, geometryMeaning='mapped-mown-surface'))
    buffers = {r['kind']: r['bufferMetres'] for r in exclusions['reasons']}
    # The acquisition/stand exclusion layer is distinct from a ground surface.
    # Keep its buffer and provenance visible, especially for road/tee cases.
    for i, f in enumerate(exclusions['features']):
        if f['kind'] in ['fairway', 'practice']:
            continue
        shapes = [Polygon(r).buffer(0) for r in f.get('rings', [])]
        shapes += [LineString(r) for r in f.get('lines', [])]
        if not shapes:
            continue
        margin = buffers.get(f['kind'], 0)
        g = unary_union(shapes).buffer(margin)
        if g.is_empty:
            continue
        features.append(dict(id=f'exclusions/features/{i}', kind=f['kind'], hole=None,
            geometry=g, sourceIds=[], confidence='Frozen source exclusion; not a surveyed stem or runtime rejection report.',
            bufferMetres=margin, geometryMeaning='buffered-source-exclusion'))
    return features


def build():
    lock_inputs()
    exclusions = read(OUT / 'exclusions.json')
    source = exclusions['geometry']
    features = ground_features(source, exclusions)
    journal = read(EVIDENCE / 'review-journal.json')['cases']
    selected = [c for c in journal if c['classification'] == 'distinct-base-conflict']
    assert len(selected) == 27
    lines = [(h['n'], LineString(h['line'])) for h in source['holes'] if len(h['line']) >= 2]
    fresh = protected()
    results = []
    used_features = {}
    for case in selected:
        sid = case['id']
        patch = shape(case['geometry'])
        probe = case['runtimeProbe']
        point = Point(probe['easting'], probe['northing'])
        nearby = []
        for feature in features:
            g = feature['geometry']
            if g.distance(point) > 15 and not g.intersects(patch):
                continue
            nearby.append(dict(id=feature['id'], kind=feature['kind'], hole=feature['hole'],
                sourceIds=feature['sourceIds'], confidence=feature['confidence'],
                bufferMetres=feature['bufferMetres'], geometryMeaning=feature['geometryMeaning'],
                polygonAreaMetres2=g.area, pointInside=g.covers(point),
                pointDistanceMetres=g.distance(point), boundaryDistanceMetres=g.boundary.distance(point),
                patchOverlapMetres2=g.intersection(patch).area))
            used_features[feature['id']] = feature
        nearest_hole, line = min(lines, key=lambda entry: entry[1].distance(point))
        group = 'crown-identity-and-ground'
        required = 'Resolve complete crown identity and the underlying ground/exclusion conflict together. Retain connected woodland and neighbouring IDs until then.'
        if sid in VISUAL:
            group = 'distinct-crown-ground-policy'
            required = 'Reconcile source-supported individual trees with the actual grass boundary and runtime margin. If the grass mapping is correct, a separately scoped exclusion-policy change needs source-catalogue trust, hard-surface controls, duplicate checks and renderer validation. Do not carve a canopy-shaped grass hole.'
        if sid == 'gap-024':
            group = 'road-base-and-retained-identity'
            required = 'Establish the base relative to the road using defensible source evidence. Preserve reserved tree-visby-003535 and prior candidate r5-111/dalponte-d9-m5/35; do not allocate another ID.'
        if sid == 'gap-041':
            group = 'tee-overhang-base'
            required = 'Establish the base separately from crown overhang at the tee/path junction. Preserve the tee and path exclusion.'
        if sid == 'gap-019':
            group = 'bunker-margin-base'
            required = 'Establish the base and bunker/grass boundary separately from the overhead crown. Preserve the bunker exclusion.'
        results.append(dict(id='closeout-' + sid, scene=sid, gapId=case['gapId'],
            geometry=case['geometry'], areaMetres2=patch.area, status='unresolved',
            group=group, priority='first-ground-policy-review' if sid in VISUAL else 'retain-in-backlog',
            nearestHole=nearest_hole, distanceToRoutingMetres=line.distance(point),
            routingMeaning='Nearest frozen routing line for orientation; not tree ownership or measured shot impact.',
            protectedDistanceMetres=fresh.distance(patch),
            previousInterpretation=case['note'],
            detailedSourceReinspection=sid in VISUAL,
            closeoutInterpretation=VISUAL.get(sid, 'Previous source interpretation retained; this closeout adds the ground-feature audit, not a fresh detailed crown review.'),
            requiredNextEvidenceOrChange=required, runtimeProbe=probe,
            probeMeaning='Retained height-weighted residual-gap diagnostic point, not an approved tree base. Filter attribution is inferred from analytic/atlas probes, not a reported rejection for a planted candidate.',
            nearbyGroundFeatures=nearby, priorIssueIds=case['priorIssueIds'],
            board='../round6/review/' + sid + '-board.png', boardSha256=case['boardSha256'],
            sourceDates=case['sourceDates'], sources=case['sources']))
    # Guard the useful distinction: this gap's diagnostic is outside its source
    # fairway, despite a nonzero runtime fair weight. No location is optimized.
    example = next(c for c in results if c['scene'] == 'gap-009')
    ring = next(f for f in example['nearbyGroundFeatures'] if f['id'] == 'holes/13/fairway/rings/0')
    assert not ring['pointInside'] and 3 < ring['pointDistanceMetres'] < 5
    assert example['runtimeProbe']['analytic']['fair'] > .05
    assert example['runtimeProbe']['atlas']['surface'] == 1
    assert all(c['protectedDistanceMetres'] > 0 for c in results if c['detailedSourceReinspection'])
    road = next(c for c in results if c['scene'] == 'gap-024')
    assert any(f['kind'] in ['road', 'path'] and f['patchOverlapMetres2'] > 0 for f in road['nearbyGroundFeatures'])
    summary = dict(cases=results, totalPatches=len(results), detailedSourceReinspections=len(VISUAL),
        countsByGroup=dict(Counter(c['group'] for c in results)),
        uniqueTreeCount=None, limitation='Patches and inherited issue links overlap in meaning; they are not a count of unique missing trees.',
        groundGeometrySource=rel(OUT / 'exclusions.json'), groundGeometrySha256=digest(OUT / 'exclusions.json'),
        groundAuthority='Frozen analysis geometry. Runtime probes are recorded separately; neither establishes a surveyed ground boundary.',
        crs='EPSG:3006 / RH2000', reviewDate='2026-09-16', reviewer='agent',
        newTreePlacements=0, baseMoves=0, groundChanges=0)
    save(DOC / 'ground-conflicts.json', summary)
    save(DOC / 'ground-conflicts.geojson', dict(type='FeatureCollection', name='visby-final-ground-conflicts',
        crs=dict(type='name', properties=dict(name='urn:ogc:def:crs:EPSG::3006')),
        features=[dict(type='Feature', geometry=c['geometry'], properties={k: c[k] for k in [
            'id', 'scene', 'status', 'group', 'priority', 'nearestHole', 'areaMetres2', 'detailedSourceReinspection',
            'closeoutInterpretation', 'requiredNextEvidenceOrChange', 'protectedDistanceMetres', 'priorIssueIds']}) for c in results]))
    save(DOC / 'ground-features.geojson', dict(type='FeatureCollection',
        crs=dict(type='name', properties=dict(name='urn:ogc:def:crs:EPSG::3006')),
        features=[dict(type='Feature', geometry=mapping(f['geometry']), properties={k: v for k, v in f.items() if k != 'geometry'}) for f in used_features.values()]))
    with (DOC / 'ground-conflicts.csv').open('w', newline='', encoding='utf-8') as handle:
        columns = ['id', 'scene', 'status', 'group', 'nearestHole', 'detailedSourceReinspection', 'requiredNextEvidenceOrChange']
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(results)
    coverage = read(EVIDENCE.parent / 'round5/coverage.json')
    findings = read(EVIDENCE / 'findings.json')
    validation = read(EVIDENCE / 'validation.json')
    performance = read(EVIDENCE / 'performance.json')
    evaluation = read(EVIDENCE.parent / 'round2/evaluation.json')
    assert validation['status'] == 'passed'
    assert not performance['regressionsAbove10Percent']
    assert coverage['areaByStatusMetres2']['unreviewed'] == 0
    assert findings['accounting']['allGapAreaAccountedFor']
    assert not findings['accounting']['completeTreeRepresentation']
    status = dict(status='local-pilot-closed-with-exceptions', localPilotClosed=True,
        completedDate='2026-09-16', acceptedLocalCheckpoint='round6',
        rootSha256=read(PREVIOUS / 'publication.json')['graph']['rootSha256'],
        closeoutChange='Ground-feature audit, six detailed source reinspections, prioritized exceptions and explicit stopping criteria. Rendered placement is unchanged from round six.',
        newTreesThisCloseout=0, movedBasesThisCloseout=0, productionChanged=False,
        fullTreeRepresentationEstablished=False, surveyedStemAccuracyEstablished=False,
        independentDetectorTargetMet=False, releaseReady=False,
        records=validation['records'], renderedIndividuals=validation['rendered']['webgpu-high']['individuals'],
        renderedStandRepresentatives=validation['rendered']['webgpu-high']['standRepresentatives'],
        coverage={k: coverage[k] for k in ['scopeAreaMetres2', 'gridCells', 'inspectedCells', 'inspectedAreaMetres2', 'inspectedFraction', 'cellStatusCounts', 'areaByStatusMetres2']},
        residualAccounting=findings['accounting'],
        smallerComponentsNotIndividuallyReviewedInFocusedPass=findings['smallerUnreviewedComponents'],
        groundConflictPatches=len(results), detailedReinspections=len(VISUAL),
        retainedUnresolvedCaseIdentities=len(read(EVIDENCE / 'issue-index.json')['cases']),
        inheritedEvidence=dict(validation='../round6/validation.json', sourceTests='../round6/source-tests.json',
            screenshots='../round6/screenshots.json', closeups='../round6/closeups.json',
            performance='../round6/performance.json', deterministicRebuild='../round6/rebuild-check.json',
            evaluation='../round2/evaluation.json', issueIndex='../round6/issue-index.json',
            coverage='../round5/coverage.json'),
        validationReuse='Frozen graph, application build, assets, records, stands and prior evidence are hash-checked unchanged. No new placement or performance claim; retained runtime checks apply to the same bytes.',
        automaticNextPass=False,
        reopenTriggers=['Confirmed tree planting/removal or new source campaign.',
            'An explicitly scoped ground-boundary/exclusion-policy correction affecting the retained conflicts.',
            'A reproducible visual/runtime defect in the accepted checkpoint.',
            'A separately requested production release, with its outstanding gates.'])
    save(DOC / 'closeout.json', status)
    data = dict(status=status, conflicts=summary, evaluation=evaluation,
        facility=read(EVIDENCE / 'facility-scope.geojson'), cells=read(EVIDENCE / 'coverage.geojson'),
        detailedOrder=list(VISUAL))
    (WORK / 'data.js').write_text('window.VISBY_CLOSEOUT=' + json.dumps(data, ensure_ascii=True) + ';\n', encoding='utf-8')
    shutil.copyfile(TOOLS / 'closeout.html', WORK / 'index.html')
    export()
    verify_hashes(read(DOC / 'input-lock.json')['sha256'])
    print(json.dumps(dict(status=status['status'], auditedPatches=len(results), detailedReinspections=len(VISUAL), groups=summary['countsByGroup'], checkpointUnchanged=True)))


def export():
    target = WORK / 'exports'
    target.mkdir(exist_ok=True)
    for p in DOC.iterdir():
        if p.is_file():
            shutil.copyfile(p, target / p.name)


def seal():
    verify_hashes(read(DOC / 'input-lock.json')['sha256'])
    validate_retained_evidence()
    assert read(DOC / 'viewer-check.json')['status'] == 'passed'
    check = read(DOC / 'viewer-check.json')
    assert check['payloadSha256']['data'] == digest(WORK / 'data.js')
    assert check['payloadSha256']['html'] == digest(WORK / 'index.html')
    files = [p for p in DOC.iterdir() if p.is_file() and p.name != 'reproduction-lock.json']
    files += [p for p in TOOLS.glob('closeout*') if p.is_file()]
    files += [WORK / 'index.html', WORK / 'data.js', WORK / 'viewer-check.png', WORK / 'viewer-check-mobile.png']
    files += [ROOT / name for name in ['docs/tree-placement-workflow.md', 'docs/templates/tree-placement-review.md',
        'docs/README.md', 'tools/visby-tree-pilot/README.md', 'visbybuild/mapping/NEXT-SESSION.md']]
    save(DOC / 'reproduction-lock.json', dict(sha256={rel(p): digest(p) for p in files},
        explanation='Final closeout evidence; no runtime mutation. Input lock pins the retained placement and historical validation.'))
    export()
    print('Closeout sealed; all retained checkpoint hashes unchanged.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--seal', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.check:
        for name in ['input-lock.json', 'reproduction-lock.json']:
            verify_hashes(read(DOC / name)['sha256'])
        validate_retained_evidence()
        print('Frozen checkpoint and closeout identities verified.')
    elif args.seal:
        seal()
    else:
        build()
