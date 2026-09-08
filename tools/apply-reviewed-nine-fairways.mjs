/* Reviewed mowing boundaries replace generated corridors only when the exact
   pre-review corridor still matches. Source/crop geometry stays in evidence. */
import assert from 'node:assert/strict';

export function reviewedFairwayMetadata(feature) {
  return {
    prov: 'dated-orthophoto-trace', sourceId: feature.id,
    observedYear: feature.observedYear, crosscheckYear: feature.crosscheckYear,
    source: feature.source, sourceAbsoluteHorizontalAccuracyMetres: null,
    boundaryInterpretationUncertaintyMetres: feature.boundaryInterpretationUncertaintyMetres,
    confidence: feature.confidence,
  };
}

export function applyReviewedNineFairways(model, evidence) {
  assert.deepEqual(model.origin, evidence.frame.origin, 'reviewed fairway origin changed');
  assert.equal(model.mPerLat, evidence.frame.mPerLat, 'reviewed fairway latitude scale changed');
  assert.equal(model.mPerLon, evidence.frame.mPerLon, 'reviewed fairway longitude scale changed');
  const replacements = new Map();
  for (const feature of evidence.features) {
    const hole = model.holes.find(h => h.n === feature.hole);
    assert(hole && !replacements.has(feature.hole), `invalid or duplicate reviewed fairway hole ${feature.hole}`);
    assert.equal(feature.status, 'accepted', `unaccepted fairway ${feature.id}`);
    assert.deepEqual(hole.fairway, feature.originalFairway, `fairway ${feature.hole} changed since review; regenerate evidence against the current green/route context`);
    assert(feature.rings.length && feature.rings.every(ring => ring.length >= 3 && ring.every(p => p.length === 2 && p.every(Number.isFinite))), `invalid fairway rings ${feature.id}`);
    replacements.set(feature.hole, { rings: structuredClone(feature.rings), ...reviewedFairwayMetadata(feature) });
  }
  return { ...model, holes: model.holes.map(h => replacements.has(h.n) ? { ...h, fairway: replacements.get(h.n) } : h) };
}
