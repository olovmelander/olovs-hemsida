/* Apply dated Stora mowing observations after the earlier mapping corrections.
 * Original shapes and source-panel coordinates stay in the evidence file.
 * Validate every replacement before mutating the model. Card/routing, pin
 * references, terrain and non-surface scenery are deliberately not inferred.
 */
import assert from 'node:assert/strict';
import { pointInPoly, polyArea } from '../upsalabuild/lib.mjs';

export function applyReviewedStoraSurfaces(model, evidence) {
  assert.deepEqual(evidence.frame, {
    origin: model.origin, mPerLat: model.mPerLat, mPerLon: model.mPerLon,
  }, 'Stora surface review frame changed');
  assert(Array.isArray(evidence.features) && evidence.features.length, 'missing reviewed surfaces');
  const seen = new Set();
  const replacements = evidence.features.map(feature => {
    const { id, kind, hole, rings } = feature;
    assert(['green', 'fairway'].includes(kind), `unsupported surface ${id}`);
    assert.equal(feature.status, 'accepted', `unaccepted surface ${id}`);
    assert(!seen.has(`${hole}:${kind}`), `duplicate surface ${hole}:${kind}`);
    seen.add(`${hole}:${kind}`);
    const target = model.holes.find(h => h.n === hole);
    assert(target, `missing hole ${hole}`);
    assert.deepEqual(target[kind], feature.originalShape, `${id}: original surface changed; re-review required`);
    assert(rings?.length && (kind !== 'green' || rings.length === 1), `${id}: invalid ring count`);
    for (const ring of rings) {
      assert(ring.length >= 3 && ring.every(p => p.length === 2 && p.every(Number.isFinite)), `${id}: invalid local polygon`);
      assert(Math.abs(polyArea(ring)) > 1, `${id}: degenerate polygon`);
    }
    assert(feature.evidence?.sourceProductYear === 2025 && feature.evidence.sourceFiles?.length,
      `${id}: missing dated source record`);
    if (kind === 'green') assert(pointInPoly(...target.green.c, rings[0]), `${id}: existing pin reference outside observed green`);
    // Explicit whitelist: never transport source image coordinates or the old
    // geometry into a model subsequently traversed by the projection migrator.
    const source = feature.evidence;
    const metadata = {
      source: source.source, sourceProductYear: source.sourceProductYear,
      sourceSha256: source.sourceFiles.map(s => s.sha256),
      sourceHorizontalAccuracyM: null, uncertaintyM: source.uncertaintyM,
      latestVisualCrossCheckYear: source.latestVisualCrossCheckYear,
      acceptance: source.acceptance, note: source.note,
    };
    const shape = kind === 'green'
      ? { ...target.green, ring: structuredClone(rings[0]), area: Math.round(Math.abs(polyArea(rings[0])) * 100) / 100 }
      : { rings: structuredClone(rings) };
    return { target, kind, shape: { ...shape, prov: 'dated-orthophoto-trace', sourceId: id, evidence: metadata } };
  });
  for (const { target, kind, shape } of replacements) target[kind] = shape;
  return model;
}
