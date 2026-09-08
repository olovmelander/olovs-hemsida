/* Add the archive-reviewed northern H8 platform to the existing Mellan tee
 * evidence. Both the Stora scenery integration and nine builder must consume
 * this same merged evidence. Historical geometry remains an asserted source;
 * no route, scorecard, daily marker, terrain or accepted old ring is changed.
 */
import assert from 'node:assert/strict';
import { applyReviewedTeeSurfaces } from './apply-reviewed-tee-surfaces.mjs';

export function mergeMellanTeeReview20260907(base, review) {
  assert.equal(review.schemaVersion, 1, 'unsupported Mellan tee review');
  assert.equal(review.courseId, 'upsala-mellanbanan', 'wrong course for Mellan tee review');
  assert.deepEqual(base.frame, review.frame, 'Mellan tee review frame changed');
  assert.equal(base.reference.archiveSha256, review.originalReferenceArchiveSha256, 'Mellan archived tee reference changed');
  assert.deepEqual(review.holes.map(h => h.hole), [8], 'Mellan follow-up is limited to H8');
  assert.deepEqual(base.features.filter(f => f.hole === 8), review.originalHoleFeatures, 'Mellan accepted H8 evidence changed');
  assert.deepEqual(base.unresolvedCandidates.find(c => c.id === review.resolvedCandidate.id), review.resolvedCandidate,
    'Mellan unresolved candidate changed');
  const sourceHole = review.holes[0];
  assert.deepEqual(sourceHole.retireOriginalPadIndices, [], 'Mellan follow-up cannot retire accepted surfaces');
  // Reuse full simple-ring/source/partial-review validation, against the exact
  // archived current model. The merge below does not publish this model.
  applyReviewedTeeSurfaces({ ...review.frame, holes: [{ n: 8,
    line: sourceHole.originalLine, t: sourceHole.originalDistances,
    tees: { pads: sourceHole.originalPads, marks: sourceHole.originalMarks } }] }, [review]);
  const result = structuredClone(base);
  const sourceArchive = base.reference.archive.holes.find(h => h.n === 8);
  const knownIds = new Set(base.features.map(f => f.id));
  for (const feature of review.features) {
    assert(!knownIds.has(feature.id), 'Mellan follow-up already applied');
    knownIds.add(feature.id);
    result.features.push({ ...structuredClone(feature),
      originalPads: structuredClone(sourceArchive.pads),
      originalMarks: structuredClone(sourceArchive.marks),
      originalRouteStart: structuredClone(sourceArchive.routeStart) });
  }
  const knownSources = new Set(result.sources.map(s => s.id));
  for (const source of review.sources.filter(s => s.id && !knownSources.has(s.id))) {
    result.sources.push(structuredClone(source)); knownSources.add(source.id);
  }
  const coverage = result.coverage.find(h => h.hole === 8);
  coverage.acceptedPhysicalPlatforms += review.features.length;
  coverage.status = 'partial; northern archive-reviewed platform added, hidden boundaries and remaining locations unverified';
  result.followupNotes = ['2026-09-07: archive-reviewed northern H8 platform added. Existing accepted outlines retained; no colour/daily marker assignment.'];
  result.unresolvedCandidates = result.unresolvedCandidates.filter(c => c.id !== review.resolvedCandidate.id);
  result.summary = { ...result.summary,
    acceptedPhysicalPlatforms: result.features.length,
    totalAreaSquareMetres: +result.features.reduce((sum, f) => sum + f.area, 0).toFixed(3),
    maximumInterpretationUncertaintyMetres: Math.max(...result.features.map(f => f.boundaryInterpretationUncertaintyMetres)),
    unadoptedHole8Candidates: result.unresolvedCandidates.filter(c => c.possibleHole === 8).length,
    followupEvidence: 'mellan-tees-review-2026-09-07.json' };
  return result;
}
