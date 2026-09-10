import { geometrySha256 } from './apply-ortho-review.mjs';

export function applyObPlacementReview(input, review) {
  if (review?.groundId !== 'johannesberg' || review.course !== 'johannesberg' ||
      JSON.stringify(input.origin) !== JSON.stringify(review.frame?.origin)) throw new Error('OB review identity mismatch');
  const id = `johannesberg-ob-placement-${review.reviewedOn}`;
  if (input.obPlacementReview?.id !== id && geometrySha256(input.marking) !== review.originalMarkingSha256) {
    throw new Error('OB original marking drift');
  }
  if (geometrySha256(review.originalMarking) !== review.originalMarkingSha256) throw new Error('OB baseline evidence drift');
  const model = structuredClone(input), ids = new Set();
  model.marking = review.features.map(feature => {
    if (feature.status !== 'accepted-display-corridor' || feature.color !== 'w' || ids.has(feature.id) ||
        !input.holes.some(h => h.n === feature.hole) || !feature.evidence?.officialPlanUrl ||
        !(feature.evidence.corridorUncertaintyM > 0) || !feature.line?.length ||
        !feature.line.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) throw new Error('Invalid OB corridor evidence');
    ids.add(feature.id);
    const spacing = feature.postPlacement?.spacingM;
    if (!(spacing > 0 && spacing <= 12) || feature.postPlacement.physicalPostPositionsObserved !== false) throw new Error('OB display spacing must remain explicitly illustrative');
    const pts = [[...feature.line[0]]];
    for (let i = 1; i < feature.line.length; i++) {
      const a = feature.line[i - 1], b = feature.line[i], distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!distance) throw new Error('OB corridor has a repeated vertex');
      const count = Math.ceil(distance / spacing);
      for (let k = 1; k <= count; k++) pts.push(a.map((v, axis) => Number((v + (b[axis] - v) * k / count).toFixed(3))));
    }
    return { color: 'w', hole: feature.hole, pts, id: feature.id, reviewId: id,
      line: structuredClone(feature.line), boundaryStatus: feature.boundaryStatus,
      corridorUncertaintyM: feature.evidence.corridorUncertaintyM,
      postPlacementKind: 'illustrative-distance-spacing', physicalPostPositionsObserved: false };
  });
  model.obPlacementReview = { id, sourceReviewSha256: geometrySha256(review),
    scope: 'club-guide-supported corridors; individual physical post locations unverified' };
  return model;
}
