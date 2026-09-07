/* Adopt one reviewed physical path. Original records and projected evidence
 * remain in mapping/; only the local polygon and scalar provenance ship. */
import assert from 'node:assert/strict';
import { polyArea } from '../upsalabuild/lib.mjs';

export function applyUpsalaPracticePath(model, evidence) {
  assert.equal(evidence.schemaVersion, 1);
  assert.deepEqual(evidence.frame, { origin: model.origin, mPerLat: model.mPerLat, mPerLon: model.mPerLon });
  assert.equal(evidence.features.length, 1, 'practice path review has one decision');
  const f = evidence.features[0];
  assert.equal(f.status, 'accepted');
  assert.equal(f.kind, 'paved_path');
  assert(/^[a-f0-9]{64}$/.test(evidence.source.querySha256), 'missing surveyed path source hash');
  const old = model.infra.tracks.find(t => t.id === f.replacesTrack.id);
  assert.deepEqual(old, f.replacesTrack, 'practice path source track changed; re-review required');
  assert(!model.scenery.mappedFeatures.some(p => p.id === f.id), 'practice path already applied');
  assert(f.ring.length >= 3 && f.ring.every(p => p.length === 2 && p.every(Number.isFinite)), 'invalid path ring');
  assert(Math.abs(Math.abs(polyArea(f.ring)) - f.areaM2) < 0.001, 'path area changed since review');
  const record = Object.fromEntries(Object.entries(f).filter(([, value]) =>
    value === null || ['string', 'boolean', 'number'].includes(typeof value)));
  Object.assign(record, { rings: [structuredClone(f.ring)], prov: 'municipal-boundaries-and-orthophoto-review',
    sourceId: f.id, replacesSourceId: old.id, sourceSha256: evidence.source.querySha256,
    sourceUrl: evidence.source.url, sourceProvider: evidence.source.provider,
    sourceEvidence: 'upsalabuild/mapping/practice-path-review-2026-09-07.json' });
  model.infra.tracks = model.infra.tracks.filter(t => t.id !== old.id);
  model.scenery.mappedFeatures.push(record);
  return model;
}
