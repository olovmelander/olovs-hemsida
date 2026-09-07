/* Paired dated-image decisions: remove unsupported coarse fairway claims and
 * add the visibly present Sahara sand footprint. Validate the complete batch
 * before changing a model. Source pixels/projected coordinates stay in evidence.
 */
import assert from 'node:assert/strict';
import { pointInPoly, polyArea } from '../upsalabuild/lib.mjs';

export function applyReviewedStoraPar3Sahara(model, evidence) {
  assert.deepEqual(evidence.frame, {
    origin: model.origin, mPerLat: model.mPerLat, mPerLon: model.mPerLon,
  }, 'Stora par3/Sahara review frame changed');
  assert(evidence.features?.length, 'missing par3/Sahara decisions');
  const seen = new Set();
  const decisions = evidence.features.map(feature => {
    const { id, hole, kind, action } = feature;
    assert.equal(feature.status, 'accepted', `unaccepted decision ${id}`);
    assert(!seen.has(`${hole}:${kind}`), `duplicate reviewed surface ${hole}:${kind}`);
    seen.add(`${hole}:${kind}`);
    const target = model.holes.find(h => h.n === hole);
    assert(target, `missing hole ${hole}`);
    const source = feature.evidence;
    assert(source?.sourceProductYear === 2025 && source.latestVisualCrossCheckYear === 2024,
      `${id}: missing paired dated review`);
    assert([2025, 2024].every(year => feature.sourcePanels?.some(panel =>
      panel.sourceProductYear === year && panel.sourceFiles?.length &&
      panel.sourceFiles.every(file => /^https:\/\//.test(file.url) && /^[a-f0-9]{64}$/.test(file.sha256)))),
    `${id}: missing source georeference records`);
    const metadata = {
      source: source.source, sourceProductYear: source.sourceProductYear,
      latestVisualCrossCheckYear: source.latestVisualCrossCheckYear,
      sourceSha256: [...new Set(feature.sourcePanels.flatMap(panel => panel.sourceFiles.map(file => file.sha256)))],
      sourceHorizontalAccuracyM: null, uncertaintyM: source.uncertaintyM,
      acceptance: source.acceptance, note: source.note,
    };
    if (kind === 'fairway' && action === 'retire') {
      assert.equal(target.par, 3, `${id}: retirement must target a reviewed par3`);
      assert.deepEqual(target.fairway, feature.originalShape, `${id}: original fairway changed; re-review required`);
      assert.deepEqual(feature.rings, [], `${id}: retirement cannot silently supply replacement turf`);
      return { target, key: 'fairway', value: {
        rings: [], prov: 'dated-orthophoto-retirement', sourceId: id, evidence: metadata,
      } };
    }
    assert(kind === 'bunker' && action === 'add', `unsupported surface decision ${id}`);
    assert.deepEqual(target.bunkers, feature.originalBunkers, `${id}: original bunker census changed; re-review required`);
    assert.equal(feature.rings?.length, 1, `${id}: expected one exposed sand polygon`);
    const ring = feature.rings[0];
    assert(ring.length >= 3 && ring.every(p => p.length === 2 && p.every(Number.isFinite)), `${id}: invalid sand polygon`);
    assert(Math.abs(polyArea(ring)) > 1, `${id}: degenerate sand polygon`);
    assert(!pointInPoly(...target.green.c, ring), `${id}: sand cannot contain the current green reference`);
    assert(!model.holes.some(h => h.bunkers.some(b => b.sourceId === id)), `${id}: bunker already exists`);
    return { target, key: 'bunkers', value: [...structuredClone(target.bunkers), {
      ring: structuredClone(ring), prov: 'dated-orthophoto-trace', sourceId: id,
      name: feature.name, evidence: metadata,
    }] };
  });
  for (const { target, key, value } of decisions) target[key] = value;
  return model;
}
