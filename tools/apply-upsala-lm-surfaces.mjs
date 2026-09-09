/* Apply visually reviewed authenticated orthophoto boundaries. Source pixel and
 * national-grid coordinates stay in the review ledger, outside runtime vectors.
 * Validate all decisions before changing any surface. */
import assert from 'node:assert/strict';
import { pointInPoly, polyArea } from '../upsalabuild/lib.mjs';

export function applyUpsalaLmSurfaces(model, reviews) {
  const seen = new Set();
  const changes = reviews.flatMap(review => {
    assert.deepEqual(review.frame, {
      origin: model.origin, mPerLat: model.mPerLat, mPerLon: model.mPerLon,
    }, 'LM review frame changed');
    return review.features.map(feature => {
      const { id, kind, hole, ring } = feature;
      assert.equal(feature.status, 'accepted', `${id}: unaccepted boundary`);
      assert(['green', 'bunker'].includes(kind), `${id}: unsupported boundary`);
      const key = `${hole}:${kind}:${feature.sourceId}`;
      assert(!seen.has(key), `${id}: duplicate boundary`);
      seen.add(key);
      const target = model.holes.find(h => h.n === hole);
      assert(target, `${id}: missing hole`);
      const matches = kind === 'green' ? [target.green]
        : target.bunkers.filter(b => b.sourceId === feature.sourceId);
      assert.equal(matches.length, 1, `${id}: ambiguous surface identity`);
      const original = matches[0];
      assert.equal(original.sourceId, feature.sourceId, `${id}: source identity changed`);
      assert.deepEqual(original, feature.originalShape, `${id}: original surface changed; re-review required`);
      const merged = [];
      assert([undefined, 'replace', 'merge'].includes(feature.action), `${id}: unsupported action`);
      if (feature.action === 'merge') {
        assert.equal(kind, 'bunker', `${id}: only sand footprints can merge`);
        assert(feature.mergedSourceIds?.length && feature.mergedSourceIds.length === feature.originalMergedShapes?.length, `${id}: missing merged-source evidence`);
        feature.mergedSourceIds.forEach((sourceId, i) => {
          const mergeKey = `${hole}:bunker:${sourceId}`;
          assert(!seen.has(mergeKey), `${id}: duplicate merged source`);
          seen.add(mergeKey);
          const candidates = target.bunkers.filter(b => b.sourceId === sourceId);
          assert.equal(candidates.length, 1, `${id}: missing merged bunker`);
          assert.deepEqual(candidates[0], feature.originalMergedShapes[i], `${id}: merged original surface changed; re-review required`);
          assert(!(model.scenery?.retiredSourceFeatures || []).some(f => f.id === sourceId), `${id}: merged source already retired`);
          merged.push(candidates[0]);
        });
      } else assert(!feature.mergedSourceIds?.length, `${id}: undeclared merge`);
      assert(ring?.length >= 3 && ring.every(p => p.length === 2 && p.every(Number.isFinite)), `${id}: invalid polygon`);
      assert(Math.abs(polyArea(ring)) > 1, `${id}: degenerate polygon`);
      if (kind === 'green') assert(pointInPoly(...original.c, ring), `${id}: green excludes current reference`);
      else assert(!pointInPoly(...target.green.c, ring), `${id}: bunker contains green reference`);
      const evidence = feature.evidence;
      assert(evidence?.sourceFiles?.length && evidence.sourceFiles.every(s => /^[a-f0-9]{64}$/.test(s.sha256)), `${id}: missing source hashes`);
      assert(evidence.sourceCaptureDates?.length && evidence.sourceCaptureDates.every(d => /^\d{4}-\d{2}-\d{2}/.test(d)), `${id}: missing capture dates`);
      assert(Number.isFinite(evidence.uncertaintyM) && evidence.uncertaintyM > 0, `${id}: missing interpretation uncertainty`);
      const next = {
        ...original, ring: structuredClone(ring),
        ...(kind === 'green' || Object.hasOwn(original, 'area') ? { area: Math.round(Math.abs(polyArea(ring)) * 100) / 100 } : {}),
        prov: 'dated-orthophoto-trace',
        ...(merged.length ? { replacesSourceIds: [feature.sourceId, ...feature.mergedSourceIds] } : {}),
        evidence: {
          source: evidence.source, reviewId: id,
          sourceCaptureDates: evidence.sourceCaptureDates,
          sourceProductYear: Number(evidence.sourceCaptureDates[0].slice(0, 4)),
          sourceSha256: evidence.sourceFiles.map(s => s.sha256),
          sourceHorizontalAccuracyM: null, uncertaintyM: evidence.uncertaintyM,
          acceptance: evidence.acceptance, note: evidence.note,
        },
      };
      return { target, original, next, kind, merged };
    });
  });
  for (const { target, original, next, kind, merged } of changes) {
    if (kind === 'green') target.green = next;
    else target.bunkers[target.bunkers.indexOf(original)] = next;
    for (const old of merged) {
      target.bunkers.splice(target.bunkers.indexOf(old), 1);
      ((model.scenery ||= {}).retiredSourceFeatures ||= []).push({
        id: old.sourceId, kind: 'bunker', status: 'merged-into-visible-connected-sand',
        replacedBySourceId: next.sourceId, sourceReviewId: next.evidence.reviewId,
        sourceCaptureDates: next.evidence.sourceCaptureDates,
        sourceSha256: next.evidence.sourceSha256,
        sourceAbsoluteHorizontalAccuracyMetres: null,
      });
    }
  }
  return model;
}
