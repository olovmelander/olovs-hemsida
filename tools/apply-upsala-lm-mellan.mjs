/* H6 is a shared physical green. Adopt once into the parent source association
 * and its rendered scenery ring; build-nine reads the same association before
 * deduplicating its own playing surface. Keep original evidence outside models. */
import assert from 'node:assert/strict';
import { applyUpsalaLmSurfaces } from './apply-upsala-lm-surfaces.mjs';

export function applyUpsalaLmMellan(model, review) {
  assert.equal(review.features?.length, 1, 'Mellan LM review must identify only the reviewed H6 green');
  const feature = review.features[0];
  assert.equal(feature.kind, 'green', 'Mellan LM feature must be a green');
  assert.equal(feature.hole, 6, 'Mellan LM feature must belong to H6');
  assert.equal(feature.sourceId, 'w221192642', 'Mellan H6 source association changed');
  const sources = model.scenery?.sourceFeatures;
  const rendered = model.scenery?.greens;
  assert(Array.isArray(sources) && Array.isArray(rendered), 'missing shared Mellan scenery');
  const matches = sources.filter(source => source.id === feature.sourceId);
  assert.equal(matches.length, 1, 'Mellan H6 source association is missing or duplicated');
  const source = matches[0];
  assert.deepEqual(source, feature.originalScenerySourceFeature, 'Mellan H6 shared source changed; re-review required');
  assert.equal(source.kind, 'green', 'Mellan H6 shared source changed type');
  assert.deepEqual(source.ring, feature.originalShape.ring, 'Mellan H6 played and shared originals differ');
  const oldKey = JSON.stringify(source.ring), nextKey = JSON.stringify(feature.ring);
  assert.notEqual(oldKey, nextKey, 'Mellan H6 review does not change its boundary');
  const oldIndexes = rendered.flatMap((ring, index) => JSON.stringify(ring) === oldKey ? [index] : []);
  assert.equal(feature.originalRenderedRingCount, 1, 'Mellan H6 evidence must identify one original rendered ring');
  assert.equal(oldIndexes.length, feature.originalRenderedRingCount, 'Mellan H6 rendered ownership changed');
  assert(!rendered.some(ring => JSON.stringify(ring) === nextKey), 'Mellan H6 reviewed ring already exists');

  // Reuse the played-surface gate for frame, original shape, pin containment,
  // finite coordinates, source hashes and the compact runtime evidence whitelist.
  const temporary = { origin: model.origin, mPerLat: model.mPerLat, mPerLon: model.mPerLon,
    holes: [{ n: 6, green: structuredClone(feature.originalShape), bunkers: [] }] };
  applyUpsalaLmSurfaces(temporary, [review]);
  const adopted = temporary.holes[0].green;
  const next = { ...source, ring: structuredClone(adopted.ring), prov: adopted.prov,
    evidence: structuredClone(adopted.evidence), preserveBoundary: true,
    courseSlug: 'upsala-mellanbanan', hole: 6 };

  // All guards complete before either active representation changes.
  sources[sources.indexOf(source)] = next;
  rendered[oldIndexes[0]] = structuredClone(adopted.ring);
  return next;
}
